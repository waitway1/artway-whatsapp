const { randomUUID } = require('node:crypto');
const { renderMessage, messageBody, today, recentlyContacted } = require('./campaign-store.cjs');

class CampaignService {
  constructor({ store, customers, getAccount, send, publish = () => {}, delay = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    Object.assign(this, { store, customers, getAccount, send, publish, delay });
    this.activeId = null;
    this.running = false;
    for (const saved of store.snapshot().jobs) {
      const job = structuredClone(saved);
      if (['running', 'paused'].includes(job.status)) {
        job.status = 'interrupted';
        for (const row of job.rows) {
          if (row.status === 'sending') { row.status = 'unconfirmed'; row.reason = '上次退出时结果未确认，请手动核实，不会自动重发。'; }
          if (row.status === 'pending') { row.status = 'cancelled'; row.reason = '应用退出，尚未发送。'; }
        }
        store.saveJob(job);
      }
      for (const row of job.rows.filter(r => r.status === 'succeeded' && !r.contactRecorded)) this.recordSuccess(job, row);
    }
  }
  state() { this.store.pruneJobs(); return this.store.snapshot(); }
  isBusy(accountId) { return this.running && this.job?.accountId === accountId && ['running', 'paused'].includes(this.job?.status); }
  start(input) {
    if (this.running || this.job?.status === 'paused') throw new Error('请先完成或停止当前群发任务。');
    const account = this.getAccount(input?.accountId);
    const attachments = input.attachments || [];
    const body = messageBody(input?.body, attachments);
    const manual = typeof input.testPhone === 'string';
    const title = `${manual ? '号码测试' : '客户群发'} · ${today()}`;
    const cooldownDays = manual ? 0 : Number(input.cooldownDays);
    const intervalSeconds = manual ? 0 : Number(input.intervalSeconds);
    if (!manual && (!Number.isInteger(cooldownDays) || cooldownDays < 7 || cooldownDays > 365)) throw new Error('最近联系排除天数需为 7–365。');
    if (!manual && (!Number.isInteger(intervalSeconds) || intervalSeconds < 60 || intervalSeconds > 18000)) throw new Error('发送间隔至少1分钟，最多300分钟。');
    if (!manual && (!Array.isArray(input.customerIds) || !input.customerIds.length || input.customerIds.length > 200)) throw new Error('每次请选择 1–200 位客户。');
    const current = this.customers.list();
    if(manual && !/^[1-9]\d{6,14}$/.test(input.testPhone))throw new Error('测试号码需包含国际区号，填写7–15位纯数字。');
    if(manual && this.customers.deletedCustomers.some(c=>[c.phone,...(c.importPhones||[])].includes(input.testPhone)))throw new Error('此号码属于已删除客户，不允许发送。');
    const seen = new Set();
    const rows = manual ? [{id:randomUUID(),customerId:current.find(c=>c.phone===input.testPhone)?.id || null,name:current.find(c=>c.phone===input.testPhone)?.name || `测试号码 +${input.testPhone}`,country:'',phone:input.testPhone,message:body,status:'pending',reason:'',manual:true}] : [...new Set(input.customerIds)].map(id => {
      const customer = current.find(c => c.id === id);
      if (!customer) throw new Error('所选客户已删除，请刷新后重新选择。');
      const message = renderMessage(body, customer);
      let reason = '';
      if (!/^[1-9]\d{6,14}$/.test(customer.phone || '')) reason = '号码格式无效';
      else if (seen.has(customer.phone)) reason = '重复号码';
      else if (recentlyContacted(customer, cooldownDays)) reason = `最近 ${cooldownDays} 天已联系`;
      else if (message.length > 2000) reason = '替换客户信息后消息超过 2000 字';
      seen.add(customer.phone);
      return { id: randomUUID(), customerId: id, name: customer.name, country: customer.country, phone: customer.phone || '', message, status: reason ? 'skipped' : 'pending', reason };
    });
    if (!rows.some(r => r.status === 'pending')) throw new Error('没有可发送的客户，请检查号码或最近联系排除设置。');
    const job = { id: randomUUID(), title, accountId: account.id, accountName: account.name, body, attachments, cooldownDays, intervalSeconds, status: 'running', createdAt: new Date().toISOString(), rows };
    for(const row of rows){row.attachments=attachments;row.contactName=row.customerId?[row.name,row.country||current.find(c=>c.id===row.customerId)?.country].filter(Boolean).join(" "):null;}
    this.store.saveJob(job);
    this.job = job;
    this.activeId = job.id;
    this.running = true;
    this.publish(job);
    this.launch();
    return structuredClone(job);
  }
  launch() {
    const job = this.job;
    this.task = this.run().catch(error => {
      job.status = 'interrupted';
      for (const row of job.rows) {
        if (row.status === 'sending') { row.status = 'unconfirmed'; row.reason = `任务中断，请核实：${error.message}`; }
        if (row.status === 'pending') { row.status = 'cancelled'; row.reason = '任务中断，未发送'; }
      }
      try { this.save(); } catch (saveError) { console.error('群发任务状态保存失败：', saveError.message); } finally { this.running = false; }
    });
  }
  control(id, action) {
    if (id !== this.job?.id || !['pause', 'resume', 'cancel'].includes(action)) throw new Error('任务操作无效。');
    if (action === 'pause' && this.job.status === 'running') this.job.status = 'paused';
    if (action === 'cancel' && ['running', 'paused'].includes(this.job.status)) {
      this.job.status = 'cancelled';
      for (const row of this.job.rows.filter(r => r.status === 'pending')) { row.status = 'cancelled'; row.reason = '已停止，未发送'; }
    }
    if (action === 'resume' && this.job.status === 'paused') {
      this.job.status = 'running';
      if (!this.running) { this.running = true; this.launch(); }
    }
    this.save();
    return structuredClone(this.job);
  }
  save() { this.store.saveJob(this.job); this.publish(structuredClone(this.job)); }
  recordSuccess(job, row) {
    try {
      if (this.customers.list().some(c => c.id === row.customerId)) {
        this.customers.recordContact(row.customerId, row.sentDate, `bulk:${job.id}:${row.id}`);
        row.contactRecorded = true;
      } else { row.reason = row.manual && !row.customerId ? '测试号码发送成功，未新建客户。' : '已发送；客户已被删除，不恢复客户资料。'; row.contactRecorded = true; row.noCustomerContact = true; }
    } catch (error) { row.reason = `已发送，联系记录待补写：${error.message}`; }
    this.store.saveJob(job);
  }
  async run() {
    const job = this.job;
    const testMode = job.rows.length === 1 && job.rows[0].manual === true;
    job.cooldownDays = testMode ? 0 : Math.max(7,job.cooldownDays);
    job.intervalSeconds = testMode ? 0 : Math.max(60,job.intervalSeconds);
    try {
      while (job.status === 'running') {
        const row = job.rows.find(r => r.status === 'pending');
        if (!row) { job.status = 'completed'; this.save(); break; }
        const current = this.customers.list().find(c => c.id === row.customerId);
        if ((!row.manual || row.customerId) && (!current || current.phone !== row.phone || recentlyContacted(current, job.cooldownDays))) {
          row.status = 'skipped'; row.reason = !current ? '客户已删除' : current.phone !== row.phone ? '号码已修改，请重新创建任务' : '发送前发现近期已有联系记录';
          this.save(); continue;
        }
        if(current){row.name = current.name;row.country = current.country;row.contactName=[current.name,current.country].filter(Boolean).join(" ");}
        row.message = job.body;
        if (row.message.length > 2000) { row.status = 'failed'; row.reason = '客户信息修改后消息超过 2000 字，未发送。'; this.save(); continue; }
        row.status = 'sending'; this.save();
        let result;
        try {
          result = await this.send(job.accountId, row, () => {
            if (job.status !== 'running') throw new Error('任务已暂停或停止，本条未发送。');
            const latest = this.customers.list().find(c => c.id === row.customerId);
            if ((!row.manual || row.customerId) && (!latest || latest.phone !== row.phone || recentlyContacted(latest, job.cooldownDays))) throw new Error('发送前客户已删除、号码修改或已有联系记录，本条未发送。');
            if(row.manual && this.customers.deletedCustomers.some(c=>[c.phone,...(c.importPhones||[])].includes(row.phone)))throw new Error('该号码已删除，本条未发送。');
            row.dispatched = true; this.save();
          });
        } catch (error) { result = { status: row.dispatched ? 'unconfirmed' : 'failed', reason: error.message }; }
        if (!row.dispatched && job.status !== 'running') {
          row.status = job.status === 'paused' ? 'pending' : 'cancelled';
          row.reason = job.status === 'paused' ? '任务已暂停，尚未发送' : '任务已停止，尚未发送';
          this.save(); break;
        }
        const confirmed = row.dispatched === true && result?.status === 'succeeded' && typeof result.messageId === 'string' && result.messageId.length > 0;
        row.status = confirmed ? 'succeeded' : result?.status === 'failed' ? 'failed' : 'unconfirmed';
        row.reason = result?.reason || (confirmed ? '' : '未获得 WhatsApp 发送确认');
        if (confirmed) {
          row.messageId = result.messageId;
          row.sentDate = today();
          this.save(); // Persist confirmation before recording the idempotent contact event.
          this.recordSuccess(job, row);
        }
        this.save();
        if (result?.fatal && job.status === 'running') {
          job.status = 'paused'; this.save(); break;
        }
        if (job.status === 'running' && job.rows.some(r => r.status === 'pending')) {
          // Short slices allow stopping a task without waiting the entire interval.
          for (let elapsed = 0; elapsed < job.intervalSeconds * 1000 && job.status === 'running'; elapsed += 250) await this.delay(250);
        }
      }
    } finally { this.running = false; }
  }
}
module.exports = { CampaignService };

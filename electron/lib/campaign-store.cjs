const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

class CampaignStore {
  constructor(file) {
    this.file = file;
    this.data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { version: 1, templates: [], jobs: [] };
    if (!Array.isArray(this.data.templates) || !Array.isArray(this.data.jobs)) throw new Error('群发数据文件格式无效。');
  }
  snapshot() { return structuredClone(this.data); }
  commit(next) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(`${this.file}.tmp`, this.file);
    this.data = next;
  }
  saveTemplate(input) {
    const name = text(input?.name, 60, '模板名称');
    const body = messageBody(input?.body, input?.attachments);
    const next = this.snapshot();
    const existing = input.id ? next.templates.find(t => t.id === input.id) : null;
    if (input.id && !existing) throw new Error('模板已不存在，请另存为新模板。');
    if (next.templates.some(t => t.id !== input.id && t.name === name)) throw new Error('模板名称已存在，请更换名称或选择对应模板保存。');
    const template = { id: existing?.id || randomUUID(), name, body, attachmentIds: (input.attachments || []).map(a=>a.id), updatedAt: new Date().toISOString() };
    if (existing) Object.assign(existing, template); else next.templates.push(template);
    this.commit(next);
    return template;
  }
  removeTemplate(id) {
    const next = this.snapshot();
    next.templates = next.templates.filter(t => t.id !== id);
    this.commit(next);
  }
  saveJob(job) {
    const next = this.snapshot();
    const index = next.jobs.findIndex(j => j.id === job.id);
    if (index >= 0) next.jobs[index] = structuredClone(job); else next.jobs.unshift(structuredClone(job));
    this.commit(next);
  }
}

function text(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error(`${label}必填，最多 ${max} 字。`);
  return value.trim();
}
function renderMessage(body, customer) {
  return body;
}
function messageBody(value, attachments = []) {
  if (typeof value !== 'string' || value.length > 2000) throw new Error('消息内容最多2000字。');
  if (!value.trim() && !attachments.length) throw new Error('请填写消息内容或添加图片、附件。');
  return value.trim();
}
function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function recentlyContacted(customer, days, date = today()) {
  if (!days) return false;
  return (customer.contactHistory || []).some(entry => {
    const difference = (Date.parse(date) - Date.parse(entry.date)) / 86400000;
    return Number.isFinite(difference) && difference < days;
  });
}
module.exports = { CampaignStore, text, renderMessage, messageBody, today, recentlyContacted };

import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, Select, Spinner, Textarea } from '@fluentui/react-components';
import { ArrowLeft, Send, Save, Trash2, Pause, Play, Square, MessageSquareText, ImagePlus, Paperclip, X } from 'lucide-react';
import type { CampaignJob, Customer, MessageTemplate, MessageAttachment, SendStatus, WhatsAppAccount } from './types';

const statuses: Record<SendStatus, string> = { pending: '等待发送', sending: '正在发送', succeeded: '发送成功', failed: '发送失败', unconfirmed: '待核实', skipped: '已跳过', cancelled: '未发送' };
const jobLabels: Record<CampaignJob['status'], string> = { running: '发送中', paused: '已暂停', completed: '任务完成', cancelled: '已停止', interrupted: '任务中断' };
function recent(customer: Customer, days: number) {
  const date = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  return days > 0 && customer.contactHistory?.some(entry => (Date.parse(date) - Date.parse(entry.date)) / 86400000 < days);
}

export function BulkCampaignPage({ candidates, accounts, activeId, modelName, onBack }: { candidates: Customer[]; accounts: WhatsAppAccount[]; activeId: string | null; modelName: string; onBack: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [accountId, setAccountId] = useState(activeId || accounts[0]?.id || '');
  const [mode, setMode] = useState<'customers' | 'test'>('customers');
  const [testPhone, setTestPhone] = useState('');
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [body, setBody] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [jobs, setJobs] = useState<CampaignJob[]>([]);
  const [jobId, setJobId] = useState('');
  const [cooldown, setCooldown] = useState('7');
  const [interval, setInterval] = useState('1');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [deleteTemplate, setDeleteTemplate] = useState(false);
  const mergeJob = (job: CampaignJob) => setJobs(previous => [job, ...previous.filter(j => j.id !== job.id)].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0,10));
  useEffect(() => {
    let live = true;
    window.artway.campaignState().then(state => { if (!live) return; setTemplates(state.templates); setJobs(previous => [...previous, ...state.jobs.filter(job => !previous.some(current => current.id === job.id))]); setJobId(current => current || state.jobs.find(j => ['running','paused'].includes(j.status))?.id || state.jobs[0]?.id || ''); }).catch(e => live && setError(String(e.message))).finally(() => live && setLoading(false));
    const unsubscribe = window.artway.onCampaignUpdate(job => { if (live) { mergeJob(job); setJobId(current => current || job.id); } });
    return () => { live = false; unsubscribe(); };
  }, []);
  const job = jobs.find(j => j.id === jobId);
  const activeJob = jobs.find(j => ['running','paused'].includes(j.status));
  const locked = !!activeJob;
  const selectedCustomers = candidates.filter(c => selected.has(c.id));
  const selectable = candidates.filter(c => /^[1-9]\d{6,14}$/.test(c.phone || '') && !recent(c, Math.max(7, Number(cooldown) || 7)));
  useEffect(() => { setSelected(previous => new Set([...previous].filter(id => candidates.some(c => c.id === id && !recent(c, Math.max(7,Number(cooldown)||7)))))); }, [candidates,cooldown]);
  const eligible = selectedCustomers.filter(c => /^[1-9]\d{6,14}$/.test(c.phone || '') && !recent(c, Number(cooldown)));
  const preview = eligible[0] || selectedCustomers[0];
  const hasContent = !!body.trim() || attachments.length > 0;
  const testValid = /^[1-9]\d{6,14}$/.test(testPhone);
  const recipientCount = mode === 'test' ? (testValid ? 1 : 0) : selectedCustomers.length;
  const sendCount = mode === 'test' ? (testValid ? 1 : 0) : eligible.length;
  const settingsValid = mode === 'test' || cooldown !== '' && interval !== '' && Number.isInteger(Number(cooldown)) && Number(cooldown) >= 7 && Number(cooldown) <= 365 && Number.isInteger(Number(interval)) && Number(interval) >= 1 && Number(interval) <= 300;
  const counts = useMemo(() => Object.fromEntries(Object.keys(statuses).map(status => [status, job?.rows.filter(r => r.status === status).length || 0])) as Record<SendStatus, number>, [job]);
  const action = async (fn: () => Promise<void>) => { setBusy(true); setError(''); setNotice(''); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : '操作未完成，请重试。'); } finally { setBusy(false); } };
  const saveTemplate = (asNew = false) => void action(async () => {
    const saved = await window.artway.saveMessageTemplate({ id: asNew ? undefined : templateId || undefined, name: templateName, body, attachmentIds: attachments.map(a=>a.id) });
    setTemplates(previous => [saved, ...previous.filter(t => t.id !== saved.id)]); setTemplateId(saved.id); setNotice('消息模板已保存，下次可直接选用。');
  });
  const start = () => void action(async () => {
    const created = await window.artway.startCampaign({body,accountId,customerIds:mode==='test'?[]:[...selected],...(mode==='test'?{testPhone}:{}),attachmentIds:attachments.map(a=>a.id),cooldownDays:mode==='test'?0:Math.max(7,Number(cooldown)),intervalSeconds:mode==='test'?0:Number(interval)*60});
    mergeJob(created); setJobId(created.id); setConfirm(false);
  });
  return <section className="bulk-page" aria-label="WhatsApp群发工作区">
    <header className="bulk-heading"><div><Button appearance="subtle" icon={<ArrowLeft size={16}/>} disabled={busy} onClick={onBack}>客户列表</Button><h1>消息群发</h1><p>{modelName === '__unclassified' ? '未分类客户' : modelName} · 选择客户，检查内容，再开始发送</p></div><span className="bulk-rule">任务可在后台继续运行</span></header>
    {error && <div role="alert" className="customer-inline-error">{error}</div>}{notice && <div role="status" className="customer-inline-notice">{notice}</div>}
    {loading ? <Spinner label="正在读取群发数据"/> : <div className="bulk-layout">
      <div className="bulk-editor">
        <section className="bulk-section"><div className="bulk-section-title"><span>01</span><h2>客户与发送账号</h2></div>
          <div><Field label="发送账号" required><Select aria-label="发送账号" value={accountId} disabled={locked} onChange={(_,d)=>setAccountId(d.value)}>{!accounts.length && <option value="">请先添加并登录账号</option>}{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field></div>
          <div className="bulk-recipient-modes"><Button appearance={mode==='customers'?'primary':'secondary'} disabled={locked} onClick={()=>setMode('customers')}>车型客户</Button><Button appearance={mode==='test'?'primary':'secondary'} disabled={locked} onClick={()=>setMode('test')}>输入号码测试</Button></div>
          {mode==='test' ? <Field label="测试号码" required hint="包含国际区号，7–15位纯数字。不新建客户；若匹配已有客户，发送成功后记录联系。"><Input aria-label="测试号码" value={testPhone} disabled={locked} placeholder="例如 8613287657150" onChange={(_,d)=>setTestPhone(d.value.replace(/[\s()+.-]/g,''))}/></Field> : <>
          <div className="bulk-recipient-heading"><Checkbox label={`选择本车型客户（${selectedCustomers.length}/${candidates.length}）`} checked={selected.size === selectable.length && selectable.length > 0 ? true : selected.size ? 'mixed' : false} disabled={locked||!selectable.length} onChange={(_,d)=>setSelected(d.checked === true ? new Set(selectable.map(c=>c.id)) : new Set())}/><span>预计发送 {eligible.length} 位</span></div>
          <div className="bulk-recipients" aria-label="群发客户选择">{candidates.map(c=><div key={c.id}><Checkbox label={`${c.name}（${c.country || '国家未填'}）`} checked={selected.has(c.id)} disabled={locked||!selectable.some(item=>item.id===c.id)} onChange={(_,d)=>setSelected(previous=>{ const next=new Set(previous); if(d.checked)next.add(c.id);else next.delete(c.id);return next; })}/><small>{recent(c,Number(cooldown)) ? '最近联系未满排除天数，暂不可选' : `${c.contactHistory?.length || 0} 次联系`}</small></div>)}{!candidates.length && <p>当前车型没有客户，请返回列表导入。</p>}</div>
          </>}
        </section>
        <section className="bulk-section"><div className="bulk-section-title"><span>02</span><h2>消息与模板</h2></div>
          <div className="bulk-two-fields"><Field label="选用模板"><Select aria-label="选用模板" value={templateId} disabled={locked} onChange={(_,d)=>{ setTemplateId(d.value);const t=templates.find(t=>t.id===d.value);if(t){setBody(t.body);setTemplateName(t.name);setAttachments([]);void action(async()=>setAttachments(await window.artway.resolveMessageAttachments(t.attachmentIds||[])));}else setTemplateName(''); }}><option value="">自行编写</option>{templates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field><Field label="模板名称"><Input aria-label="模板名称" value={templateName} maxLength={60} disabled={locked} placeholder="例如：T2 外观件初次联系" onChange={(_,d)=>setTemplateName(d.value)}/></Field></div>
          <Field label="消息内容"><Textarea aria-label="群发消息内容" value={body} maxLength={2000} rows={7} resize="vertical" disabled={locked} placeholder="输入要发送的消息，也可以只发送图片或附件。" onChange={(_,d)=>setBody(d.value)}/></Field>
          <div className="bulk-message-tools"><div><Button icon={<ImagePlus size={16}/>} disabled={locked||busy||attachments.length>=10} onClick={()=>void action(async()=>{const added=await window.artway.addMessageAttachments('image');if(attachments.length+added.length>10)throw new Error('最多添加10个文件。');setAttachments(previous=>[...previous,...added]);})}>添加图片</Button><Button icon={<Paperclip size={16}/>} disabled={locked||busy||attachments.length>=10} onClick={()=>void action(async()=>{const added=await window.artway.addMessageAttachments('file');if(attachments.length+added.length>10)throw new Error('最多添加10个文件。');setAttachments(previous=>[...previous,...added]);})}>添加附件</Button></div><small>{body.length}/2000</small></div>
          {attachments.length>0&&<div className="bulk-attachments" aria-label="已添加的图片和附件">{attachments.map(a=><div key={a.id}>{a.previewUrl?<img src={a.previewUrl} alt={a.name}/>:<Paperclip size={22}/>}<div><strong>{a.name}</strong><small>{(a.size/1024/1024).toFixed(2)} MB · {a.kind==='image'?'图片':'附件'}</small></div><Button appearance="subtle" size="small" aria-label={`移除 ${a.name}`} icon={<X size={14}/>} disabled={locked||busy} onClick={()=>setAttachments(previous=>previous.filter(item=>item.id!==a.id))}/></div>)}</div>}
          <div className="bulk-template-tools"><Button icon={<Save size={15}/>} disabled={busy || locked || !hasContent || !templateName.trim()} onClick={()=>saveTemplate()}>保存模板</Button>{templateId && <><Button disabled={busy || locked || !hasContent || !templateName.trim()} onClick={()=>saveTemplate(true)}>另存为新模板</Button><Button appearance="subtle" aria-label="删除消息模板" icon={<Trash2 size={15}/>} disabled={locked} onClick={()=>setDeleteTemplate(true)}/></>}</div>
        </section>
        <section className="bulk-section"><div className="bulk-section-title"><span>03</span><h2>发送设置</h2></div>{mode==='test'&&<p className="bulk-result-footnote">测试模式不受7天联系限制或发送间隔限制，可连续测试。</p>}<div className="bulk-two-fields"><Field label="跳过最近联系过的客户（天）" hint="最少7天，未到期客户不可勾选。"><Input aria-label="跳过联系天数" type="number" min={7} max={365} value={cooldown} disabled={locked||mode==='test'} onChange={(_,d)=>setCooldown(String(Math.min(365,Math.max(7,Math.trunc(Number(d.value)||7)))))}/></Field><Field label="每位客户的发送间隔（分钟）" hint="逐位发送，支持暂停和停止。"><Input aria-label="发送间隔分钟数" type="number" min={1} max={300} value={interval} disabled={locked||mode==='test'} onChange={(_,d)=>setInterval(String(Math.min(300,Math.max(1,Math.trunc(Number(d.value)||1)))))}/></Field></div></section>
        <div className="bulk-start-bar"><p>{mode==='test'?`测试号码：${testPhone?'+'+testPhone:'尚未填写'}，仅发送给这一个号码。`:`选中 ${recipientCount} 位，预计发送 ${sendCount} 位。每次最多 200 位。`}</p><Button appearance="primary" icon={busy ? <Spinner size="tiny"/> : <Send size={16}/>} disabled={busy || locked || !settingsValid || (mode==='customers'&&selectedCustomers.length>200) || !accountId || !hasContent || !sendCount} onClick={()=>setConfirm(true)}>{mode==='test'?'检查并发送测试':'检查并开始发送'}</Button></div>
      </div>
      <aside className="bulk-aside">
        <section className="bulk-preview"><div className="bulk-section-title"><MessageSquareText size={17}/><h2>消息预览</h2></div><div className="bulk-preview-recipient"><strong>{mode==='test'?(testPhone?'+'+testPhone:'测试号码'):preview?.name || '尚未选择客户'}</strong><small>{accounts.find(a=>a.id===accountId)?.name || '尚未选择账号'}</small></div><div className="bulk-chat-surface"><div className="bulk-chat-bubble">{body || (attachments.length?'':'在左侧输入消息或添加图片、附件。')}{attachments.map(a=><div className="bulk-preview-attachment" key={a.id}>{a.previewUrl?<img src={a.previewUrl} alt={a.name}/>:<Paperclip size={16}/>}<span>{a.name}</span></div>)}</div></div><small>按当前内容发送。文字、图片、附件会依次发出，全部确认成功后记录一次联系。</small></section>
        <section className="bulk-results" aria-label="群发任务结果"><div className="bulk-section-title"><h2>发送任务</h2>{job && <span>{jobLabels[job.status]}</span>}</div>
          <Select aria-label="查看群发记录" value={jobId} onChange={(_,d)=>setJobId(d.value)}><option value="">尚无任务</option>{jobs.map(j=><option key={j.id} value={j.id}>{j.title} · {new Date(j.createdAt).toLocaleDateString('zh-CN')}</option>)}</Select>
          {job ? <><div className="bulk-result-counts"><span>成功 <strong>{counts.succeeded}</strong></span><span>失败 <strong>{counts.failed}</strong></span><span>待核实 <strong>{counts.unconfirmed}</strong></span><span>跳过 <strong>{counts.skipped + counts.cancelled}</strong></span></div><progress aria-label="群发进度" max={job.rows.length} value={job.rows.length-counts.pending-counts.sending}/>
          {['running','paused'].includes(job.status) && <div className="bulk-task-controls"><Button disabled={busy} icon={job.status==='running'?<Pause size={14}/>:<Play size={14}/>} onClick={()=>void action(async()=>{mergeJob(await window.artway.controlCampaign(job.id,job.status==='running'?'pause':'resume'));})}>{job.status==='running'?'暂停任务':'继续待发送客户'}</Button><Button disabled={busy} icon={<Square size={13}/>} onClick={()=>void action(async()=>{mergeJob(await window.artway.controlCampaign(job.id,'cancel'));})}>停止任务</Button></div>}
          <div className="bulk-result-list">{job.rows.map(row=><div key={row.id} className={`bulk-result-row result-${row.status}`}><div><strong>{row.name}</strong><span>{statuses[row.status]}</span></div><small>{row.status==='succeeded' ? `${row.noCustomerContact ? '测试发送成功，未新建客户' : row.contactRecorded ? '联系次数已 +1' : '联系记录待处理'} · ${row.sentDate}` : row.reason || (row.status==='sending'?'正在等待 WhatsApp 确认':'尚未发送')}{row.status==='succeeded' && row.reason ? ` · ${row.reason}`:''}</small></div>)}</div></> : <p className="bulk-empty-results">任务开始后，这里会逐位显示发送结果。成功表示 WhatsApp 已确认发出，不代表对方已读。</p>}
          <p className="bulk-result-footnote">失败、待核实均不增加联系次数，也不会自动重发。暂停或停止在当前客户处理结束后生效。</p>
        </section>
      </aside>
    </div>}
    <Dialog open={confirm} onOpenChange={(_,d)=>!busy&&setConfirm(d.open)}><DialogSurface><DialogBody><DialogTitle>{mode==='test'?'确认发送测试':'确认开始群发'}</DialogTitle><DialogContent><p>发送账号：{accounts.find(a=>a.id===accountId)?.name}</p><p>{mode==='test'?`只发送到测试号码 +${testPhone}`:`选中 ${recipientCount} 位客户，预计发送 ${sendCount} 位；其余按设置跳过。`}</p><div className="bulk-confirm-body">{body}{attachments.length>0&&<p>图片 / 附件：{attachments.map(a=>a.name).join("、")}</p>}</div><p>消息会实际发送。仅成功记录联系，失败或待核实不计数。</p></DialogContent><DialogActions><Button disabled={busy} onClick={()=>setConfirm(false)}>返回检查</Button><Button appearance="primary" disabled={busy} onClick={start}>{mode==='test'?'确认发送到测试号码':'确认开始发送'}</Button></DialogActions></DialogBody></DialogSurface></Dialog>
    <Dialog open={deleteTemplate} onOpenChange={(_,d)=>!busy&&setDeleteTemplate(d.open)}><DialogSurface><DialogBody><DialogTitle>删除消息模板？</DialogTitle><DialogContent>只删除保存的模板，已经创建的任务记录会保留。</DialogContent><DialogActions><Button onClick={()=>setDeleteTemplate(false)}>取消</Button><Button appearance="primary" disabled={busy} onClick={()=>void action(async()=>{const state=await window.artway.removeMessageTemplate(templateId);setTemplates(state.templates);setTemplateId('');setDeleteTemplate(false);setNotice('模板已删除。');})}>删除模板</Button></DialogActions></DialogBody></DialogSurface></Dialog>
  </section>;
}

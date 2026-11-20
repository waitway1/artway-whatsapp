import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, Select, Spinner, Textarea, Tooltip } from "@fluentui/react-components";
import { Download, FileSpreadsheet, Search, UsersRound, MessageSquareText, Trash2, Save, Clock3, Send } from "lucide-react";
import { BulkCampaignPage } from "./BulkCampaignPage";
import type { Customer, CustomerDraft, WhatsAppAccount } from "./types";

interface Props {
  customers: Customer[]; accounts: WhatsAppAccount[]; activeId: string | null; loading: boolean;
  onImport: () => void; onCustomers: (items: Customer[]) => void; onChat: (accountId: string) => void;
}

export function CustomerPage({ customers, accounts, activeId, loading, onImport, onCustomers, onChat }: Props) {
  const [bulkOpen, setBulkOpen] = useState(false);
  const [modelFilter, setModelFilter] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CustomerDraft>({ name: "", country: "" });
  const [accountId, setAccountId] = useState(activeId || accounts[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [contactOpen, setContactOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const selected = customers.find((item) => item.id === selectedId);
  const models = useMemo(() => [...new Set(customers.flatMap((item) => item.models || []))].sort(), [customers]);
  const activeModel = modelFilter === "__unclassified" || models.includes(modelFilter) ? modelFilter : models[0] || "__unclassified";
  const filtered = useMemo(() => customers.filter((item) => (activeModel === "__unclassified" ? !item.models?.length : item.models?.includes(activeModel)) && `${item.name} ${item.country} ${item.phone || ""} ${item.contact || ""} ${item.notes || ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim())), [customers, query, activeModel]);
  useEffect(() => {
    setDraft(selected ? { models: selected.models || [], name: selected.name, country: selected.country, phone: selected.phone || "", status: selected.status || "new", notes: selected.notes || "", contact: selected.contact || "" } : { name: "", country: "" });
    setError("");
  }, [selected]);
  useEffect(() => { if (!accounts.some((item) => item.id === accountId)) setAccountId(activeId || accounts[0]?.id || ""); }, [accounts, activeId, accountId]);
  const dirty = Boolean(selected && (JSON.stringify(draft.models || []) !== JSON.stringify(selected.models || []) || (draft.contact || "") !== (selected.contact || "") || draft.name !== selected.name || draft.country !== selected.country || (draft.phone || "") !== (selected.phone || "") || (draft.status || "new") !== (selected.status || "new") || (draft.notes || "") !== (selected.notes || "")));
  const act = async (action: () => Promise<void>) => {
    setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : "操作失败，请重试。"); }
    finally { setBusy(false); }
  };
  if (bulkOpen) return <BulkCampaignPage candidates={filtered} accounts={accounts} activeId={activeId} modelName={activeModel} onBack={() => setBulkOpen(false)} />;
  return <section className="customers-page" aria-label="客户管理页面">
    <div className="customers-heading">
      <div><div className="customers-eyebrow">客户工作区</div><h1>每一次联系，都有记录。</h1><p>管理客户资料与跟进进度，在账号内继续沟通。</p></div>
      <div className="customer-template-actions">
        <Button appearance="primary" icon={<Send size={16} />} disabled={loading || busy || dirty} onClick={() => setBulkOpen(true)}>群发消息</Button>
        <Button icon={<Download size={17} />} disabled={busy} onClick={() => void act(async () => { const result = await window.artway.downloadCustomerTemplate(); if (!result.cancelled) setNotice("模板已保存，请在“客户名单”中填写资料，填写规则见“填写说明”。"); })}>下载模板</Button>
      </div>
    </div>
    {notice && <div className="customer-inline-notice" role="status">{notice}</div>}
    {error && <div className="customer-inline-error" role="alert">{error}</div>}
    <nav className="customer-model-tabs" aria-label="按车型分类">
      {models.map((model) => <Button key={model} aria-label={`筛选车型 ${model}`} aria-pressed={activeModel === model} appearance={activeModel === model ? "primary" : "subtle"} onClick={() => { setModelFilter(model); setSelectedId(null); }}>{model} <span>{customers.filter(c => c.models?.includes(model)).length}</span></Button>)}
      <Button appearance={activeModel === "__unclassified" ? "primary" : "subtle"} aria-pressed={activeModel === "__unclassified"} onClick={() => { setModelFilter("__unclassified"); setSelectedId(null); }}>未分类 <span>{customers.filter(c => !c.models?.length).length}</span></Button>
    </nav>
    <div className="customer-filters">
      <Input aria-label="搜索客户" contentBefore={<Search size={16} />} placeholder="搜索客户、联系人、号码或备注" value={query} onChange={(_, d) => setQuery(d.value)} />
      <span className="customer-result-count">{filtered.length} 位客户</span>
      <Button appearance="subtle" icon={<FileSpreadsheet size={16} />} onClick={onImport} disabled={loading || busy}>导入客户</Button>
    </div>
    <div className={`customer-workbench ${selected ? "has-detail" : ""}`}>
      <div className="customer-table-container">
        {loading ? <div className="customer-page-empty"><Spinner label="正在载入客户" /></div> : customers.length === 0 ? <div className="customer-page-empty"><UsersRound size={32} /><h2>把客户带进工作区</h2><p>下载模板填写客户资料，再通过列表工具栏的“导入客户”上传。</p><small>必填：名称、国家、号码</small></div> : filtered.length === 0 ? <div className="customer-page-empty"><Search size={28} /><h2>没有匹配的客户</h2><Button onClick={() => { setQuery(""); }}>清除筛选</Button></div> :
        <table className="customer-table"><colgroup>{[0,1,2,3,4].map(column => <col key={column} style={{width:"20%"}} />)}</colgroup><thead><tr><th>客户名称</th><th>国家</th><th>WhatsApp</th><th>联系次数</th><th>操作</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id} className={selectedId === item.id ? "selected" : ""}><td><button className="customer-name-button" disabled={busy} onClick={() => setSelectedId(item.id)}>{item.name}</button></td><td><span className="customer-model-label">{item.country || "未填写"}</span></td><td className="customer-phone">{item.phone ? `+${item.phone}` : <span className="muted">未填写</span>}</td><td><div className="customer-contact-count"><span>{item.contactHistory?.length || 0} 次</span><Tooltip relationship="description" content={<ContactDates history={item.contactHistory || []} />}><Button appearance="subtle" size="small" icon={<Clock3 size={15} />} aria-label={`查看 ${item.name} 的联系日期`} /></Tooltip></div></td><td><Button size="small" appearance="subtle" disabled={busy} onClick={() => setSelectedId(item.id)}>查看 / 编辑</Button></td></tr>)}</tbody></table>}
      </div>
      {selected && <aside className="customer-detail" aria-label="客户详情">
        <div className="customer-detail-heading"><div><small>客户详情</small><h2>{selected.name}</h2></div><Button appearance="subtle" disabled={busy} onClick={() => setSelectedId(null)}>收起</Button></div>
        <form onSubmit={(e) => { e.preventDefault(); void act(async () => { onCustomers(await window.artway.updateCustomer(selected.id, draft)); setNotice("客户资料已保存。"); }); }}>
          <Field label="客户名称" required><Input aria-label="客户名称" required maxLength={100} value={draft.name} onChange={(_, d) => setDraft({ ...draft, name: d.value })} /></Field>
          <Field label="车型分类" hint="多个车型用逗号分隔。留空归入未分类。"><Input aria-label="车型分类" value={(draft.models || []).join(",")} onChange={(_, d) => setDraft({ ...draft, models: d.value ? d.value.split(/[,，]/) : [] })} /></Field>
          <Field label="联系人"><Input aria-label="联系人" maxLength={100} value={draft.contact || ""} onChange={(_, d) => setDraft({ ...draft, contact: d.value })} /></Field>
          <Field label="国家 / 地区"><Input aria-label="国家 / 地区" placeholder="待补充" maxLength={40} value={draft.country} onChange={(_, d) => setDraft({ ...draft, country: d.value })} /></Field>
          <Field label="WhatsApp 号码" hint="包含国际区号，例如 +61412345678"><Input aria-label="WhatsApp 号码" value={draft.phone || ""} onChange={(_, d) => setDraft({ ...draft, phone: d.value })} /></Field>
          <Field label="跟进备注"><Textarea aria-label="跟进备注" resize="vertical" rows={3} maxLength={4000} placeholder="记录客户需求、沟通结果和下一步…" value={draft.notes || ""} onChange={(_, d) => setDraft({ ...draft, notes: d.value })} /></Field>
          <Button type="submit" appearance="primary" disabled={busy || !dirty} icon={busy ? <Spinner size="tiny" /> : <Save size={16} />}>保存资料</Button>
        </form>
        <section className="customer-contact-history" aria-label="联系记录"><div><strong>已联系 {selected.contactHistory?.length || 0} 次</strong><Button size="small" disabled={busy || dirty} onClick={() => setContactOpen(true)}>记录一次联系</Button></div><ContactDates history={selected.contactHistory || []} /></section>
        <div className="customer-chat-actions"><Field label="使用账号"><Select aria-label="使用账号" disabled={!accounts.length} value={accountId} onChange={(_, d) => setAccountId(d.value)}>{!accounts.length && <option value="">请先添加账号</option>}{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
        <Button icon={<MessageSquareText size={16} />} disabled={busy || !selected.phone || !accountId || dirty} onClick={() => void act(async () => { await window.artway.openCustomerChat(selected.id, accountId); onChat(accountId); })}>打开 WhatsApp 会话</Button><small>{dirty ? "保存修改后即可打开会话。" : "在选定账号内打开会话，消息由你确认发送。"}</small></div>
        <div className="customer-detail-footer"><small>导入于 {new Date(selected.createdAt).toLocaleDateString("zh-CN")}</small><Button appearance="subtle" disabled={busy} icon={<Trash2 size={15} />} onClick={() => setDeleteOpen(true)}>删除客户</Button></div>
      </aside>}
    </div>
    <Dialog open={contactOpen} onOpenChange={(_, d) => !busy && setContactOpen(d.open)}><DialogSurface><DialogBody><DialogTitle>记录一次联系？</DialogTitle><DialogContent>为“{selected?.name}”增加 1 次联系，日期记录为今天。</DialogContent><DialogActions><Button disabled={busy} onClick={() => setContactOpen(false)}>取消</Button><Button appearance="primary" disabled={busy} onClick={() => selected && void act(async () => { onCustomers(await window.artway.recordCustomerContact(selected.id)); setContactOpen(false); setNotice("已记录今天的联系。"); })}>确认记录</Button></DialogActions></DialogBody></DialogSurface></Dialog>
    <Dialog open={deleteOpen} onOpenChange={(_, d) => !busy && setDeleteOpen(d.open)}><DialogSurface><DialogBody><DialogTitle>删除客户？</DialogTitle><DialogContent>将删除“{selected?.name}”的本地资料，并在后续导入中自动跳过该客户。WhatsApp 聊天记录不受影响。</DialogContent><DialogActions><Button disabled={busy} onClick={() => setDeleteOpen(false)}>取消</Button><Button appearance="primary" disabled={busy} onClick={() => selected && void act(async () => { onCustomers(await window.artway.removeCustomer(selected.id)); setDeleteOpen(false); setSelectedId(null); })}>确认删除</Button></DialogActions></DialogBody></DialogSurface></Dialog>
  </section>;
}

function ContactDates({ history }: { history: NonNullable<Customer["contactHistory"]> }) {
  const grouped = new Map<string, number>();
  history.forEach(entry => grouped.set(entry.date, (grouped.get(entry.date) || 0) + 1));
  return <div className="contact-date-list">{grouped.size ? [...grouped].sort(([a], [b]) => b.localeCompare(a)).map(([date, count]) => <div key={date}>{date}{count > 1 ? `（${count} 次）` : ""}</div>) : <span>暂无联系记录</span>}</div>;
}

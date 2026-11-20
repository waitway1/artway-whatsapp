import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Select,
  Skeleton,
  SkeletonItem,
  Spinner,
  Text,
} from "@fluentui/react-components";
import {
  FileSpreadsheet,
  Info,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserRoundPlus,
  UsersRound,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CustomerPage } from "./CustomerPage";
import type {
  AccountRuntimeStatus,
  AccountStatusEvent,
  BrowserBounds,
  Customer,
  CustomerImportResult,
  CustomerImportSelection,
  ProfileRegion,
  WhatsAppAccount,
} from "./types";

const iconSize = 18;

const regionOptions: Array<{ value: ProfileRegion; label: string }> = [
  { value: "local", label: "跟随本机" },
  { value: "zh-CN", label: "中国大陆" },
  { value: "en-US", label: "美国东部" },
  { value: "en-GB", label: "英国" },
  { value: "de-DE", label: "德国" },
];

const statusLabels: Record<AccountRuntimeStatus, string> = {
  idle: "未打开",
  loading: "正在打开",
  ready: "已打开",
  error: "打开失败",
};

function initials(name: string) {
  return name.trim().slice(0, 2).toUpperCase() || "WA";
}

function statusFromMap(statuses: Record<string, AccountRuntimeStatus>, id: string) {
  return statuses[id] ?? "idle";
}

export function App() {
  const [accounts, setAccounts] = useState<WhatsAppAccount[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, AccountRuntimeStatus>>({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [page, setPage] = useState<"accounts" | "customers">("accounts");
  const [customersOpen, setCustomersOpen] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [profileOpen, setProfileOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WhatsAppAccount | null>(null);
  const [renameTarget, setRenameTarget] = useState<WhatsAppAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const browserHostRef = useRef<HTMLDivElement>(null);

  const activeAccount = useMemo(
    () => accounts.find((account) => account.id === activeId) ?? null,
    [accounts, activeId],
  );

  const reportError = useCallback((reason: unknown) => {
    setError(reason instanceof Error ? reason.message : "操作没有完成，请重试。");
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([window.artway.listAccounts(), window.artway.listCustomers()])
      .then(([items, customerItems]) => {
        if (cancelled) return;
        setAccounts(items);
        setCustomers(customerItems);
        setActiveId(items[0]?.id ?? null);
      })
      .catch(reportError)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reportError]);

  // Keep customer data current even while the customer page is unmounted.
  useEffect(() => {
    let live = true;
    let request = 0;
    const refresh = () => {
      const version = ++request;
      void window.artway.listCustomers().then(items => {
        if (live && version === request) setCustomers(items);
      }).catch(reason => { if (live) reportError(reason); });
    };
    const unsubscribe = window.artway.onCampaignUpdate(job => {
      if (job.rows.some(row => row.status === 'succeeded' && row.contactRecorded)) refresh();
    });
    if (page === 'customers') refresh();
    return () => { live = false; unsubscribe(); };
  }, [page, reportError]);

  useEffect(() => {
    return window.artway.onAccountStatus((event: AccountStatusEvent) => {
      setStatuses((current) => ({ ...current, [event.accountId]: event.status }));
      if (event.status === "error" && event.detail) setError(event.detail);
    });
  }, []);

  useEffect(() => {
    if (!activeId) {
      void window.artway.setBrowserVisible(false);
      return;
    }
    let cancelled = false;
    window.artway.activateAccount(activeId).catch((reason) => {
      if (!cancelled) reportError(reason);
    });
    return () => {
      cancelled = true;
    };
  }, [activeId, reportError]);

  useEffect(() => {
    const isDialogOpen = addOpen || customersOpen || profileOpen || Boolean(deleteTarget) || Boolean(renameTarget);
    void window.artway.setBrowserVisible(Boolean(activeId) && page === "accounts" && !isDialogOpen);
  }, [activeId, page, addOpen, customersOpen, deleteTarget, profileOpen, renameTarget]);

  useEffect(() => {
    const host = browserHostRef.current;
    if (!host) return;

    const updateBounds = () => {
      const rect = host.getBoundingClientRect();
      const bounds: BrowserBounds = {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.max(0, Math.round(rect.width)),
        height: Math.max(0, Math.round(rect.height)),
      };
      void window.artway.setBrowserBounds(bounds);
    };

    const observer = new ResizeObserver(updateBounds);
    observer.observe(host);
    updateBounds();
    return () => observer.disconnect();
  }, [sidebarOpen, activeId, page]);

  const handleCreate = async (name: string, region: ProfileRegion) => {
    setBusy(true);
    setError(null);
    try {
      const account = await window.artway.createAccount({ name, region });
      setAccounts((current) => [...current, account]);
      setActiveId(account.id);
      setPage("accounts");
      setAddOpen(false);
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy(false);
    }
  };

  const handleSelectCustomerExcel = async (): Promise<CustomerImportSelection> => {
    setBusy(true);
    setError(null);
    try {
      return await window.artway.selectCustomerExcel();
    } catch (reason) {
      reportError(reason);
      throw reason;
    } finally {
      setBusy(false);
    }
  };

  const handleImportCustomers = async (token: string, model: string): Promise<CustomerImportResult> => {
    setBusy(true);
    setError(null);
    try {
      const report = await window.artway.importCustomers(token, model);
      setCustomers(report.customers);
      setPage("customers");
      return report;
    } catch (reason) {
      reportError(reason);
      throw reason;
    } finally {
      setBusy(false);
    }
  };

  const handleRename = async (name: string) => {
    if (!renameTarget) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await window.artway.renameAccount({ id: renameTarget.id, name });
      setAccounts((current) => current.map((account) => (account.id === updated.id ? updated : account)));
      setRenameTarget(null);
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    setError(null);
    try {
      await window.artway.removeAccount(deleteTarget.id);
      const nextAccounts = accounts.filter((account) => account.id !== deleteTarget.id);
      setAccounts(nextAccounts);
      if (activeId === deleteTarget.id) setActiveId(nextAccounts[0]?.id ?? null);
      setStatuses((current) => {
        const next = { ...current };
        delete next[deleteTarget.id];
        return next;
      });
      setDeleteTarget(null);
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={`app-shell ${sidebarOpen ? "sidebar-is-open" : "sidebar-is-closed"}`}>
      <aside className="sidebar" aria-label="WhatsApp 账号">
        {sidebarOpen && (
          <div className="sidebar-heading">
            <Text weight="semibold">账号</Text>
            <Text size={200}>{accounts.length}</Text>
          </div>
        )}

        <div className="account-list" role="list">
          {loading && <AccountListSkeleton expanded={sidebarOpen} />}
          {!loading && accounts.map((account) => {
            const status = statusFromMap(statuses, account.id);
            return (
              <div
                key={account.id}
                className={`account-row ${activeId === account.id ? "is-active" : ""}`}
                role="listitem"
              >
                <button
                  className="account-main"
                  type="button"
                  aria-label={`打开 ${account.name}`}
                  aria-current={activeId === account.id ? "page" : undefined}
                  onClick={() => { setPage("accounts"); setActiveId(account.id); }}
                >
                  <span className="account-avatar">{initials(account.name)}</span>
                  {sidebarOpen && (
                    <span className="account-copy">
                      <span className="account-name">{account.name}</span>
                      <span className={`account-status status-${status}`}>{statusLabels[status]}</span>
                    </span>
                  )}
                </button>
                {sidebarOpen && (
                  <Menu positioning="before-top">
                    <MenuTrigger disableButtonEnhancement>
                      <Button
                        appearance="subtle"
                        size="small"
                        icon={<MoreHorizontal size={iconSize} />}
                        aria-label={`${account.name} 更多操作`}
                      />
                    </MenuTrigger>
                    <MenuPopover>
                      <MenuList>
                        <MenuItem onClick={() => setRenameTarget(account)}>重命名</MenuItem>
                        <MenuItem icon={<Trash2 size={16} />} onClick={() => setDeleteTarget(account)}>
                          删除账号档案
                        </MenuItem>
                      </MenuList>
                    </MenuPopover>
                  </Menu>
                )}
              </div>
            );
          })}
        </div>

        <div className="sidebar-footer">
          <Button
            appearance="subtle"
            icon={sidebarOpen ? <PanelLeftClose size={iconSize} /> : <PanelLeftOpen size={iconSize} />}
            aria-label={sidebarOpen ? "收起账号栏" : "展开账号栏"}
            title={sidebarOpen ? "收起账号栏" : "展开账号栏"}
            onClick={() => setSidebarOpen((current) => !current)}
          />
          {sidebarOpen && (
            <Button appearance="primary" icon={<Plus size={iconSize} />} onClick={() => setAddOpen(true)}>
              添加账号
            </Button>
          )}
        </div>
      </aside>

      <section className="workspace" aria-label="账号工作区">
        <header className="workspace-toolbar">
          <div className="toolbar-title">
            <Text weight="semibold" size={400}>
              {page === "customers" ? "客户管理" : activeAccount?.name ?? "WhatsApp 账号"}
            </Text>
            {page === "accounts" && activeAccount && (
              <Text size={200} className="toolbar-meta">
                独立浏览器档案 {activeAccount.fingerprint.profileCode}
              </Text>
            )}
          </div>
          <div className="toolbar-actions">
            <Button
              appearance="subtle"
              icon={<UsersRound size={iconSize} />}
              aria-label="客户名单"
              title="客户名单"
              onClick={() => setPage("customers")}
            />
            {page === "customers" && <Button appearance="subtle" onClick={() => setPage("accounts")}>返回账号</Button>}
            {page === "accounts" && activeAccount && (
              <>
                <Button
                  appearance="subtle"
                  icon={<Info size={iconSize} />}
                  aria-label="查看浏览器档案"
                  title="查看浏览器档案"
                  onClick={() => setProfileOpen(true)}
                />
                <Button
                  appearance="subtle"
                  icon={<RefreshCw size={iconSize} />}
                  aria-label="刷新 WhatsApp Web"
                  title="刷新 WhatsApp Web"
                  onClick={() => void window.artway.reloadActiveAccount().catch(reportError)}
                />
              </>
            )}
          </div>
        </header>

        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <Button
              appearance="subtle"
              size="small"
              icon={<X size={16} />}
              aria-label="关闭错误提示"
              onClick={() => setError(null)}
            />
          </div>
        )}

        {page === "accounts" && !loading && !activeAccount && (
          <div className="empty-state">
            <div className="empty-icon" aria-hidden="true">
              <UserRoundPlus size={28} strokeWidth={1.6} />
            </div>
            <Text as="h1" size={600} weight="semibold">
              添加你的第一个账号
            </Text>
            <Text className="empty-copy">
              每个账号拥有独立的 Cookie、缓存和站点存储，登录状态互不影响。
            </Text>
            <Button appearance="primary" size="large" icon={<Plus size={iconSize} />} onClick={() => setAddOpen(true)}>
              添加账号
            </Button>
          </div>
        )}

        {loading && (
          <div className="workspace-loading" aria-label="正在载入账号">
            <Skeleton className="workspace-skeleton">
              <SkeletonItem shape="rectangle" />
            </Skeleton>
          </div>
        )}

        {page === "customers" && <CustomerPage
          customers={customers} accounts={accounts} activeId={activeId} loading={loading}
          onImport={() => setCustomersOpen(true)} onCustomers={setCustomers}
          onChat={(accountId) => { setActiveId(accountId); setPage("accounts"); }}
        />}
        <div ref={browserHostRef} className={`browser-host ${activeAccount && page === "accounts" ? "is-active" : ""}`} aria-hidden="true" />
      </section>

      <AccountFormDialog
        open={addOpen}
        title="添加 WhatsApp 账号"
        confirmLabel="创建并打开"
        busy={busy}
        onOpenChange={setAddOpen}
        onSubmit={handleCreate}
      />

      <AccountFormDialog
        open={Boolean(renameTarget)}
        title="重命名账号"
        confirmLabel="保存"
        initialName={renameTarget?.name}
        hideRegion
        busy={busy}
        onOpenChange={(open) => !open && setRenameTarget(null)}
        onSubmit={(name) => handleRename(name)}
      />

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(_, data) => !data.open && setDeleteTarget(null)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>删除账号档案</DialogTitle>
            <DialogContent>
              删除“{deleteTarget?.name}”会清除这个档案保存的 WhatsApp 登录状态、Cookie 和本地存储。此操作无法撤销。
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button appearance="secondary" disabled={busy}>取消</Button>
              </DialogTrigger>
              <Button appearance="primary" disabled={busy} icon={busy ? <Spinner size="tiny" /> : <Trash2 size={16} />} onClick={handleDelete}>
                删除档案
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <CustomerDirectoryDialog
        open={customersOpen}
        customers={customers}
        busy={busy}
        onOpenChange={setCustomersOpen}
        onSelectExcel={handleSelectCustomerExcel}
        onImport={handleImportCustomers}
      />

      <ProfileDialog account={activeAccount} open={profileOpen} onOpenChange={setProfileOpen} />
    </main>
  );
}

function AccountListSkeleton({ expanded }: { expanded: boolean }) {
  return (
    <div className="account-skeletons" aria-label="正在载入账号列表">
      {[0, 1, 2].map((item) => (
        <Skeleton key={item} className="account-skeleton">
          <SkeletonItem shape="circle" size={32} />
          {expanded && <SkeletonItem shape="rectangle" className="account-skeleton-line" />}
        </Skeleton>
      ))}
    </div>
  );
}

interface CustomerDirectoryDialogProps {
  open: boolean;
  customers: Customer[];
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectExcel: () => Promise<CustomerImportSelection>;
  onImport: (token: string, model: string) => Promise<CustomerImportResult>;
}

function CustomerDirectoryDialog({
  open,
  customers,
  busy,
  onOpenChange,
  onSelectExcel,
  onImport,
}: CustomerDirectoryDialogProps) {
  const [model, setModel] = useState("");
  const [preview, setPreview] = useState<CustomerImportSelection | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPreview(null);
      setModel("");
      setSummary(null);
    }
  }, [open]);

  const [importError, setImportError] = useState("");
  useEffect(() => { if (!open) setImportError(""); }, [open]);
  const selectExcel = () => {
    setPreview(null); setSummary(null); setImportError("");
    void onSelectExcel().then((selection) => {
      if (!selection.cancelled) { setPreview(selection); if (selection.suggestedModel) setModel(selection.suggestedModel); }
    }).catch((reason) => setImportError(reason instanceof Error ? reason.message : "上传失败，请重试。"));
  };

  const importPreview = () => {
    if (!preview?.token || !model.trim()) return;
    setImportError("");
    void onImport(preview.token, model.trim()).then((report) => {
      setSummary(`已添加 ${report.created} 位客户，跳过 ${report.skippedDuplicate} 条重复号码。${report.skippedDeleted ? ` 已跳过 ${report.skippedDeleted} 位已删除客户。` : ""}${report.updatedCategories ? ` 已为 ${report.updatedCategories} 位已有客户补充车型分类。` : ""}`);
      setPreview(null);
    }).catch((reason) => { setPreview(null); setImportError(reason instanceof Error ? reason.message : "导入失败，请重新上传。"); });
  };

  return (
    <Dialog open={open} onOpenChange={(_, data) => onOpenChange(data.open)}>
      <DialogSurface className="customer-directory-dialog">
        <DialogBody>
          <DialogTitle>上传客户模板</DialogTitle>
          <DialogContent className="customer-directory-content">
            <div className="customer-import-toolbar">
              <div>
                <Text weight="semibold">已保存 {customers.length} 位客户</Text>
                <Text className="customer-import-copy">请使用新版 .xlsx 模板，在“客户名单”中填写资料。仅填写名称、国家、号码三列，三项均为必填。请保留工作表和三列表头。</Text>
              </div>
              <Button
                appearance="primary"
                icon={<FileSpreadsheet size={16} />}
                disabled={busy}
                onClick={selectExcel}
              >
                选择文件
              </Button>
            </div>

            <Field label="所属车型" required hint="整批客户归入此车型；同一客户可属于多个车型。">
              <Input aria-label="所属车型" value={model} maxLength={60} placeholder="例如 Ford Ranger T9 或 Jetour T2" disabled={busy} onChange={(_, data) => setModel(data.value)} />
            </Field>
            {preview && (
              <section className="customer-import-preview" aria-label="客户导入预览">
                <div className="customer-import-preview-heading">
                  <div>
                    <Text weight="semibold">导入预览</Text>
                    <Text className="customer-import-copy">{preview.fileName} · {preview.sheetName}</Text>
                  </div>
                  <Text className="customer-import-count">{preview.candidateCount} 条可导入</Text>
                </div>
                <div className="customer-preview-list">
                  {preview.customers?.map((customer) => (
                    <div key={`${customer.displayName}-${preview.customers?.indexOf(customer)}`} className="customer-preview-row">
                      <span>{customer.displayName}</span>
                    </div>
                  ))}
                </div>
                {(preview.candidateCount ?? 0) > (preview.customers?.length ?? 0) && (
                  <Text className="customer-import-copy">仅显示前 6 条记录。</Text>
                )}
                <Text className="customer-import-copy">模板与号码校验通过，可确认导入。重复号码和已删除客户会自动跳过。</Text>
              </section>
            )}

            {summary && <div className="customer-import-summary" role="status">{summary}</div>}

            {importError && <div className="customer-inline-error" role="alert">{importError}</div>}
          </DialogContent>
          <DialogActions>
            <DialogTrigger disableButtonEnhancement>
              <Button appearance="secondary" disabled={busy}>关闭</Button>
            </DialogTrigger>
            {preview && (
              <Button
                appearance="primary"
                icon={busy ? <Spinner size="tiny" /> : <FileSpreadsheet size={16} />}
                disabled={busy || !model.trim()}
                onClick={importPreview}
              >
                确认导入 {preview.candidateCount} 条
              </Button>
            )}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

interface AccountFormDialogProps {
  open: boolean;
  title: string;
  confirmLabel: string;
  initialName?: string;
  hideRegion?: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string, region: ProfileRegion) => Promise<void> | void;
}

function AccountFormDialog({
  open,
  title,
  confirmLabel,
  initialName = "",
  hideRegion = false,
  busy,
  onOpenChange,
  onSubmit,
}: AccountFormDialogProps) {
  const [name, setName] = useState(initialName);
  const [region, setRegion] = useState<ProfileRegion>("local");
  const [nameError, setNameError] = useState("");

  useEffect(() => {
    if (open) {
      setName(initialName);
      setRegion("local");
      setNameError("");
    }
  }, [initialName, open]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const cleanName = name.trim();
    if (cleanName.length < 2) {
      setNameError("请输入至少 2 个字符。");
      return;
    }
    void onSubmit(cleanName, region);
  };

  return (
    <Dialog open={open} onOpenChange={(_, data) => onOpenChange(data.open)}>
      <DialogSurface>
        <form onSubmit={submit}>
          <DialogBody>
            <DialogTitle>{title}</DialogTitle>
            <DialogContent className="account-dialog-content">
              <div className="dialog-assurance">
                <ShieldCheck size={20} />
                <span>这个账号将使用独立的本地浏览器档案。</span>
              </div>
              <Field label="账号名称" validationMessage={nameError} validationState={nameError ? "error" : "none"}>
                <Input
                  value={name}
                  autoFocus
                  maxLength={40}
                  placeholder="例如：欧洲销售 01"
                  onChange={(_, data) => {
                    setName(data.value);
                    if (nameError) setNameError("");
                  }}
                />
              </Field>
              {!hideRegion && (
                <Field
                  label="浏览器地区"
                  hint="同步设置浏览器语言和时区。网络出口仍使用本机网络。"
                >
                  <Select value={region} onChange={(_, data) => setRegion(data.value as ProfileRegion)}>
                    {regionOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </Select>
                </Field>
              )}
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button appearance="secondary" disabled={busy}>取消</Button>
              </DialogTrigger>
              <Button type="submit" appearance="primary" disabled={busy} icon={busy ? <Spinner size="tiny" /> : <Plus size={16} />}>
                {confirmLabel}
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}

function ProfileDialog({ account, open, onOpenChange }: { account: WhatsAppAccount | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  if (!account) return null;
  const profile = account.fingerprint;
  const details = [
    ["档案编号", profile.profileCode],
    ["会话存储", "独立持久分区"],
    ["语言", profile.locale],
    ["时区", profile.timezone],
    ["处理器线程", String(profile.hardwareConcurrency)],
    ["窗口尺寸", "跟随工作区"],
    ["网络", "本机网络"],
  ];

  return (
    <Dialog open={open} onOpenChange={(_, data) => onOpenChange(data.open)}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>浏览器档案</DialogTitle>
          <DialogContent>
            <Text className="profile-intro">
              此档案只负责隔离登录数据并保持浏览器参数一致，不包含自动操作。
            </Text>
            <dl className="profile-grid">
              {details.map(([label, value]) => (
                <div key={label} className="profile-row">
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </DialogContent>
          <DialogActions>
            <DialogTrigger disableButtonEnhancement>
              <Button appearance="primary">完成</Button>
            </DialogTrigger>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

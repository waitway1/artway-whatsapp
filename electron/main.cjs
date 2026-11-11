const path = require("node:path");
const fs = require("node:fs/promises");
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  session,
  WebContentsView,
  Tray,
  Menu,
} = require("electron");
const { randomUUID } = require("node:crypto");
const { AccountStore } = require("./lib/account-store.cjs");
const { buildFingerprint } = require("./lib/fingerprint.cjs");
const { readCustomerWorkbook } = require("./lib/customer-import.cjs");
const { CustomerStore } = require("./lib/customer-store.cjs");
const { configureAccountSession } = require("./lib/browser-session.cjs");
const { CampaignStore } = require("./lib/campaign-store.cjs");
const { CampaignService } = require("./lib/campaign-service.cjs");
const { sendWhatsAppMessage } = require("./lib/whatsapp-sender.cjs");
const { AttachmentStore } = require("./lib/message-attachments.cjs");

const WHATSAPP_URL = "https://web.whatsapp.com/";
const MOCK_URL = `file://${path.join(__dirname, "mock-account.html").replace(/\\/g, "/")}`;
const APP_ICON = path.join(__dirname, "assets", "artway-whatsapp.ico");
const useMockBrowser = process.env.ARTWAY_MOCK_BROWSER === "1";

if (process.env.ARTWAY_USER_DATA_DIR) {
  app.setPath("userData", path.resolve(process.env.ARTWAY_USER_DATA_DIR));
}

const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();

let mainWindow = null;
let accountStore = null;
let customerStore = null;
let campaignService = null;
let attachmentStore = null;
let activeAccountId = null;
let attachedView = null;
let browserBounds = { x: 292, y: 64, width: 900, height: 700 };
let browserVisible = true;
let isQuitting = false;
let tray = null;
let trayMenu = null;
const accountViews = new Map();
const pendingCustomerImports = new Map();

app.on("second-instance", () => {
  showMainWindow();
});

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setSkipTaskbar(false);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  tray = new Tray(APP_ICON);
  tray.setToolTip('ArtwayWhatsapp');
  trayMenu = Menu.buildFromTemplate([
    { label: '打开 ArtwayWhatsapp', click: showMainWindow },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]);
  tray.setContextMenu(trayMenu);
  tray.on('double-click', showMainWindow);
  tray.on('click', showMainWindow);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 920,
    minHeight: 640,
    show: false,
    backgroundColor: "#f3f4f6",
    title: "ArtwayWhatsapp",
    icon: APP_ICON,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  if (process.env.ARTWAY_START_HIDDEN !== "1") {
    mainWindow.once("ready-to-show", () => mainWindow?.show());
  }
  mainWindow.on("close", (event) => {
    if (!isQuitting && tray && !tray.isDestroyed()) {
      event.preventDefault();
      mainWindow.hide();
      mainWindow.setSkipTaskbar(true);
    }
  });
  mainWindow.on("closed", () => {
    for (const view of accountViews.values()) destroyView(view);
    accountViews.clear();
    attachedView = null;
    mainWindow = null;
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

function partitionName(accountId) {
  return `persist:artway-account-${accountId}`;
}

function emitStatus(accountId, status, detail) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("accounts:status", { accountId, status, detail });
}

function describeNavigationFailure(errorCode, errorDescription, validatedUrl) {
  const code = Number.isFinite(errorCode) ? `错误码 ${errorCode}` : "未知错误码";
  return `WhatsApp 页面打开失败（${code}）：${errorDescription || "未知网络错误"}。地址：${validatedUrl || "未知地址"}`;
}

function isAllowedNavigation(targetUrl) {
  if (useMockBrowser && targetUrl.startsWith("file:")) return true;
  try {
    const parsed = new URL(targetUrl);
    return parsed.protocol === "https:" && (parsed.hostname === "web.whatsapp.com" || parsed.hostname.endsWith(".whatsapp.com"));
  } catch {
    return false;
  }
}

async function applyFingerprint(view, account) {
  const { webContents } = view;
  const fingerprint = account.fingerprint;
  const acceptLanguages = fingerprint.languages.join(",");
  webContents.session.setUserAgent(fingerprint.userAgent, acceptLanguages);

  if (process.env.ARTWAY_SKIP_CDP === "1") return;

  if (!webContents.debugger.isAttached()) webContents.debugger.attach("1.3");
  const send = async (method, params) => {
    let timer;
    try {
      return await Promise.race([
        webContents.debugger.sendCommand(method, params).catch(() => undefined),
        new Promise((resolve) => { timer = setTimeout(resolve, 1_500); }),
      ]);
    } finally { clearTimeout(timer); }
  };
  await Promise.all([
    send("Emulation.setTimezoneOverride", { timezoneId: fingerprint.timezone }),
    send("Emulation.setLocaleOverride", { locale: fingerprint.locale }),
    send("Emulation.setHardwareConcurrencyOverride", { hardwareConcurrency: fingerprint.hardwareConcurrency }),
    send("Emulation.setUserAgentOverride", {
      userAgent: fingerprint.userAgent,
      acceptLanguage: acceptLanguages,
      platform: "Win32",
      userAgentMetadata: fingerprint.userAgentMetadata,
    }),
  ]);
}

function getOrCreateAccountView(account) {
  if (accountViews.has(account.id)) return accountViews.get(account.id);

  const accountSession = session.fromPartition(partitionName(account.id), { cache: true });
  configureAccountSession(accountSession, { preconnect: !useMockBrowser });

  const view = new WebContentsView({
    webPreferences: {
      session: accountSession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      // Account switches and customer dialogs must not suspend QR initialization.
      backgroundThrottling: false,
      devTools: !app.isPackaged,
    },
  });
  view.setBackgroundColor("#f7f7f8");
  view.setBounds(browserBounds);
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  view.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isAllowedNavigation(targetUrl)) event.preventDefault();
  });
  view.webContents.on("did-start-loading", () => emitStatus(account.id, "loading"));
  view.webContents.on("did-finish-load", () => emitStatus(account.id, "ready", view.webContents.getURL()));
  view.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (errorCode === -3 || !isMainFrame) return;
    emitStatus(account.id, "error", describeNavigationFailure(errorCode, errorDescription, validatedUrl));
  });
  view.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level < 3) return;
    console.warn(`[ArtwayWhatsapp:${account.id}] WhatsApp 页面脚本错误：${message}（${sourceId}:${line}）`);
  });
  view.webContents.on("render-process-gone", (_event, details) => {
    emitStatus(account.id, "error", `WhatsApp 浏览器进程已停止：${details.reason || "未知原因"}`);
  });

  accountViews.set(account.id, view);
  emitStatus(account.id, "loading");
  view.initialLoad = applyFingerprint(view, account)
    .catch((error) => emitStatus(account.id, "error", `浏览器档案应用失败: ${error.message}`))
    .then(() => view.webContents.loadURL(useMockBrowser ? `${MOCK_URL}?name=${encodeURIComponent(account.name)}` : WHATSAPP_URL))
    .catch((error) => emitStatus(account.id, "error", error.message));
  return view;
}

function detachActiveView() {
  if (!attachedView) return;
  attachedView.setVisible(false);
  attachedView = null;
}

function attachActiveView() {
  if (!mainWindow || !activeAccountId || !browserVisible) return;
  const view = accountViews.get(activeAccountId);
  if (!view) return;
  if (attachedView === view) return;
  if (attachedView) detachActiveView();
  if (!mainWindow.contentView.children.includes(view)) mainWindow.contentView.addChildView(view);
  attachedView = view;
  view.setBounds(browserBounds);
  view.setVisible(true);
}

function destroyView(view) {
  if (attachedView === view) detachActiveView();
  try {
    if (mainWindow?.contentView.children.includes(view)) mainWindow.contentView.removeChildView(view);
  } catch {
    // The view may already be detached while the window is closing.
  }
  try {
    if (view.webContents.debugger.isAttached()) view.webContents.debugger.detach();
  } catch {
    // Ignore debugger teardown after renderer failure.
  }
  if (!view.webContents.isDestroyed()) view.webContents.close();
}

function registerIpcHandlers() {
  ipcMain.handle("campaigns:state", () => campaignService.state());
  ipcMain.handle("campaigns:save-template", (_event, input) => campaignService.store.saveTemplate({...input,attachments:attachmentStore.resolveMany(input.attachmentIds)}));
  ipcMain.handle("campaigns:attachments", (_event, ids) => attachmentStore.resolveMany(ids));
  ipcMain.handle("campaigns:add-attachments", async (_event, kind) => {
    if(!['image','file'].includes(kind))throw new Error('附件类型无效。');
    const fixture=useMockBrowser && process.env.ARTWAY_ATTACHMENT_FILE;
    const selection=fixture ? {canceled:false,filePaths:[fixture]} : await dialog.showOpenDialog(mainWindow,{title:kind==='image'?'添加图片':'添加附件',properties:['openFile','multiSelections'],filters:kind==='image'?[{name:'图片',extensions:['png','jpg','jpeg','webp','gif']}]:[{name:'文件',extensions:['*']}]});
    if(selection.canceled)return [];
    if(selection.filePaths.length>10)throw new Error('每次最多添加10个文件。');
    return selection.filePaths.map(file=>attachmentStore.importFile(file,kind));
  });
  ipcMain.handle("campaigns:remove-template", (_event, id) => { campaignService.store.removeTemplate(id); return campaignService.state(); });
  ipcMain.handle("campaigns:start", (_event, input) => campaignService.start({...input,attachments:attachmentStore.resolveMany(input.attachmentIds).map(({previewUrl,...attachment})=>attachment)}));
  ipcMain.handle("campaigns:control", (_event, id, action) => campaignService.control(id, action));
  ipcMain.handle("accounts:list", () => accountStore.list());

  ipcMain.handle("customers:update", (_event, id, draft) => customerStore.update(id, draft));
  ipcMain.handle("customers:record-contact", (_event, id) => customerStore.recordContact(id));
  ipcMain.handle("customers:remove", (_event, id) => customerStore.remove(id));
  ipcMain.handle("customers:open-chat", async (_event, id, accountId) => {
    if (campaignService.isBusy(accountId)) throw new Error("该账号正在群发，请先暂停或停止任务。");
    const customer = customerStore.list().find((item) => item.id === id);
    if (!customer || !/^[1-9]\d{6,14}$/.test(customer.phone || "")) throw new Error("请先保存有效的 WhatsApp 号码。");
    const account = accountStore.get(accountId);
    detachActiveView();
    activeAccountId = accountId;
    const view = getOrCreateAccountView(account);
    view.setBounds(browserBounds);
    if (!useMockBrowser) await view.webContents.loadURL(`https://web.whatsapp.com/send?phone=${customer.phone}`);
    attachActiveView();
    return { ok: true };
  });

  ipcMain.handle("customers:list", () => customerStore.list());

  ipcMain.handle("customers:download-template", async () => {
    if (!mainWindow) throw new Error("应用窗口不可用。");
    const result = process.env.ARTWAY_TEMPLATE_SAVE_PATH
      ? { canceled: false, filePath: process.env.ARTWAY_TEMPLATE_SAVE_PATH }
      : await dialog.showSaveDialog(mainWindow, {
        title: "下载客户导入模板",
        defaultPath: path.join(app.getPath("downloads"), "客户导入模板.xlsx"),
        filters: [{ name: "Excel 模板", extensions: ["xlsx"] }],
      });
    if (result.canceled || !result.filePath) return { cancelled: true };
    const source = path.join(__dirname, "assets", "customer-template.xlsx");
    if (path.resolve(source).toLowerCase() === path.resolve(result.filePath).toLowerCase()) throw new Error("请选择其他保存位置。");
    await fs.copyFile(source, result.filePath);
    return { cancelled: false, filePath: result.filePath };
  });

  ipcMain.handle("customers:select-excel", async () => {
    if (!mainWindow) throw new Error("应用窗口不可用。");
    const fixturePath = process.env.ARTWAY_CUSTOMER_EXCEL;
    const selection = fixturePath
      ? { canceled: false, filePaths: [fixturePath] }
      : await dialog.showOpenDialog(mainWindow, {
        title: "上传客户模板",
        properties: ["openFile"],
        filters: [
          { name: "客户模板", extensions: ["xlsx"] },
        ],
      });
    if (selection.canceled || selection.filePaths.length === 0) return { cancelled: true };

    pendingCustomerImports.clear();
    const filePath = selection.filePaths[0];
    const preview = readCustomerWorkbook(filePath);
    const token = randomUUID();
    pendingCustomerImports.set(token, preview);
    return {
      cancelled: false,
      token,
      fileName: path.basename(filePath),
      suggestedModel: /ford[_ -]*ranger[_ -]*t9/i.test(path.basename(filePath)) ? "Ford Ranger T9" : /jetour[_ -]*t2/i.test(path.basename(filePath)) ? "Jetour T2" : "",
      sheetName: preview.sheetName,
      candidateCount: preview.customers.length,
      invalidRows: preview.invalidRows,
      customers: preview.customers.slice(0, 6),
    };
  });

  ipcMain.handle("customers:import", (_event, token, model) => {
    if (typeof model !== "string" || !model.trim() || model.trim().length > 60) throw new Error("请填写导入客户所属车型，最多60字。");
    if (typeof token !== "string") throw new Error("客户导入请求无效。");
    const preview = pendingCustomerImports.get(token);
    if (!preview) throw new Error("导入预览已失效，请重新选择 Excel 文件。");
    pendingCustomerImports.delete(token);
    const report = customerStore.createMany(preview.customers.map((customer) => ({ ...customer, models: [model.trim()] })));
    return { ...report, invalidRows: preview.invalidRows };
  });

  ipcMain.handle("accounts:create", (_event, input) => {
    if (!input || typeof input !== "object") throw new Error("账号资料无效。");
    return accountStore.create({
      name: input.name,
      region: input.region,
      fingerprintContext: {
        systemLocale: app.getLocale(),
        systemTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        chromeVersion: process.versions.chrome,
      },
    });
  });

  ipcMain.handle("accounts:rename", (_event, input) => {
    if (!input || typeof input.id !== "string") throw new Error("账号资料无效。");
    return accountStore.rename(input.id, input.name);
  });

  ipcMain.handle("accounts:remove", async (_event, id) => {
    if (campaignService.isBusy(id) || (campaignService.job?.accountId === id && campaignService.job.status === 'paused')) throw new Error("请先停止该账号的群发任务再删除账号。");
    if (typeof id !== "string") throw new Error("账号编号无效。");
    if (activeAccountId === id) detachActiveView();
    const view = accountViews.get(id);
    if (view) {
      destroyView(view);
      accountViews.delete(id);
    }
    const accountSession = session.fromPartition(partitionName(id));
    await accountSession.clearStorageData();
    await accountSession.clearCache();
    accountStore.remove(id);
    if (activeAccountId === id) activeAccountId = null;
    return { ok: true };
  });

  ipcMain.handle("accounts:activate", (_event, id) => {
    if (campaignService.isBusy(id)) throw new Error("该账号正在群发，请在客户页查看任务，或先暂停任务。");
    if (typeof id !== "string") throw new Error("账号编号无效。");
    const account = accountStore.get(id);
    if (activeAccountId !== id) detachActiveView();
    activeAccountId = id;
    const view = getOrCreateAccountView(account);
    view.setBounds(browserBounds);
    attachActiveView();
    return accountStore.touch(id);
  });

  ipcMain.handle("browser:reload", () => {
    if (campaignService.isBusy(activeAccountId)) throw new Error("该账号正在群发，请先暂停任务。");
    if (!activeAccountId) throw new Error("请先选择一个账号。");
    const view = accountViews.get(activeAccountId);
    if (!view) throw new Error("账号浏览器尚未打开。");
    view.webContents.reload();
    return { ok: true };
  });

  ipcMain.handle("browser:set-bounds", (_event, bounds) => {
    if (!bounds || typeof bounds !== "object") throw new Error("浏览器区域无效。");
    browserBounds = {
      x: Math.max(0, Math.round(Number(bounds.x) || 0)),
      y: Math.max(0, Math.round(Number(bounds.y) || 0)),
      width: Math.max(0, Math.round(Number(bounds.width) || 0)),
      height: Math.max(0, Math.round(Number(bounds.height) || 0)),
    };
    if (activeAccountId) {
      const view = accountViews.get(activeAccountId);
      if (view) view.setBounds(browserBounds);
    }
    return { ok: true };
  });

  ipcMain.handle("browser:set-visible", (_event, visible) => {
    browserVisible = Boolean(visible);
    if (browserVisible) attachActiveView();
    else detachActiveView();
    return { ok: true };
  });
}

app.on("before-quit", () => {
  isQuitting = true;
});
app.on('will-quit', () => {
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = null;
});

app.whenReady().then(() => {
  if (!ownsInstance) return;
  accountStore = new AccountStore(path.join(app.getPath("userData"), "accounts.json"), buildFingerprint);
  customerStore = new CustomerStore(path.join(app.getPath("userData"), "customers.json"));
  attachmentStore = new AttachmentStore(path.join(app.getPath('userData'),'message-attachments'));
  campaignService = new CampaignService({
    store: new CampaignStore(path.join(app.getPath("userData"), "campaigns.json")),
    customers: customerStore,
    getAccount: id => accountStore.get(id),
    send: async (accountId, row, onDispatch) => {
      const view = getOrCreateAccountView(accountStore.get(accountId));
      await view.initialLoad;
      const options = useMockBrowser ? { mockUrl: `file://${path.join(__dirname, 'mock-send.html').replace(/\\/g, '/')}`, readyTimeout: 2500, ackTimeout: 1200 } : {};
      return sendWhatsAppMessage(view.webContents, row, onDispatch, options);
    },
    ...(useMockBrowser ? {delay: async () => {}} : {}),
    publish: job => {
      setImmediate(attachActiveView);
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('campaigns:update', job);
    },
  });
  registerIpcHandlers();
  createTray();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    showMainWindow();
  });
});

module.exports = { getTray: () => tray, getTrayMenu: () => trayMenu };

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, expect, _electron: electron } = require("@playwright/test");
const XLSX = require("xlsx");

test("window close hides to tray, restores and only tray exit quits", async () => {
  const projectRoot = path.resolve(__dirname, "..");
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "artway-close-behavior-"));
  const electronApp = await electron.launch({
    executablePath: require("electron"),
    args: [projectRoot],
    cwd: projectRoot,
    env: {
      ...process.env,
      ARTWAY_MOCK_BROWSER: "1",
      ARTWAY_SKIP_CDP: "1",
      ARTWAY_USER_DATA_DIR: userDataDir,
    },
  });

  let hasExited = false;
  try {
    const page = await electronApp.firstWindow();
    await expect(page.getByRole("button", { name: "展开账号栏", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "展开账号栏", exact: true }).click();
    await expect(page.getByRole("button", { name: "收起账号栏", exact: true })).toBeVisible();
    const closeState = await electronApp.evaluate(({ BrowserWindow, app }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.close();
      const tray = process.mainModule.require(app.getAppPath() + '/electron/main.cjs').getTray();
      return {visible:window.isVisible(), stillOpen:!window.isDestroyed(), trayAlive:!tray.isDestroyed()};
    });
    expect(closeState).toEqual({visible:false,stillOpen:true,trayAlive:true});
    const restored = await electronApp.evaluate(({BrowserWindow,app}) => {
      const tray = process.mainModule.require(app.getAppPath() + '/electron/main.cjs').getTray();
      process.mainModule.require(app.getAppPath() + '/electron/main.cjs').getTrayMenu().items.find(item=>item.label==='打开 ArtwayWhatsapp').click();
      return BrowserWindow.getAllWindows()[0].isVisible();
    });
    expect(restored).toBe(true);
    await expect(page.getByRole("button", { name: "收起账号栏", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "收起账号栏", exact: true }).click();
    await electronApp.evaluate(({BrowserWindow}) => {const window=BrowserWindow.getAllWindows()[0];window.minimize();window.close();});
    expect(await electronApp.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible())).toBe(false);
    await electronApp.evaluate(({app}) => process.mainModule.require(app.getAppPath() + '/electron/main.cjs').getTrayMenu().items.find(item=>item.label==='打开 ArtwayWhatsapp').click());
    await expect(page.getByRole("button", { name: "展开账号栏", exact: true })).toBeVisible();
    const exited = electronApp.waitForEvent('close');
    await electronApp.evaluate(({app}) => {
      const tray = process.mainModule.require(app.getAppPath() + '/electron/main.cjs').getTray();
      setImmediate(()=>process.mainModule.require(app.getAppPath() + '/electron/main.cjs').getTrayMenu().items.find(item=>item.label==='退出').click());
    });
    await exited;
    hasExited = true;

  } finally {
    if (!hasExited) await electronApp.close();
  }
});

test("downloads the reference template and imports strictly validated customers", async () => {
  const projectRoot = path.resolve(__dirname, "..");
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "artway-customer-ui-"));
  const workbookPath = path.join(userDataDir, "customers.xlsx");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["名称", "国家", "号码"],
    ["DSR", "Australia", "61412345678"],
    ["DSR", "Australia", "61412345678"],
    ["Trail Works", "新西兰", "64211234567"],
  ]), "客户名单");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["填写规则"]]), "填写说明");
  XLSX.writeFile(workbook, workbookPath);

  const electronApp = await electron.launch({
    executablePath: require("electron"),
    args: [projectRoot],
    cwd: projectRoot,
    env: {
      ...process.env,
      ARTWAY_MOCK_BROWSER: "1",
      ARTWAY_SKIP_CDP: "1",
      ARTWAY_USER_DATA_DIR: userDataDir,
      ARTWAY_CUSTOMER_EXCEL: workbookPath,
      ARTWAY_TEMPLATE_SAVE_PATH: path.join(userDataDir, "download.xlsx"),
    },
  });

  try {
    const window = await electronApp.firstWindow();
    await window.getByRole("button", { name: "客户名单" }).click();
    await expect(window.getByRole("region", { name: "客户管理页面" })).toBeVisible();
    await expect(window.getByRole("button", { name: "客户管理", exact: true })).toHaveCount(0);
    await expect(window.getByRole("combobox", { name: "筛选国家" })).toHaveCount(0);
    await expect(window.getByRole("combobox", { name: "筛选状态" })).toHaveCount(0);
    await expect(window.getByRole("button", { name: "上传模板", exact: true })).toHaveCount(0);
    await window.getByRole("button", { name: "下载模板", exact: true }).click();
    await expect(window.getByRole("status")).toContainText("模板已保存");
    assertTemplateDownload(path.join(userDataDir, "download.xlsx"), projectRoot);
    await window.getByRole("button", { name: "导入客户", exact: true }).first().click();
    await expect(window.getByRole("dialog")).toBeVisible();
    await window.getByRole("button", { name: "选择文件" }).click({ force: true });
    await expect(window.getByText("DSR-澳大利亚", { exact: true }).first()).toBeVisible();
    await expect(window.getByRole("button", { name: "确认导入 3 条" })).toBeVisible();
    await window.getByRole("textbox", { name: "所属车型", exact: true }).fill("Ford Ranger T9");
    const invalidWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(invalidWorkbook, XLSX.utils.aoa_to_sheet([["客户", "国家"], ["Example", "Australia"]]), "Sheet1");
    XLSX.writeFile(invalidWorkbook, workbookPath);
    await window.getByRole("button", { name: "选择文件" }).click();
    await expect(window.getByRole("dialog").getByRole("alert")).toContainText("工作表");
    await expect(window.getByRole("button", { name: /确认导入/ })).toHaveCount(0);
    expect(await window.evaluate(() => window.artway.listCustomers())).toEqual([]);
    XLSX.writeFile(workbook, workbookPath);
    await window.getByRole("button", { name: "选择文件" }).click();
    await expect(window.getByRole("button", { name: "确认导入 3 条" })).toBeVisible();

    await window.getByRole("button", { name: "确认导入 3 条" }).click();
    await expect(window.getByText("已添加 2 位客户，跳过 1 条重复号码。", { exact: true })).toBeVisible();
    await window.getByRole("button", { name: "关闭", exact: true }).click();
    await window.getByRole("button", { name: "筛选车型 Ford Ranger T9", exact: true }).click();
    await expect(window.getByRole("button", { name: "DSR", exact: true })).toBeVisible();
    await window.getByRole("button", { name: /^未分类/ }).click();
    await expect(window.getByRole("button", { name: "DSR", exact: true })).toHaveCount(0);
    await window.getByRole("button", { name: "筛选车型 Ford Ranger T9", exact: true }).click();
    await window.getByRole("button", { name: "DSR", exact: true }).click();
    await expect(window.getByRole("textbox", { name: "联系人", exact: true })).toHaveValue("");
    await window.getByRole("textbox", { name: "客户名称", exact: true }).fill("客户A");
    await window.getByRole("textbox", { name: "跟进备注", exact: true }).fill("需要 Ranger 配件报价");
    await window.getByRole("button", { name: "保存资料", exact: true }).click();
    await expect(window.getByRole("cell", { name: "+61412345678", exact: true })).toBeVisible();
    await window.reload();
    await window.getByRole("button", { name: "客户名单", exact: true }).click();
    await window.getByRole("button", { name: "客户A", exact: true }).click();
    await expect(window.getByRole("textbox", { name: "跟进备注", exact: true })).toHaveValue("需要 Ranger 配件报价");
    await window.getByRole("button", { name: "记录一次联系", exact: true }).click();
    await window.getByRole("button", { name: "确认记录", exact: true }).click();
    await expect(window.getByText("已联系 1 次", { exact: true })).toBeVisible();
    await window.getByRole("button", { name: "查看 客户A 的联系日期", exact: true }).hover();
    await expect(window.getByRole("tooltip")).toBeVisible();
    await expect(window.getByRole("tooltip")).toContainText(/\d{4}-\d{2}-\d{2}/);
    await expect(window.getByRole("columnheader", { name: "国家", exact: true })).toBeVisible();
    await expect(window.getByRole("columnheader", { name: "车型", exact: true })).toHaveCount(0);
    await expect(window.locator(".customer-name-button small")).toHaveCount(0);
    await window.getByRole("textbox", { name: "搜索客户", exact: true }).fill("Ranger");
    await expect(window.getByRole("button", { name: "Trail Works", exact: true })).toHaveCount(0);
    await window.screenshot({ path: path.join(projectRoot, "test-results", "customers-workspace.png") });
    await window.getByRole("button", { name: "删除客户", exact: true }).click();
    await window.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(window.getByRole("dialog")).toBeHidden();
    await window.getByRole("textbox", { name: "搜索客户", exact: true }).fill("");
    await expect(window.getByRole("button", { name: "Trail Works", exact: true })).toBeVisible();
    await expect(window.getByRole("button", { name: "客户A", exact: true })).toHaveCount(0);

  } finally {
    await electronApp.close();
  }
});

test("creates and isolates two WhatsApp browser profiles", async () => {
  const projectRoot = path.resolve(__dirname, "..");
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "artway-e2e-"));
  const electronApp = await electron.launch({
    executablePath: require("electron"),
    args: [projectRoot],
    cwd: projectRoot,
    env: {
      ...process.env,
      ARTWAY_MOCK_BROWSER: "1",
      ARTWAY_SKIP_CDP: "1",
      ARTWAY_USER_DATA_DIR: userDataDir,
    },
  });

  try {
    const window = await electronApp.firstWindow();
    await expect(window).toHaveTitle("ArtwayWhatsapp");
    await expect.poll(() => electronApp.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
    await expect(window.getByRole("heading", { name: "添加你的第一个账号" })).toBeVisible();
    await window.getByRole("button", { name: "展开账号栏", exact: true }).click();

    await window.getByRole("button", { name: "添加账号" }).first().click();
    await window.getByLabel("账号名称").fill("欧洲销售 01");
    await window.getByLabel("浏览器地区").selectOption("en-GB");
    await window.getByRole("button", { name: "创建并打开" }).click();
    await expect(window.getByRole("dialog")).toBeHidden();
    await expect(window.getByText("欧洲销售 01", { exact: true }).first()).toBeVisible();
    await expect(window.getByText("已打开", { exact: true }).first()).toBeVisible();

    await window.getByRole("button", { name: "查看浏览器档案" }).click();
    await expect(window.getByRole("dialog")).toBeVisible();
    await expect.poll(async () => electronApp.evaluate(({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows()[0]?.contentView.children.at(-1);
      return view?.getVisible() ?? null;
    })).toBe(false);
    await window.getByRole("button", { name: "完成" }).click();
    await expect(window.getByRole("dialog")).toBeHidden();
    await expect.poll(async () => electronApp.evaluate(({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows()[0]?.contentView.children.at(-1);
      return view?.getVisible() ?? null;
    })).toBe(true);
    await expect(window.getByText("欧洲销售 01", { exact: true }).first()).toBeVisible();

    await window.getByRole("button", { name: "添加账号" }).first().click();
    await window.getByLabel("账号名称").fill("北美销售 02");
    await window.getByLabel("浏览器地区").selectOption("en-US");
    await window.getByRole("button", { name: "创建并打开" }).click();
    await expect(window.getByRole("dialog")).toBeHidden();
    await expect(window.getByText("北美销售 02", { exact: true }).first()).toBeVisible();
    await expect(window.getByText("已打开", { exact: true }).last()).toBeVisible();

    await window.getByRole("button", { name: /更多操作/ }).first().click();
    const actionsMenu = window.getByRole("menu");
    await expect(actionsMenu).toBeVisible();
    const [sidebarBox, menuBox] = await Promise.all([
      window.locator(".sidebar").boundingBox(),
      actionsMenu.boundingBox(),
    ]);
    expect(sidebarBox).not.toBeNull();
    expect(menuBox).not.toBeNull();
    expect(menuBox.x).toBeGreaterThanOrEqual(sidebarBox.x);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(sidebarBox.x + sidebarBox.width);
    await window.keyboard.press("Escape");
    await expect(actionsMenu).toBeHidden();

    const readProfileSessions = () => electronApp.evaluate(({ webContents }) =>
      webContents
        .getAllWebContents()
        .filter((contents) => contents.getURL().includes("mock-account.html"))
        .map((contents) => ({
          url: contents.getURL(),
          storagePath: contents.session.storagePath,
        })),
    );

    await expect.poll(async () => (await readProfileSessions()).length).toBe(2);
    const profileSessions = await readProfileSessions();

    expect(profileSessions).toHaveLength(2);
    const throttleSettings = await electronApp.evaluate(({ webContents }) => webContents.getAllWebContents().filter(w => w.getURL().includes("mock-account.html")).map(w => w.getBackgroundThrottling()));
    expect(throttleSettings).toEqual([false, false]);

    expect(profileSessions[0].storagePath).not.toBe(profileSessions[1].storagePath);
    const recovery = await electronApp.evaluate(async ({BrowserWindow}) => {
      const browser = BrowserWindow.getAllWindows()[0].contentView.children.at(-1);
      browser.needsRecovery = true;
      return browser.webContents.id;
    });
    await window.getByRole("button", { name: "刷新 WhatsApp Web", exact: true }).click();
    await expect.poll(() => electronApp.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].contentView.children.at(-1)?.webContents.id)).not.toBe(recovery);

    expect(profileSessions.every((profile) => profile.storagePath.includes("Partitions"))).toBe(true);

    const screenshotPath = path.join(projectRoot, "test-results", "artway-main.png");
    await window.screenshot({ path: screenshotPath });
    expect(fs.existsSync(screenshotPath)).toBe(true);

    const compositePng = await electronApp.evaluate(async ({ desktopCapturer }) => {
      const sources = await desktopCapturer.getSources({
        types: ["window"],
        thumbnailSize: { width: 1360, height: 860 },
      });
      const source = sources.find((item) => item.name.includes("ArtwayWhatsapp"));
      if (!source) throw new Error("ArtwayWhatsapp window was not available to capture.");
      return source.thumbnail.toPNG().toString("base64");
    });
    const compositePath = path.join(projectRoot, "test-results", "artway-composite.png");
    fs.writeFileSync(compositePath, Buffer.from(compositePng, "base64"));
    expect(fs.existsSync(compositePath)).toBe(true);

    await window.emulateMedia({ colorScheme: "dark" });
    const darkScreenshotPath = path.join(projectRoot, "test-results", "artway-dark.png");
    await window.screenshot({ path: darkScreenshotPath });
    expect(fs.existsSync(darkScreenshotPath)).toBe(true);
  } finally {
    await electronApp.close();
  }
});

function assertTemplateDownload(file, projectRoot) {
  expect(fs.readFileSync(file).equals(fs.readFileSync(path.join(projectRoot, "electron/assets/customer-template.xlsx")))).toBe(true);
}

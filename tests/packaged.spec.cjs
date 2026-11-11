const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, expect, _electron: electron } = require("@playwright/test");

test("packaged Windows app starts with a clean profile", async () => {
  const projectRoot = path.resolve(__dirname, "..");
  const executablePath = path.join(projectRoot, "release", "win-unpacked", "ArtwayWhatsapp.exe");
  expect(fs.existsSync(executablePath)).toBe(true);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "artway-packaged-"));
  const electronApp = await electron.launch({
    executablePath,
    args: [],
    cwd: projectRoot,
    env: {
      ...process.env,
      ARTWAY_USER_DATA_DIR: userDataDir,
    },
  });

  try {
    const window = await electronApp.firstWindow();
    await expect(window).toHaveTitle("ArtwayWhatsapp");
    await expect(window.getByRole("heading", { name: "添加你的第一个账号" })).toBeVisible();
    await window.screenshot({ path: path.join(projectRoot, "test-results", "artway-packaged.png") });
  } finally {
    await electronApp.close();
  }
});

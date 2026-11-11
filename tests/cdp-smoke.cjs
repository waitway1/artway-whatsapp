const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { spawn } = require("node:child_process");
const { AccountStore } = require("../electron/lib/account-store.cjs");
const { buildFingerprint } = require("../electron/lib/fingerprint.cjs");

async function main() {
  const projectRoot = path.resolve(__dirname, "..");
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "artway-cdp-smoke-"));
  const store = new AccountStore(path.join(userDataDir, "accounts.json"), buildFingerprint);
  store.create({
    name: "档案覆盖测试",
    region: "en-GB",
    fingerprintContext: {
      systemLocale: "zh-CN",
      systemTimezone: "Asia/Shanghai",
      chromeVersion: "144.0.7559.133",
      randomIndex: 1,
    },
  });

  const environment = {
    ...process.env,
    ARTWAY_MOCK_BROWSER: "1",
    ARTWAY_START_HIDDEN: "1",
    ARTWAY_USER_DATA_DIR: userDataDir,
  };
  delete environment.ARTWAY_SKIP_CDP;
  delete environment.ELECTRON_RUN_AS_NODE;

  const child = spawn(require("electron"), [projectRoot], {
    cwd: projectRoot,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });

  const earlyExit = await Promise.race([
    once(child, "exit").then(([code, signal]) => ({ code, signal })),
    new Promise((resolve) => setTimeout(() => resolve(null), 7_000)),
  ]);

  if (earlyExit) {
    throw new Error(`Electron exited during CDP profile startup: ${JSON.stringify(earlyExit)}\n${output}`);
  }

  if (child.exitCode === null) child.kill();
  await new Promise((resolve) => setTimeout(resolve, 250));
  console.log("CDP fingerprint profile remained stable for 7 seconds.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { AccountStore, validateName } = require("./account-store.cjs");
const { buildFingerprint } = require("./fingerprint.cjs");

test("account profiles persist without sharing identifiers", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "artway-account-store-"));
  const filePath = path.join(directory, "accounts.json");
  const store = new AccountStore(filePath, buildFingerprint);
  const context = { systemLocale: "zh-CN", systemTimezone: "Asia/Shanghai", chromeVersion: "136.0.0.0", randomIndex: 0 };
  const first = store.create({ name: "销售一组", region: "local", fingerprintContext: context });
  const second = store.create({ name: "销售二组", region: "local", fingerprintContext: context });

  assert.notEqual(first.id, second.id);
  assert.notEqual(first.fingerprint.profileCode, second.fingerprint.profileCode);
  assert.equal(first.fingerprint.timezone, "Asia/Shanghai");
  assert.equal(new AccountStore(filePath, buildFingerprint).list().length, 2);
});

test("account names are trimmed and validated", () => {
  assert.equal(validateName("  欧洲销售  "), "欧洲销售");
  assert.throws(() => validateName("A"), /2 到 40/);
});


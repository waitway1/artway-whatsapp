const test = require("node:test");
const assert = require("node:assert/strict");
const { configureAccountSession, allowPermission } = require("./browser-session.cjs");

test("permits WhatsApp persistent storage without granting unrelated permissions or origins", () => {
  assert.equal(allowPermission("persistent-storage", "https://web.whatsapp.com"), true);
  assert.equal(allowPermission("notifications", "https://web.whatsapp.com"), true);
  for (const origin of ["https://whatsapp.com.attacker.test", "http://web.whatsapp.com", "https://example.com", "", undefined]) {
    assert.equal(allowPermission("persistent-storage", origin), false);
  }
  assert.equal(allowPermission("media", "https://web.whatsapp.com"), false);
});

test("configures per-session permission checks and warms connections without changing proxy or cache", () => {
  let request;
  let check;
  const preconnects = [];
  const session = {
    setPermissionRequestHandler: (handler) => { request = handler; },
    setPermissionCheckHandler: (handler) => { check = handler; },
    preconnect: (options) => preconnects.push(options),
  };
  configureAccountSession(session);
  assert.equal(check(null, "persistent-storage", "https://web.whatsapp.com"), true);
  request({ getURL: () => "https://web.whatsapp.com" }, "persistent-storage", (allowed) => assert.equal(allowed, true), {});
  request({ getURL: () => "https://web.whatsapp.com" }, "persistent-storage", (allowed) => assert.equal(allowed, false), { requestingUrl: "https://example.com" });
  assert.equal(preconnects.length, 2);
  configureAccountSession(session, { preconnect: false });
  assert.equal(preconnects.length, 2);
});

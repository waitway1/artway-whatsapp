const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CustomerStore } = require("./customer-store.cjs");

test("customer updates validate phone, preserve identity and persist deletion", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "artway-customer-crud-")), "customers.json");
  const store = new CustomerStore(file);
  const customer = store.createMany([{ name: "Trail Works", country: "新西兰" }]).customers[0];
  assert.throws(() => store.update(customer.id, { name: "Trail Works", country: "新西兰", phone: "invalid" }), /号码/);
  assert.equal(store.list()[0].phone, "");
  const updated = store.update(customer.id, { name: "Trail Works", country: "新西兰", phone: "+64 211 234 567", status: "replied", notes: "Requested quote" })[0];
  assert.equal(updated.id, customer.id);
  assert.equal(updated.createdAt, customer.createdAt);
  assert.equal(updated.phone, "64211234567");
  assert.equal(new CustomerStore(file).list()[0].notes, "Requested quote");
  store.remove(customer.id);
  assert.deepEqual(new CustomerStore(file).list(), []);
});

test("duplicate contacts gain model categories without losing saved details", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "artway-models-")), "customers.json");
  const store = new CustomerStore(file);
  store.createMany([{ name: "Original", country: "英国", phone: "447584109243", models: ["Ford Ranger T9"], notes: "Saved follow-up", status: "replied" }]);
  const report = store.createMany([{ name: "New name", country: "英国", phone: "447584109243", models: ["Jetour T2"] }]);
  assert.equal(report.created, 0);
  assert.equal(report.updatedCategories, 1);
  assert.deepEqual(report.customers[0].models, ["Ford Ranger T9", "Jetour T2"]);
  assert.equal(report.customers[0].notes, "Saved follow-up");
  assert.equal(report.customers[0].status, "replied");
  store.update(report.customers[0].id, { name: "Edited", country: "英国", phone: "447584109243" });
  assert.deepEqual(new CustomerStore(file).list()[0].models, ["Ford Ranger T9", "Jetour T2"]);
  assert.throws(() => store.createMany([{ name: "Valid", country: "英国", models: ["Jetour T2"] }, { name: "Invalid", country: "英国", models: [""] }]), /车型/);
  assert.equal(store.list().length, 1);
});

test("deleted customers stay excluded after restart and reimport, including previous numbers", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "artway-excluded-")), "customers.json");
  const store = new CustomerStore(file);
  const original = { name: "Original", country: "英国", phone: "447584109243", models: ["Ford Ranger T9"] };
  const customer = store.createMany([original]).customers[0];
  store.update(customer.id, { ...customer, name: "Renamed", phone: "447584109244" });
  store.remove(customer.id);
  const restarted = new CustomerStore(file);
  const result = restarted.createMany([original, { ...original, name: "Another name", phone: "447584109244", models: ["Jetour T2"] }]);
  assert.equal(result.created, 0);
  assert.equal(result.skippedDeleted, 2);
  assert.deepEqual(restarted.list(), []);
  assert.equal(JSON.parse(fs.readFileSync(file)).deletedCustomers.length, 1);
});

test("contact history keeps date-only entries across edits and duplicate imports", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "artway-history-")), "customers.json");
  const store = new CustomerStore(file);
  const original = { name: "Original", country: "英国", phone: "447584109243" };
  const customer = store.createMany([original]).customers[0];
  store.recordContact(customer.id, "2026-11-10");
  store.recordContact(customer.id, "2026-11-10");
  store.update(customer.id, { ...original, name: "User edited" });
  store.createMany([original]);
  const saved = new CustomerStore(file).list()[0];
  assert.equal(saved.name, "User edited");
  assert.equal(saved.contactHistory.length, 2);
  assert.deepEqual(saved.contactHistory.map(entry => entry.date), ["2026-11-10", "2026-11-10"]);
  assert.throws(() => store.recordContact(customer.id, "2026-02-30"), /日期/);
  assert.equal(store.list()[0].contactHistory.length, 2);
});

test("reimport recognizes original number after the user renames and clears the current number", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "artway-aliases-")), "customers.json");
  const store = new CustomerStore(file);
  const original = { name: "Original", country: "英国", phone: "447584109243" };
  const customer = store.createMany([original]).customers[0];
  store.update(customer.id, { name: "User name", country: "英国", phone: "" });
  const result = store.createMany([original]);
  assert.equal(result.created, 0);
  assert.equal(result.customers[0].name, "User name");
  assert.equal(result.customers[0].phone, "");
  store.remove(customer.id);
  assert.equal(new CustomerStore(file).createMany([original]).skippedDeleted, 1);
});

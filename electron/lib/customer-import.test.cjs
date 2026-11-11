const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const XLSX = require("xlsx");
const { readCustomerWorkbook, TEMPLATE_HEADERS } = require("./customer-import.cjs");
const { CustomerStore } = require("./customer-store.cjs");

function fixture(rows, names = ["客户名单", "填写说明"]) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "artway-template-"));
  const file = path.join(directory, "customers.xlsx");
  const workbook = XLSX.utils.book_new();
  for (const name of names) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(name === "填写说明" ? [["填写规则"]] : rows), name);
  XLSX.writeFile(workbook, file);
  return file;
}

test("imports complete customer information and skips duplicate phones after renaming", () => {
  const file = fixture([TEMPLATE_HEADERS, ["DSR", "Australia", "61412345678"], ["DSR", "Australia", "61412345678"], ["Trail Works", "新西兰", "64211234567"]]);
  const preview = readCustomerWorkbook(file);
  assert.equal(preview.customers[0].country, "澳大利亚");
  assert.equal(preview.customers[0].status, "new");
  assert.equal(preview.customers[2].status, "new");
  const store = new CustomerStore(path.join(path.dirname(file), "customers.json"));
  assert.equal(store.createMany(preview.customers).created, 2);
  const first = store.list()[0];
  store.update(first.id, { ...first, name: "Renamed" });
  assert.equal(store.createMany(preview.customers).skippedDuplicate, 3);
  assert.equal(new CustomerStore(store.filePath).list()[0].name, "Renamed");
});

test("rejects old templates, extra columns, reordered columns and changed sheets", () => {
  for (const rows of [
    [["WhatsApp号码"], ["61412345678"]],
    [[...TEMPLATE_HEADERS, "额外列"]],
    [[...TEMPLATE_HEADERS.slice().reverse()]],
    [TEMPLATE_HEADERS, ["客户", "中国", "8613287657150", "", "", "", "extra"]],
  ]) assert.throws(() => readCustomerWorkbook(fixture(rows)), /模板格式不符/);
  assert.throws(() => readCustomerWorkbook(fixture([TEMPLATE_HEADERS], ["Sheet1"])), /工作表/);
});

test("rejects missing required fields, invalid phones, formulas and limits", () => {
  for (const row of [
    ["", "中国", "8613287657150"], ["客户", "", "8613287657150"], ["客户", "中国", ""],
    ["客户", "中国", "+8613287657150"], ["客户", "中国", "86 13287657150"],
    ["客户", "中国", { t: "n", f: "1+2", v: 3 }],
    ["x".repeat(101), "中国", "8613287657150"],
  ]) assert.throws(() => readCustomerWorkbook(fixture([TEMPLATE_HEADERS, ["有效", "中国", "8613287657151"], row])), /第 3 行/);
  assert.throws(() => readCustomerWorkbook(path.join(__dirname, "../assets/customer-template.xlsx")), /没有客户资料/);
  assert.throws(() => readCustomerWorkbook(fixture([TEMPLATE_HEADERS, ...Array.from({ length: 2001 }, () => ["客户", "中国", "8613287657150"])])), /2,000/);
  assert.throws(() => readCustomerWorkbook("customers.csv"), /只支持 .xlsx/);
  assert.throws(() => readCustomerWorkbook("missing.xlsx"), /无法读取/);
});

test("legacy customer records persist and still skip duplicate names", () => {
  const store = new CustomerStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "artway-store-")), "customers.json"));
  store.createMany([{ name: "Example", country: "澳大利亚" }]);
  assert.equal(store.createMany([{ name: "Example", country: "澳大利亚" }]).skippedDuplicate, 1);
});

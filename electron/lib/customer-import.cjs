const XLSX = require("xlsx");

const COUNTRY_NAMES = new Map([
  ["australia", "澳大利亚"],
  ["au", "澳大利亚"],
  ["austria", "奥地利"],
  ["brazil", "巴西"],
  ["canada", "加拿大"],
  ["china", "中国"],
  ["germany", "德国"],
  ["de", "德国"],
  ["france", "法国"],
  ["italy", "意大利"],
  ["japan", "日本"],
  ["mexico", "墨西哥"],
  ["new zealand", "新西兰"],
  ["nz", "新西兰"],
  ["south africa", "南非"],
  ["spain", "西班牙"],
  ["united arab emirates", "阿联酋"],
  ["uae", "阿联酋"],
  ["united kingdom", "英国"],
  ["uk", "英国"],
  ["great britain", "英国"],
  ["united states", "美国"],
  ["united states of america", "美国"],
  ["usa", "美国"],
  ["us", "美国"],
]);

function normalizeCountryName(value) {
  const country = String(value || "").trim().replace(/\s+/g, " ");
  if (!country) return "";
  return COUNTRY_NAMES.get(country.toLocaleLowerCase()) || country;
}

const TEMPLATE_HEADERS = ["名称", "国家", "号码"];


function readCustomerWorkbook(filePath) {
  if (require("node:path").extname(filePath).toLowerCase() !== ".xlsx") throw new Error("模板格式不符：只支持 .xlsx 文件，请下载新版模板后填写上传。");
  let workbook;
  try {
    const contents = require("node:fs").readFileSync(filePath);
    if (contents.subarray(0, 4).toString("hex") !== "504b0304") throw new Error("Invalid XLSX");
    workbook = XLSX.read(contents, { type: "buffer", cellText: true, cellDates: false });
  } catch { throw new Error("文件无法读取，请上传有效的 .xlsx 文件。"); }
  if (workbook.SheetNames.length !== 2 || workbook.SheetNames[0] !== "客户名单" || workbook.SheetNames[1] !== "填写说明") throw new Error("模板格式不符：请保留“客户名单”和“填写说明”两个工作表及原顺序，下载新版模板后重试。");
  const sheet = workbook.Sheets["客户名单"];
  TEMPLATE_HEADERS.forEach((header, index) => {
    const address = `${String.fromCharCode(65 + index)}1`;
    if (sheet[address]?.v !== header || sheet[address]?.f) throw new Error(`模板格式不符：${address} 表头必须为“${header}”，不得增删列或调整顺序。`);
  });
  const rowNumbers = new Set();
  for (const [address, cell] of Object.entries(sheet)) {
    if (address.startsWith("!") || (!cell.f && (cell.v === undefined || cell.v === null || cell.v === ""))) continue;
    if (!/^[A-C][1-9]\d*$/.test(address)) throw new Error("模板格式不符：客户名单仅允许 A–C 三列，不得添加其他列内容。");
    const row = Number(address.slice(1));
    if (row > 1) rowNumbers.add(row);
  }
  if (!rowNumbers.size) throw new Error("文件没有客户资料，请从客户名单第 2 行起填写后上传。");
  if (rowNumbers.size > 2000) throw new Error("单次最多导入 2,000 位客户，请拆分文件后重试。");
  const customers = [];
  for (const row of [...rowNumbers].sort((a, b) => a - b)) {
    const values = TEMPLATE_HEADERS.map((header, index) => {
      const cell = sheet[`${String.fromCharCode(65 + index)}${row}`];
      if (cell?.f || cell?.t === "e") throw new Error(`第 ${row} 行“${header}”不允许公式或错误值，整份文件未导入。`);
      return String(cell?.v ?? "").trim();
    });
    const [name, countryValue, phone] = values;
    if (!name || !countryValue || !phone) throw new Error(`第 ${row} 行缺少名称、国家或号码，整份文件未导入。`);
    if (name.length > 100 || countryValue.length > 40) throw new Error(`第 ${row} 行内容过长：名称最多100字，国家最多40字。`);
    if (!/^[1-9]\d{6,14}$/.test(phone)) throw new Error(`第 ${row} 行号码格式错误：请填写含国际区号的 7–15 位纯数字，不含 + 或空格。整份文件未导入。`);
    const country = normalizeCountryName(countryValue);
    customers.push({ name, country, phone, status: "new", displayName: `${name}-${country}` });
  }
  return { sheetName: "客户名单", customers, invalidRows: 0 };
}

module.exports = { normalizeCountryName, readCustomerWorkbook, TEMPLATE_HEADERS };

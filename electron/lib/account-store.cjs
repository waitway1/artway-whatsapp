const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

class AccountStore {
  constructor(filePath, fingerprintFactory) {
    this.filePath = filePath;
    this.fingerprintFactory = fingerprintFactory;
    this.accounts = this.#read();
  }

  list() {
    return this.accounts.map((account) => structuredClone(account));
  }

  create({ name, region, fingerprintContext }) {
    const cleanName = validateName(name);
    const allowedRegions = new Set(["local", "zh-CN", "en-US", "en-GB", "de-DE"]);
    if (!allowedRegions.has(region)) throw new Error("不支持的浏览器地区。");
    const now = new Date().toISOString();
    const account = {
      id: randomUUID(),
      name: cleanName,
      region,
      createdAt: now,
      lastOpenedAt: null,
      fingerprint: this.fingerprintFactory({ region, ...fingerprintContext }),
    };
    this.accounts.push(account);
    this.#write();
    return structuredClone(account);
  }

  rename(id, name) {
    const account = this.#find(id);
    account.name = validateName(name);
    this.#write();
    return structuredClone(account);
  }

  touch(id) {
    const account = this.#find(id);
    account.lastOpenedAt = new Date().toISOString();
    this.#write();
    return structuredClone(account);
  }

  remove(id) {
    const before = this.accounts.length;
    this.accounts = this.accounts.filter((account) => account.id !== id);
    if (before === this.accounts.length) throw new Error("找不到这个账号档案。");
    this.#write();
  }

  get(id) {
    return structuredClone(this.#find(id));
  }

  #find(id) {
    const account = this.accounts.find((item) => item.id === id);
    if (!account) throw new Error("找不到这个账号档案。");
    return account;
  }

  #read() {
    try {
      if (!fs.existsSync(this.filePath)) return [];
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      return Array.isArray(parsed.accounts) ? parsed.accounts : [];
    } catch (error) {
      throw new Error(`账号档案文件无法读取: ${error.message}`);
    }
  }

  #write() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify({ version: 1, accounts: this.accounts }, null, 2), "utf8");
    fs.renameSync(temporaryPath, this.filePath);
  }
}

function validateName(value) {
  const cleanName = String(value || "").trim();
  if (cleanName.length < 2 || cleanName.length > 40) throw new Error("账号名称需要 2 到 40 个字符。");
  return cleanName;
}

module.exports = { AccountStore, validateName };


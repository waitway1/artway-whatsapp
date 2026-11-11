const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

class CustomerStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.document = this.#read();
    this.customers = this.document.customers;
    this.deletedCustomers = this.document.deletedCustomers || [];
  }

  list() {
    return this.customers.map((customer) => structuredClone(customer));
  }

  createMany(drafts) {
    if (!Array.isArray(drafts) || drafts.length === 0) throw new Error("没有可导入的客户记录。");
    const incoming = drafts.map(createCustomer);
    const next = this.list();
    let created = 0, skippedDuplicate = 0, updatedCategories = 0, skippedDeleted = 0;
    for (const customer of incoming) {
      if (this.deletedCustomers.some((item) => customer.phone
        ? [item.phone, ...(item.importPhones || [])].includes(customer.phone)
        : customerKey(item.displayName) === customerKey(customer.displayName))) {
        skippedDeleted += 1;
        continue;
      }
      const existing = next.find((item) => customer.phone
        ? item.phone === customer.phone || (item.importPhones || []).includes(customer.phone)
        : customerKey(item.displayName) === customerKey(customer.displayName));
      if (existing) {
        const models = [...new Set([...(existing.models || []), ...customer.models])];
        if (models.length !== (existing.models || []).length) {
          existing.models = models;
          updatedCategories += 1;
        }
        skippedDuplicate += 1;
      } else {
        next.push(customer);
        created += 1;
      }
    }
    if (created || updatedCategories) this.#commit(next);
    return { created, skippedDuplicate, updatedCategories, skippedDeleted, customers: this.list() };
  }

  update(id, draft) {
    const current = this.customers.find((customer) => customer.id === id);
    if (!current) throw new Error("客户不存在。");
    const updated = { ...current, ...createCustomer({ ...draft, models: draft.models ?? current.models }), id, createdAt: current.createdAt, updatedAt: new Date().toISOString() };
    // Contact history is edited only through the dedicated record action.
    updated.contactHistory = current.contactHistory || [];
    updated.importPhones = [...new Set([...(current.importPhones || []), current.phone, updated.phone].filter(Boolean))];
    if (this.customers.some((customer) => customer.id !== id && customerKey(customer.displayName) === customerKey(updated.displayName))) throw new Error("已存在同名同国家的客户。");
    if (updated.phone && this.customers.some((customer) => customer.id !== id && (customer.phone === updated.phone || customer.importPhones?.includes(updated.phone)))) throw new Error("此 WhatsApp 号码已存在于其他客户中。");
    if (updated.phone && this.deletedCustomers.some((customer) => [customer.phone, ...(customer.importPhones || [])].includes(updated.phone))) throw new Error("此号码属于已删除客户，无法重新添加。");
    this.#commit(this.customers.map(customer => customer.id === id ? updated : customer));
    return this.list();
  }

  recordContact(id, date = shanghaiDate(), eventId = randomUUID()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + "T00:00:00Z")) || new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date) throw new Error("联系日期无效。");
    const current = this.customers.find(customer => customer.id === id);
    if (!current) throw new Error("客户不存在。");
    if (current.contactHistory?.some(entry => entry.id === eventId)) return this.list();
    const updated = { ...current, contactHistory: [...(current.contactHistory || []), { id: eventId, date }], updatedAt: new Date().toISOString() };
    if (!updated.status || updated.status === "new") updated.status = "contacted";
    this.#commit(this.customers.map(customer => customer.id === id ? updated : customer));
    return this.list();
  }

  remove(id) {
    const customer = this.customers.find((customer) => customer.id === id);
    if (!customer) throw new Error("客户不存在。");
    const deleted = { id: customer.id, name: customer.name, country: customer.country, displayName: customer.displayName, phone: customer.phone, importPhones: [...new Set([...(customer.importPhones || []), customer.phone].filter(Boolean))], deletedAt: new Date().toISOString() };
    this.#commit(this.customers.filter(customer => customer.id !== id), [...this.deletedCustomers, deleted]);
    return this.list();
  }

  #read() {
    try {
      if (!fs.existsSync(this.filePath)) return { version: 2, customers: [], deletedCustomers: [] };
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      if (!Array.isArray(parsed.customers) || (parsed.deletedCustomers !== undefined && !Array.isArray(parsed.deletedCustomers))) throw new Error("客户数据结构无效");
      return parsed;
    } catch (error) { throw new Error(`客户名单文件无法读取: ${error.message}`); }
  }

  #commit(customers, deletedCustomers = this.deletedCustomers) {
    const document = { ...this.document, version: 2, customers, deletedCustomers };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(document, null, 2), "utf8");
    fs.renameSync(temporaryPath, this.filePath);
    this.document = document;
    this.customers = customers;
    this.deletedCustomers = deletedCustomers;
  }
}

function shanghaiDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function createCustomer(draft) {
  const name = validateValue(draft?.name, "客户名称", 100);
  const country = String(draft?.country || "").trim();
  if (country.length > 40) throw new Error("国家名称过长。");
  return {
    id: randomUUID(),
    name,
    country,
    displayName: country ? `${name}-${country}` : name,
    phone: normalizePhone(draft.phone),
    importPhones: normalizePhone(draft.phone) ? [normalizePhone(draft.phone)] : [],
    models: normalizeModels(draft.models),
    contact: String(draft.contact || "").trim().slice(0, 100),
    status: ["new", "contacted", "replied", "won", "archived"].includes(draft.status) ? draft.status : "new",
    notes: String(draft.notes || "").trim().slice(0, 4000),
    createdAt: new Date().toISOString(),
  };
}

function validateValue(value, label, maxLength) {
  const cleanValue = String(value || "").trim().replace(/\s+/g, " ");
  if (!cleanValue || cleanValue.length > maxLength) {
    throw new Error(`${label}无效。`);
  }
  return cleanValue;
}

function customerKey(displayName) {
  return String(displayName || "").trim().toLocaleLowerCase();
}

function normalizePhone(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const phone = raw.replace(/[\s()+.-]/g, "").replace(/^00/, "");
  if (!/^[1-9]\d{6,14}$/.test(phone)) throw new Error("WhatsApp 号码需含国际区号，长度为 7–15 位数字。");
  return phone;
}

function normalizeModels(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim() || item.trim().length > 60)) throw new Error("车型分类无效，每个车型名称最多60字。");
  return [...new Set(value.map((item) => item.trim().replace(/\s+/g, " ")))];
}

module.exports = { CustomerStore, createCustomer };

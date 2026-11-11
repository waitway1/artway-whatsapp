const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("artway", {
  addMessageAttachments: (kind) => ipcRenderer.invoke('campaigns:add-attachments',kind),
  resolveMessageAttachments: (ids) => ipcRenderer.invoke('campaigns:attachments',ids),
  campaignState: () => ipcRenderer.invoke('campaigns:state'),
  saveMessageTemplate: (input) => ipcRenderer.invoke('campaigns:save-template', input),
  removeMessageTemplate: (id) => ipcRenderer.invoke('campaigns:remove-template', id),
  startCampaign: (input) => ipcRenderer.invoke('campaigns:start', input),
  controlCampaign: (id, action) => ipcRenderer.invoke('campaigns:control', id, action),
  onCampaignUpdate: (listener) => {
    const handler = (_event, job) => listener(job);
    ipcRenderer.on('campaigns:update', handler);
    return () => ipcRenderer.removeListener('campaigns:update', handler);
  },
  listAccounts: () => ipcRenderer.invoke("accounts:list"),
  createAccount: (input) => ipcRenderer.invoke("accounts:create", input),
  renameAccount: (input) => ipcRenderer.invoke("accounts:rename", input),
  removeAccount: (id) => ipcRenderer.invoke("accounts:remove", id),
  activateAccount: (id) => ipcRenderer.invoke("accounts:activate", id),
  updateCustomer: (id, draft) => ipcRenderer.invoke("customers:update", id, draft),
  recordCustomerContact: (id) => ipcRenderer.invoke("customers:record-contact", id),
  removeCustomer: (id) => ipcRenderer.invoke("customers:remove", id),
  openCustomerChat: (id, accountId) => ipcRenderer.invoke("customers:open-chat", id, accountId),
  downloadCustomerTemplate: () => ipcRenderer.invoke("customers:download-template"),
  listCustomers: () => ipcRenderer.invoke("customers:list"),
  selectCustomerExcel: () => ipcRenderer.invoke("customers:select-excel"),
  importCustomers: (token, model) => ipcRenderer.invoke("customers:import", token, model),
  reloadActiveAccount: () => ipcRenderer.invoke("browser:reload"),
  setBrowserBounds: (bounds) => ipcRenderer.invoke("browser:set-bounds", bounds),
  setBrowserVisible: (visible) => ipcRenderer.invoke("browser:set-visible", visible),
  onAccountStatus: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("accounts:status", handler);
    return () => ipcRenderer.removeListener("accounts:status", handler);
  },
});

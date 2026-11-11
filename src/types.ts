export type AccountRuntimeStatus = "idle" | "loading" | "ready" | "error";

export type ProfileRegion = "local" | "zh-CN" | "en-US" | "en-GB" | "de-DE";

export interface BrowserFingerprint {
  locale: string;
  languages: string[];
  timezone: string;
  userAgent: string;
  platform: "Win32";
  hardwareConcurrency: number;
  profileCode: string;
}

export interface WhatsAppAccount {
  id: string;
  name: string;
  region: ProfileRegion;
  createdAt: string;
  lastOpenedAt: string | null;
  fingerprint: BrowserFingerprint;
}

export type CustomerStatus = "new" | "contacted" | "replied" | "won" | "archived";
export interface CustomerDraft { models?: string[]; name: string; country: string; phone?: string; contact?: string; status?: CustomerStatus; notes?: string; }
export interface Customer {
  contactHistory?: Array<{ id: string; date: string }>;
  models?: string[];
  id: string;
  name: string;
  country: string;
  displayName: string;
  phone?: string;
  contact?: string;
  status?: CustomerStatus;
  notes?: string;
  createdAt: string;
}

export interface CustomerImportDraft {
  name: string;
  country: string;
  displayName: string;
}

export interface CustomerImportSelection {
  cancelled: boolean;
  token?: string;
  fileName?: string;
  suggestedModel?: string;
  sheetName?: string;
  candidateCount?: number;
  invalidRows?: number;
  customers?: CustomerImportDraft[];
}

export interface CustomerImportResult {
  created: number;
  skippedDuplicate: number;
  skippedDeleted?: number;
  updatedCategories?: number;
  invalidRows: number;
  customers: Customer[];
}

export interface AccountStatusEvent {
  accountId: string;
  status: AccountRuntimeStatus;
  detail?: string;
}

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ArtwayApi {
  addMessageAttachments: (kind: 'image' | 'file') => Promise<MessageAttachment[]>;
  resolveMessageAttachments: (ids: string[]) => Promise<MessageAttachment[]>;
  campaignState: () => Promise<CampaignState>;
  saveMessageTemplate: (input: { id?: string; name: string; body: string; attachmentIds?: string[] }) => Promise<MessageTemplate>;
  removeMessageTemplate: (id: string) => Promise<CampaignState>;
  startCampaign: (input: { testPhone?: string; attachmentIds?: string[]; body: string; accountId: string; customerIds: string[]; cooldownDays: number; intervalSeconds: number }) => Promise<CampaignJob>;
  controlCampaign: (id: string, action: 'pause' | 'resume' | 'cancel') => Promise<CampaignJob>;
  onCampaignUpdate: (listener: (job: CampaignJob) => void) => () => void;
  listAccounts: () => Promise<WhatsAppAccount[]>;
  createAccount: (input: { name: string; region: ProfileRegion }) => Promise<WhatsAppAccount>;
  renameAccount: (input: { id: string; name: string }) => Promise<WhatsAppAccount>;
  removeAccount: (id: string) => Promise<{ ok: true }>;
  activateAccount: (id: string) => Promise<WhatsAppAccount>;
  updateCustomer: (id: string, draft: CustomerDraft) => Promise<Customer[]>;
  recordCustomerContact: (id: string) => Promise<Customer[]>;
  removeCustomer: (id: string) => Promise<Customer[]>;
  openCustomerChat: (id: string, accountId: string) => Promise<{ ok: true }>;
  downloadCustomerTemplate: () => Promise<{ cancelled: boolean; filePath?: string }>;
  listCustomers: () => Promise<Customer[]>;
  selectCustomerExcel: () => Promise<CustomerImportSelection>;
  importCustomers: (token: string, model: string) => Promise<CustomerImportResult>;
  reloadActiveAccount: () => Promise<{ ok: true }>;
  setBrowserBounds: (bounds: BrowserBounds) => Promise<{ ok: true }>;
  setBrowserVisible: (visible: boolean) => Promise<{ ok: true }>;
  onAccountStatus: (listener: (event: AccountStatusEvent) => void) => () => void;
}

export interface MessageAttachment { id: string; name: string; kind: "image" | "file"; size: number; previewUrl?: string; }
export interface MessageTemplate { attachmentIds?: string[]; id: string; name: string; body: string; updatedAt: string; }
export type SendStatus = 'pending' | 'sending' | 'succeeded' | 'failed' | 'unconfirmed' | 'skipped' | 'cancelled';
export interface CampaignRow { id: string; customerId: string | null; noCustomerContact?: boolean; name: string; country: string; phone: string; message: string; status: SendStatus; reason: string; sentDate?: string; contactRecorded?: boolean; }
export interface CampaignJob { id: string; title: string; accountId: string; accountName: string; body: string; cooldownDays: number; intervalSeconds: number; status: 'running' | 'paused' | 'completed' | 'cancelled' | 'interrupted'; createdAt: string; rows: CampaignRow[]; }
export interface CampaignState { templates: MessageTemplate[]; jobs: CampaignJob[]; }

declare global {
  interface Window {
    artway: ArtwayApi;
  }
}

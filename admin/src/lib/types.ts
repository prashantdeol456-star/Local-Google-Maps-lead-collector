// Shapes returned by the backend API.

export interface Admin {
  id: string;
  email: string;
  name: string | null;
  /** super_admin manages users and sees everyone's data; customer sees only their own */
  role: "super_admin" | "customer";
}

export interface UserAccount {
  id: string;
  email: string;
  username: string | null;
  phone: string | null;
  name: string | null;
  role: "super_admin" | "customer";
  status: "pending" | "active" | "disabled";
  approvedAt: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface Lead {
  id: string;
  placeId: string | null;
  name: string;
  category: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  rating: number | null;
  reviewCount: number | null;
  mapsUrl: string | null;
  searchKeyword: string | null;
  source: string;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

export type JobStatus = "pending" | "running" | "paused" | "completed" | "failed" | "stopped";

export interface Job {
  id: string;
  searchKeyword: string;
  location: string | null;
  maxRecords: number | null;
  status: JobStatus;
  statusReason: string | null;
  totalFound: number;
  newRecords: number;
  duplicateRecords: number;
  errorRecords: number;
  queueId: string | null;
  position: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentLog {
  id: string;
  jobId: string | null;
  action: string;
  status: "info" | "success" | "warning" | "error";
  message: string | null;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Stats {
  totalLeads: number;
  todayLeads: number;
  totalDuplicates: number;
  totalCollections: number;
  completedJobs: number;
  activeJob: Job | null;
  emailsSent: number;
  whatsappSent: number;
  timeZone: string;
}

export interface Facets {
  cities: { value: string; count: number }[];
  states: { value: string; count: number }[];
  categories: { value: string; count: number }[];
  keywords: { value: string; count: number }[];
}

export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  current: boolean;
  /** full | read */
  scope?: string;
}

// ---- Email outreach ----

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export type CampaignStatus = "draft" | "running" | "paused" | "completed" | "stopped";
export type AttemptStatus = "queued" | "sending" | "sent" | "delivered" | "failed" | "skipped" | "cancelled";

export interface Campaign {
  id: string;
  name: string;
  templateId: string;
  provider: string;
  status: CampaignStatus;
  statusReason: string | null;
  intervalSec: number;
  dailyLimit: number;
  windowStart: string;
  windowEnd: string;
  timeZone: string;
  startAt: string | null;
  lastSentAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface CampaignDetail {
  campaign: Campaign;
  template: EmailTemplate | null;
  counts: Partial<Record<AttemptStatus, number>>;
  tracking: Record<"deliveredAt" | "openedAt" | "clickedAt" | "bouncedAt" | "complainedAt" | "repliedAt" | "readAt", number>;
  sentToday: number;
  nextSendAt: string | null;
  waitingFor: "not_started" | "outside_window" | "daily_limit" | "interval" | null;
}

export interface Attempt {
  id: string;
  leadId: string;
  campaignId: string | null;
  campaignName: string | null;
  channel: "email" | "whatsapp";
  provider: string;
  status: AttemptStatus;
  toAddress: string;
  renderedSubject: string | null;
  renderedBody: string | null;
  externalMessageId: string | null;
  tries: number;
  nextTryAt: string | null;
  error: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  openedAt: string | null;
  clickedAt: string | null;
  bouncedAt: string | null;
  complainedAt: string | null;
  repliedAt: string | null;
  readAt: string | null;
  createdAt: string;
}

export type EmailEventType =
  | "sent" | "delivered" | "delivery_delayed" | "opened" | "clicked" | "bounced" | "complained" | "failed" | "replied" | "unsubscribed";

export interface EmailEvent {
  id: string;
  type: EmailEventType;
  attemptId: string | null;
  source: string;
  metadata: Record<string, unknown> | null;
  occurredAt: string;
}

export interface RecipientSummary {
  selected: number;
  eligible: number;
  skipped: { noEmail: number; optedOut: number; duplicateEmail: number };
}

export interface RenderedPreview {
  subject: string;
  text: string;
  html: string;
  lead: string;
}

// ---- WhatsApp outreach ----

export type ApprovalStatus = "pending" | "approved" | "rejected" | "paused" | "disabled";

export interface WhatsAppTemplate {
  id: string;
  name: string;
  body: string;
  language: string | null;
  category: "marketing" | "utility" | "authentication" | null;
  paramFormat: "positional" | "named" | null;
  externalTemplateId: string | null;
  approvalStatus: ApprovalStatus | null;
  provider: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WhatsAppPreview {
  text: string;
  providerBody: string;
  params: { name?: string; value: string }[];
  missing: string[];
  lead: string;
}

export interface WhatsAppRecipientSummary {
  selected: number;
  eligible: number;
  skipped: { noPhone: number; noOptIn: number; optedOut: number; duplicatePhone: number; missingValue: number };
}

export interface CommunicationPreference {
  emailAllowed: boolean;
  whatsappAllowed: boolean;
  whatsappOptInAt: string | null;
  whatsappOptInSource: string | null;
  optedOut: boolean;
  optOutReason: string | null;
  optedOutAt: string | null;
  updatedAt: string;
}

export type WhatsAppEventType = "sent" | "delivered" | "read" | "failed" | "received" | "opted_out" | "marketing_resumed";

export interface WhatsAppEvent {
  id: string;
  type: WhatsAppEventType;
  attemptId: string | null;
  leadId: string | null;
  phone: string | null;
  provider: string;
  text: string | null;
  metadata: { error?: string; reason?: string; profileName?: string | null; messageType?: string } | null;
  occurredAt: string;
}

export interface InboxMessage extends WhatsAppEvent {
  leadName: string | null;
}

// ---- Opt-outs ----

export interface Suppression {
  id: string;
  channel: "email" | "whatsapp";
  address: string;
  reason: string;
  source: string;
  leadId: string | null;
  createdAt: string;
}

export interface LeadPreferences {
  preference: CommunicationPreference | null;
  suppressions: { email: Suppression[]; whatsapp: Suppression[] };
  addresses: { email: string[]; whatsapp: string[] };
}

export interface SuppressionPage extends Page<Suppression & { leadName: string | null }> {
  counts: { email: number; whatsapp: number };
}

// ---- Integrations (n8n) ----

export type IntegrationEventType = "lead.created" | "collection.finished" | "campaign.completed" | "reply.received" | "optout.recorded";

export interface WebhookEndpoint {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  events: IntegrationEventType[];
  /** Masked: whsec_••••abcd */
  secret: string;
  createdAt: string;
  updatedAt: string;
  deliveries?: Record<"pending" | "delivered" | "failed", number>;
}

export interface WebhookDelivery {
  id: string;
  eventId: string;
  event: string;
  payload: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  nextAttemptAt: string;
  responseStatus: number | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export type DeliveryResult = { ok: true; status: number } | { ok: false; status: number | null; error: string };

export interface LinkedInLead {
  id: string;
  profileUrl: string;
  name: string;
  headline: string | null;
  company: string | null;
  location: string | null;
  emails: string[];
  phones: string[];
  websites: { url: string; label: string | null }[];
  ims: string[];
  experience: { title: string; company: string | null; employmentType: string | null; dates: string | null; location: string | null }[];
  education: { school: string; degree: string | null; dates: string | null }[];
  birthday: string | null;
  address: string | null;
  connectedSince: string | null;
  notes: string | null;
  tag: string | null;
  source: "extension" | "csv" | "admin";
  hasEmail: boolean;
  hasPhone: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LinkedInLeadPage {
  items: LinkedInLead[];
  total: number;
  page: number;
  pageSize: number;
}

export interface LinkedInFacets {
  total: number;
  withEmail: number;
  withPhone: number;
  withWebsite: number;
  tags: { value: string; count: number }[];
  companies: { value: string; count: number }[];
  sources: { value: string; count: number }[];
}

export interface LinkedInImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: { line: number; reason: string }[];
}

// ---- Contacts (uploaded sheets), SMS/LinkedIn templates, LinkedIn campaigns, campaign logs ----

export interface Contact {
  id: string;
  name: string;
  linkedinUrl: string | null;
  instagramUrl: string | null;
  email: string | null;
  phone: string | null;
  designation: string | null;
  company: string | null;
  listName: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContactFacets {
  total: number;
  withLinkedIn: number;
  withInstagram: number;
  withEmail: number;
  withPhone: number;
  lists: { value: string; count: number }[];
}

export interface ContactImportResult {
  created: number;
  updated: number;
  duplicatesInFile: number;
  errors: { line: number; reason: string }[];
  total: number;
}

export type ContactTemplateChannel = "sms" | "linkedin" | "instagram";

export interface ChannelTemplate {
  id: string;
  channel: ContactTemplateChannel;
  name: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelTemplatePreview {
  contact: string;
  text: string;
  characters: number;
  limit: number;
  sms?: { encoding: "GSM-7" | "Unicode"; characters: number; parts: number };
}

export type LinkedInSendMode = "assisted" | "auto";

export interface LinkedInCampaign {
  id: string;
  name: string;
  templateId: string;
  status: CampaignStatus;
  statusReason: string | null;
  mode: LinkedInSendMode;
  intervalSec: number;
  dailyLimit: number;
  windowStart: string;
  windowEnd: string;
  timeZone: string;
  startAt: string | null;
  lastSentAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface LinkedInCampaignDetail {
  campaign: LinkedInCampaign;
  template: ChannelTemplate | null;
  counts: Partial<Record<AttemptStatus, number>>;
  sentToday: number;
  nextSendAt: string | null;
  waitingFor: "not_started" | "outside_window" | "daily_limit" | "interval" | "extension" | null;
}

export interface LinkedInMessage {
  id: string;
  campaignId: string;
  contactId: string | null;
  profileUrl: string;
  contactName: string;
  renderedBody: string;
  status: AttemptStatus;
  error: string | null;
  claimedAt: string | null;
  sentAt: string | null;
  failedAt: string | null;
  updatedAt: string;
}

export interface LinkedInRecipientSummary {
  selected: number;
  eligible: number;
  noLinkedIn: number;
  tooMany: boolean;
}

export type LogChannel = "email" | "whatsapp" | "linkedin" | "instagram";

export interface CampaignSummary {
  id: string;
  channel: LogChannel;
  name: string;
  status: CampaignStatus;
  statusReason: string | null;
  mode: LinkedInSendMode | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  lastSentAt: string | null;
  counts: Partial<Record<AttemptStatus, number>>;
  total: number;
}

export interface CampaignLogEntry {
  id: string;
  channel: LogChannel;
  campaignId: string | null;
  campaignName: string | null;
  recipient: string;
  to: string;
  status: AttemptStatus;
  error: string | null;
  sentAt: string | null;
  updatedAt: string;
}

export interface CampaignEvent {
  id: string;
  action: string;
  status: "info" | "success" | "warning" | "error";
  message: string | null;
  createdAt: string;
}

// Repository interfaces. Services depend on these, never on Prisma directly.
import type { JobStatus } from "@platform/shared";

export interface AdminUserRecord {
  id: string;
  email: string;
  name: string | null;
  passwordHash: string;
  createdAt: Date;
  lastLoginAt: Date | null;
}

export interface SessionRecord {
  id: string;
  tokenHash: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface AdminUserRepository {
  count(): Promise<number>;
  findByEmail(email: string): Promise<AdminUserRecord | null>;
  findById(id: string): Promise<AdminUserRecord | null>;
  create(data: { email: string; name?: string | null; passwordHash: string }): Promise<AdminUserRecord>;
  touchLastLogin(id: string, at: Date): Promise<void>;
}

export interface SessionRepository {
  create(data: { tokenHash: string; userId: string; expiresAt: Date }): Promise<SessionRecord>;
  findByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  deleteByTokenHash(tokenHash: string): Promise<void>;
  deleteExpired(now: Date): Promise<number>;
}

export interface ApiTokenRecord {
  id: string;
  name: string;
  prefix: string;
  tokenHash: string;
  userId: string;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  /** full | read */
  scope: string;
  createdAt: Date;
}

export interface ApiTokenRepository {
  create(data: { name: string; prefix: string; tokenHash: string; userId: string; expiresAt: Date | null; scope?: string }): Promise<ApiTokenRecord>;
  findByTokenHash(tokenHash: string): Promise<ApiTokenRecord | null>;
  listActiveByUser(userId: string, now: Date): Promise<ApiTokenRecord[]>;
  /** Revokes only if the token belongs to the user; returns false otherwise. */
  revoke(id: string, userId: string, at: Date): Promise<boolean>;
  touchLastUsed(id: string, at: Date): Promise<void>;
}

// ---- Leads ----

export interface LeadRecord {
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
  normalizedName: string;
  normalizedPhone: string | null;
  normalizedWebsite: string | null;
  normalizedAddress: string | null;
  dedupeKey: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export const LEAD_SORT_FIELDS = ["createdAt", "name", "city", "category", "rating", "reviewCount"] as const;
export type LeadSortField = (typeof LEAD_SORT_FIELDS)[number];

export interface LeadListQuery {
  /** Free-text search over name, phone, website, address. */
  q?: string;
  city?: string;
  state?: string;
  category?: string;
  searchKeyword?: string;
  /** true = has a value, false = empty */
  hasPhone?: boolean;
  hasEmail?: boolean;
  hasWebsite?: boolean;
  minRating?: number;
  minReviews?: number;
  /** Added at or after / before these instants (date filter) */
  createdFrom?: Date;
  createdUntil?: Date;
  /** Only leads created before this instant (stable snapshots for exports). */
  createdBefore?: Date;
  sort: LeadSortField;
  order: "asc" | "desc";
  skip: number;
  take: number;
}

/** Fields written when creating a lead (timestamps are set by the database). */
export type LeadCreateData = Omit<LeadRecord, "id" | "createdAt" | "updatedAt" | "firstSeenAt" | "lastSeenAt">;

/** Fields that may be filled in on an existing lead (never overwritten). */
export type LeadFillableData = Partial<
  Omit<LeadRecord, "id" | "name" | "normalizedName" | "dedupeKey" | "source" | "createdAt" | "updatedAt" | "firstSeenAt" | "lastSeenAt">
>;

export interface LeadRepository {
  list(query: LeadListQuery): Promise<{ items: LeadRecord[]; total: number }>;
  findById(id: string): Promise<LeadRecord | null>;
  /** Leads with these ids, oldest first (missing ids are skipped). */
  findByIds(ids: string[]): Promise<LeadRecord[]>;
  delete(id: string): Promise<boolean>;
  count(): Promise<number>;
  countCreatedSince(since: Date): Promise<number>;

  // Duplicate lookups (all on indexed columns)
  findByPlaceId(placeId: string): Promise<LeadRecord | null>;
  findByNormalizedPhone(phone: string): Promise<LeadRecord[]>;
  findByNormalizedWebsite(website: string): Promise<LeadRecord[]>;
  findByNameAddress(normalizedName: string, normalizedAddress: string): Promise<LeadRecord[]>;

  create(data: LeadCreateData): Promise<LeadRecord>;
  /** Sets the given (previously empty) fields and lastSeenAt. */
  update(id: string, data: LeadFillableData & { lastSeenAt: Date }): Promise<LeadRecord>;
  /** Admin edit: overwrites the given fields. Returns null if the lead does not exist. */
  edit(id: string, data: LeadEditData): Promise<LeadRecord | null>;
  /** Distinct values with counts, most common first (for filter dropdowns). */
  facets(limit: number): Promise<LeadFacets>;
}

export const LEAD_EDITABLE_FIELDS = [
  "name", "category", "phone", "email", "website", "address", "city", "state", "country", "postalCode",
] as const;
export type LeadEditableField = (typeof LEAD_EDITABLE_FIELDS)[number];

export type LeadEditData = Partial<Pick<LeadRecord, LeadEditableField | "normalizedName" | "normalizedPhone" | "normalizedWebsite" | "normalizedAddress">>;

export interface FacetValue {
  value: string;
  count: number;
}

export interface LeadFacets {
  cities: FacetValue[];
  states: FacetValue[];
  categories: FacetValue[];
  keywords: FacetValue[];
}

// ---- Collection jobs ----

export interface JobRecord {
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
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdById: string | null;
}

export interface JobCreateData {
  searchKeyword: string;
  location: string | null;
  maxRecords: number | null;
  createdById: string | null;
  queueId?: string | null;
  position?: number | null;
}

export interface JobListQuery {
  status?: JobStatus;
  queueId?: string;
  skip: number;
  take: number;
}

export interface JobStatusUpdate {
  status: JobStatus;
  statusReason: string | null;
  startedAt?: Date;
  completedAt?: Date;
}

export interface JobRepository {
  create(data: JobCreateData): Promise<JobRecord>;
  findById(id: string): Promise<JobRecord | null>;
  list(query: JobListQuery): Promise<{ items: JobRecord[]; total: number }>;
  /**
   * Applies the update only if the job is still in `expectedStatus` (optimistic concurrency).
   * Returns the updated job, or null if the status changed in the meantime.
   */
  updateStatus(id: string, expectedStatus: JobStatus, update: JobStatusUpdate): Promise<JobRecord | null>;
  findOtherWithStatus(status: JobStatus, excludeId: string): Promise<JobRecord | null>;
  /** Most recently updated running or paused job. */
  findLatestActive(): Promise<JobRecord | null>;
  count(status?: JobStatus): Promise<number>;
  incrementCounters(
    id: string,
    by: { totalFound?: number; newRecords?: number; duplicateRecords?: number; errorRecords?: number },
  ): Promise<JobRecord>;
}

export type JobItemResult = "new" | "duplicate" | "error";

export interface JobItemRecord {
  id: string;
  jobId: string;
  clientKey: string;
  result: JobItemResult;
  matchedBy: string | null;
  leadId: string | null;
  error: string | null;
  createdAt: Date;
}

export interface JobItemRepository {
  countByResult(result: JobItemResult): Promise<number>;
  find(jobId: string, clientKey: string): Promise<JobItemRecord | null>;
  create(data: { jobId: string; clientKey: string; result: JobItemResult; matchedBy: string | null; leadId: string | null; error?: string | null }): Promise<JobItemRecord>;
}

// ---- Agent logs ----

export type AgentLogLevel = "info" | "success" | "warning" | "error";

export interface AgentLogRecord {
  id: string;
  jobId: string | null;
  action: string;
  status: AgentLogLevel;
  message: string | null;
  createdAt: Date;
}

export interface AgentLogRepository {
  create(data: { jobId: string | null; action: string; status: AgentLogLevel; message?: string | null }): Promise<AgentLogRecord>;
  listByJob(jobId: string, take: number): Promise<AgentLogRecord[]>;
  countByJob(jobId: string, action: string): Promise<number>;
}

// ---- Outreach ----

export type Channel = "email" | "whatsapp";
/** Templates can be written for more channels than Campaign/ContactAttempt send. */
export type TemplateChannel = Channel | "sms" | "linkedin" | "instagram";
export type CampaignStatus = "draft" | "running" | "paused" | "completed" | "stopped";
export type AttemptStatus = "queued" | "sending" | "sent" | "delivered" | "failed" | "skipped" | "cancelled";

export interface TemplateRecord {
  id: string;
  channel: TemplateChannel;
  name: string;
  subject: string | null;
  body: string;
  provider: string | null;
  language: string | null;
  category: string | null;
  externalTemplateId: string | null;
  approvalStatus: string | null;
  paramFormat: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Writable template fields (the WhatsApp ones stay null for email templates). */
export type TemplateWriteData = Pick<TemplateRecord, "name" | "subject" | "body"> &
  Partial<Pick<TemplateRecord, "provider" | "language" | "category" | "externalTemplateId" | "approvalStatus" | "paramFormat">>;

export interface TemplateRepository {
  list(channel: TemplateChannel): Promise<TemplateRecord[]>;
  findById(id: string): Promise<TemplateRecord | null>;
  create(data: { channel: TemplateChannel } & TemplateWriteData): Promise<TemplateRecord>;
  update(id: string, data: Partial<TemplateWriteData>): Promise<TemplateRecord | null>;
  delete(id: string): Promise<boolean>;
  countCampaigns(id: string): Promise<number>;
}

export interface CampaignRecord {
  id: string;
  channel: Channel;
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
  startAt: Date | null;
  lastSentAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CampaignCreateData = Pick<
  CampaignRecord,
  "channel" | "name" | "templateId" | "provider" | "intervalSec" | "dailyLimit" | "windowStart" | "windowEnd" | "timeZone" | "startAt" | "createdById"
>;

export interface CampaignRepository {
  create(data: CampaignCreateData): Promise<CampaignRecord>;
  findById(id: string): Promise<CampaignRecord | null>;
  list(query: { channel: Channel; skip: number; take: number }): Promise<{ items: CampaignRecord[]; total: number }>;
  listByStatus(status: CampaignStatus, channel: Channel): Promise<CampaignRecord[]>;
  /** Optimistic: only if still in one of `from`. Returns null when the status changed meanwhile. */
  updateStatus(id: string, from: CampaignStatus[], data: Partial<Pick<CampaignRecord, "status" | "statusReason" | "startedAt" | "completedAt">>): Promise<CampaignRecord | null>;
  touchLastSent(id: string, at: Date): Promise<void>;
}

export interface AttemptRecord {
  id: string;
  leadId: string;
  campaignId: string | null;
  channel: Channel;
  provider: string;
  status: AttemptStatus;
  templateId: string | null;
  toAddress: string;
  renderedSubject: string | null;
  renderedBody: string | null;
  externalMessageId: string | null;
  tries: number;
  nextTryAt: Date | null;
  error: string | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
  openedAt: Date | null;
  clickedAt: Date | null;
  bouncedAt: Date | null;
  complainedAt: Date | null;
  repliedAt: Date | null;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type TrackedField = "deliveredAt" | "openedAt" | "clickedAt" | "bouncedAt" | "complainedAt" | "repliedAt" | "readAt";

export interface AttemptRepository {
  findById(id: string): Promise<AttemptRecord | null>;
  findByExternalId(externalMessageId: string): Promise<AttemptRecord | null>;
  /** Sets the timestamp only if it is still empty (first occurrence wins). */
  markFirst(id: string, field: TrackedField, at: Date): Promise<void>;
  /** Attempts of a campaign that have each tracking timestamp set. */
  trackingCounts(campaignId: string): Promise<Record<TrackedField, number>>;
  createMany(data: { leadId: string; campaignId: string; channel: Channel; provider: string; templateId: string; toAddress: string }[]): Promise<number>;
  countByStatus(campaignId: string): Promise<Partial<Record<AttemptStatus, number>>>;
  list(query: { campaignId?: string; leadId?: string; status?: AttemptStatus; skip: number; take: number }): Promise<{ items: (AttemptRecord & { campaignName: string | null })[]; total: number }>;
  countSentSince(campaignId: string, since: Date): Promise<number>;
  countSentTotal(channel: Channel): Promise<number>;
  /** Oldest queued attempt that may be tried now. */
  nextDue(campaignId: string, now: Date): Promise<AttemptRecord | null>;
  /** Most recent WhatsApp message actually sent to this number ("+91…"). */
  findLatestWhatsAppTo(phone: string): Promise<AttemptRecord | null>;
  /** Updates only while the status is one of `from` (webhooks must not move a status backwards). */
  advanceStatus(id: string, from: AttemptStatus[], data: Partial<Omit<AttemptRecord, "id" | "createdAt" | "updatedAt">>): Promise<boolean>;
  /** queued → sending, only if still queued (so two workers can never send the same attempt). */
  claim(id: string): Promise<boolean>;
  update(id: string, data: Partial<Omit<AttemptRecord, "id" | "createdAt" | "updatedAt">>): Promise<void>;
  cancelQueued(campaignId: string): Promise<number>;
  /** Attempts of a channel left in "sending" by a crash. */
  failStuckSending(channel: Channel, error: string, at: Date): Promise<number>;
  hasPending(campaignId: string): Promise<boolean>;
}

export interface PreferenceRecord {
  leadId: string;
  emailAllowed: boolean;
  whatsappAllowed: boolean;
  whatsappOptInAt: Date | null;
  whatsappOptInSource: string | null;
  optedOut: boolean;
  optOutReason: string | null;
  optedOutAt: Date | null;
  updatedAt: Date;
}

export interface PreferenceRepository {
  find(leadId: string): Promise<PreferenceRecord | null>;
  findMany(leadIds: string[]): Promise<PreferenceRecord[]>;
  upsert(leadId: string, data: Partial<Omit<PreferenceRecord, "leadId" | "updatedAt">>): Promise<PreferenceRecord>;
}

export type EmailEventType =
  | "sent" | "delivered" | "delivery_delayed" | "opened" | "clicked" | "bounced" | "complained" | "failed" | "replied" | "unsubscribed";

export interface EmailEventRecord {
  id: string;
  type: EmailEventType;
  attemptId: string | null;
  leadId: string | null;
  providerEventId: string | null;
  source: string;
  metadata: string | null;
  occurredAt: Date;
  createdAt: Date;
}

export interface EmailEventRepository {
  /** Returns null when an event with the same providerEventId was already stored. */
  create(data: Omit<EmailEventRecord, "id" | "createdAt">): Promise<EmailEventRecord | null>;
  listByLead(leadId: string, take: number): Promise<EmailEventRecord[]>;
  findById(id: string): Promise<EmailEventRecord | null>;
}

export type WhatsAppEventType = "sent" | "delivered" | "read" | "failed" | "received" | "opted_out" | "marketing_resumed";

export interface WhatsAppEventRecord {
  id: string;
  type: WhatsAppEventType;
  attemptId: string | null;
  leadId: string | null;
  phone: string | null;
  providerEventId: string | null;
  externalMessageId: string | null;
  provider: string;
  text: string | null;
  metadata: string | null;
  occurredAt: Date;
  createdAt: Date;
}

export interface WhatsAppEventRepository {
  /** Returns null when an event with the same providerEventId was already stored. */
  create(data: Omit<WhatsAppEventRecord, "id" | "createdAt">): Promise<WhatsAppEventRecord | null>;
  listByLead(leadId: string, take: number): Promise<WhatsAppEventRecord[]>;
  findById(id: string): Promise<WhatsAppEventRecord | null>;
  /** Received messages, newest first, with the lead name when matched. */
  listReceived(page: { skip: number; take: number }): Promise<{ items: (WhatsAppEventRecord & { leadName: string | null })[]; total: number }>;
}

export interface SuppressionRecord {
  id: string;
  channel: Channel;
  address: string;
  reason: string;
  source: string;
  leadId: string | null;
  createdAt: Date;
}

export interface SuppressionRepository {
  /** Adds the entries that are not suppressed yet (the first reason is kept); returns the new ones. */
  addMany(rows: Omit<SuppressionRecord, "id" | "createdAt">[]): Promise<SuppressionRecord[]>;
  /** Entries for any of these addresses on a channel. */
  findByAddresses(channel: Channel, addresses: string[]): Promise<SuppressionRecord[]>;
  findById(id: string): Promise<SuppressionRecord | null>;
  list(query: { channel?: Channel; q?: string; skip: number; take: number }): Promise<{ items: SuppressionRecord[]; total: number }>;
  delete(id: string): Promise<boolean>;
  /** Removes entries for these addresses (optionally only those from one source); returns the count. */
  deleteAddresses(channel: Channel, addresses: string[], source?: string): Promise<number>;
  count(channel: Channel): Promise<number>;
}

export interface WebhookEndpointRecord {
  id: string;
  name: string;
  url: string;
  secretEnc: string;
  secretHint: string;
  /** JSON array of event types */
  events: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type WebhookDeliveryStatus = "pending" | "delivered" | "failed";

export interface WebhookDeliveryRecord {
  id: string;
  endpointId: string;
  eventId: string;
  event: string;
  payload: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  nextAttemptAt: Date;
  responseStatus: number | null;
  lastError: string | null;
  createdAt: Date;
  deliveredAt: Date | null;
}

export interface WebhookRepository {
  listEndpoints(): Promise<WebhookEndpointRecord[]>;
  findEndpoint(id: string): Promise<WebhookEndpointRecord | null>;
  createEndpoint(data: Pick<WebhookEndpointRecord, "name" | "url" | "secretEnc" | "secretHint" | "events" | "enabled">): Promise<WebhookEndpointRecord>;
  updateEndpoint(id: string, data: Partial<Pick<WebhookEndpointRecord, "name" | "url" | "secretEnc" | "secretHint" | "events" | "enabled">>): Promise<WebhookEndpointRecord | null>;
  deleteEndpoint(id: string): Promise<boolean>;
  /** Queues an event for an endpoint; returns null if this event was already queued for it. */
  enqueue(data: { endpointId: string; eventId: string; event: string; payload: string; nextAttemptAt?: Date }): Promise<WebhookDeliveryRecord | null>;
  /** Pending deliveries that are due, oldest first. */
  due(now: Date, take: number): Promise<WebhookDeliveryRecord[]>;
  findDelivery(id: string): Promise<WebhookDeliveryRecord | null>;
  updateDelivery(id: string, data: Partial<Omit<WebhookDeliveryRecord, "id" | "endpointId" | "eventId" | "event" | "payload" | "createdAt">>): Promise<void>;
  listDeliveries(query: { endpointId: string; status?: WebhookDeliveryStatus; skip: number; take: number }): Promise<{ items: WebhookDeliveryRecord[]; total: number }>;
  countDeliveries(endpointId: string): Promise<Record<WebhookDeliveryStatus, number>>;
  /** Deletes deliveries in a final status created before `before`; returns the count. */
  deleteOld(status: "delivered" | "failed", before: Date): Promise<number>;
}

export interface TrackedLinkRepository {
  createMany(links: { id: string; attemptId: string; url: string }[]): Promise<void>;
  findById(id: string): Promise<{ id: string; attemptId: string; url: string } | null>;
}

export interface LinkedInLeadRecord {
  id: string;
  profileUrl: string;
  name: string;
  headline: string | null;
  company: string | null;
  location: string | null;
  /** JSON arrays (see schema.prisma) */
  emails: string;
  phones: string;
  websites: string;
  ims: string;
  experience: string;
  education: string;
  birthday: string | null;
  address: string | null;
  connectedSince: string | null;
  notes: string | null;
  tag: string | null;
  source: string;
  hasEmail: boolean;
  hasPhone: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type LinkedInLeadData = Omit<LinkedInLeadRecord, "id" | "createdAt" | "updatedAt">;

export const LINKEDIN_SORT_FIELDS = ["createdAt", "updatedAt", "name", "company"] as const;

export interface LinkedInLeadFilters {
  q?: string;
  company?: string;
  tag?: string;
  source?: string;
  hasEmail?: boolean;
  hasPhone?: boolean;
  hasWebsite?: boolean;
  sort?: (typeof LINKEDIN_SORT_FIELDS)[number];
  order?: "asc" | "desc";
}

export interface LinkedInLeadRepository {
  findById(id: string): Promise<LinkedInLeadRecord | null>;
  findByProfileUrls(urls: string[]): Promise<LinkedInLeadRecord[]>;
  create(data: LinkedInLeadData): Promise<LinkedInLeadRecord>;
  update(id: string, data: Partial<LinkedInLeadData>): Promise<LinkedInLeadRecord>;
  delete(id: string): Promise<boolean>;
  list(filters: LinkedInLeadFilters & { skip: number; take: number }): Promise<{ items: LinkedInLeadRecord[]; total: number }>;
  /** Pages through the filtered profiles in a stable order (for export). */
  listBatch(filters: LinkedInLeadFilters, cursor: string | null, take: number): Promise<LinkedInLeadRecord[]>;
  facets(): Promise<{
    total: number;
    withEmail: number;
    withPhone: number;
    withWebsite: number;
    tags: { value: string; count: number }[];
    companies: { value: string; count: number }[];
    sources: { value: string; count: number }[];
  }>;
}

// ---- Contacts from uploaded sheets, LinkedIn message campaigns ----

export interface ContactRecord {
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
  createdAt: Date;
  updatedAt: Date;
}

export type ContactData = Omit<ContactRecord, "id" | "createdAt" | "updatedAt">;

export interface ContactFilters {
  q?: string;
  listName?: string;
  hasLinkedIn?: boolean;
  hasInstagram?: boolean;
  hasEmail?: boolean;
  hasPhone?: boolean;
}

export interface ContactRepository {
  findById(id: string): Promise<ContactRecord | null>;
  findByIds(ids: string[]): Promise<ContactRecord[]>;
  findByLinkedInUrls(urls: string[]): Promise<ContactRecord[]>;
  findByInstagramUrls(urls: string[]): Promise<ContactRecord[]>;
  findByEmails(emails: string[]): Promise<ContactRecord[]>;
  create(data: ContactData): Promise<ContactRecord>;
  update(id: string, data: Partial<ContactData>): Promise<ContactRecord>;
  deleteMany(ids: string[]): Promise<number>;
  list(filters: ContactFilters & { skip: number; take: number }): Promise<{ items: ContactRecord[]; total: number }>;
  /** All matching contacts, oldest first, up to `take`. */
  listAll(filters: ContactFilters, take: number): Promise<ContactRecord[]>;
  facets(): Promise<{ total: number; withLinkedIn: number; withInstagram: number; withEmail: number; withPhone: number; lists: { value: string; count: number }[] }>;
}

export type LinkedInSendMode = "assisted" | "auto";

/** Which extension sends a campaign's messages. */
export type OutreachPlatform = "linkedin" | "instagram";

export interface LinkedInCampaignRecord {
  id: string;
  platform: string;
  name: string;
  templateId: string;
  status: CampaignStatus;
  statusReason: string | null;
  mode: string;
  intervalSec: number;
  dailyLimit: number;
  windowStart: string;
  windowEnd: string;
  timeZone: string;
  startAt: Date | null;
  lastSentAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type LinkedInCampaignCreateData = Pick<
  LinkedInCampaignRecord,
  "platform" | "name" | "templateId" | "mode" | "intervalSec" | "dailyLimit" | "windowStart" | "windowEnd" | "timeZone" | "startAt" | "createdById"
>;

export interface LinkedInMessageRecord {
  id: string;
  campaignId: string;
  contactId: string | null;
  profileUrl: string;
  contactName: string;
  renderedBody: string;
  status: AttemptStatus;
  error: string | null;
  claimedAt: Date | null;
  sentAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LinkedInOutreachRepository {
  createCampaign(data: LinkedInCampaignCreateData, messages: Pick<LinkedInMessageRecord, "contactId" | "profileUrl" | "contactName" | "renderedBody">[]): Promise<LinkedInCampaignRecord>;
  findCampaign(id: string): Promise<LinkedInCampaignRecord | null>;
  listCampaigns(page: { skip: number; take: number; platform?: OutreachPlatform }): Promise<{ items: LinkedInCampaignRecord[]; total: number }>;
  listCampaignsByStatus(status: CampaignStatus, platform?: OutreachPlatform): Promise<LinkedInCampaignRecord[]>;
  updateCampaignStatus(id: string, from: CampaignStatus[], data: Partial<Pick<LinkedInCampaignRecord, "status" | "statusReason" | "startedAt" | "completedAt">>): Promise<LinkedInCampaignRecord | null>;
  touchLastSent(id: string, at: Date): Promise<void>;
  updateCampaignSchedule(id: string, data: Partial<Pick<LinkedInCampaignRecord, "intervalSec" | "dailyLimit" | "windowStart" | "windowEnd">>): Promise<LinkedInCampaignRecord>;
  countByStatus(campaignId: string): Promise<Partial<Record<AttemptStatus, number>>>;
  countSentSince(campaignId: string, since: Date): Promise<number>;
  listMessages(query: { campaignId: string; status?: AttemptStatus; skip: number; take: number }): Promise<{ items: LinkedInMessageRecord[]; total: number }>;
  findMessage(id: string): Promise<LinkedInMessageRecord | null>;
  /** Oldest queued message of the campaign. */
  nextQueued(campaignId: string): Promise<LinkedInMessageRecord | null>;
  /** queued → sending, only if still queued. */
  claim(id: string, at: Date): Promise<boolean>;
  /** sending → final status, only if still sending (a late or repeated report changes nothing). */
  finish(id: string, data: Pick<LinkedInMessageRecord, "status" | "error" | "sentAt" | "failedAt">): Promise<boolean>;
  /** sending → queued (the extension gave it back untouched, e.g. LinkedIn needed a login). */
  release(id: string, error: string): Promise<boolean>;
  /** A message currently handed to the extension, if any. */
  inFlight(platform?: OutreachPlatform): Promise<LinkedInMessageRecord | null>;
  /** Messages handed out before `before` with no report back: failed (never re-sent). */
  failStale(before: Date, error: string, at: Date): Promise<number>;
  cancelQueued(campaignId: string): Promise<number>;
  hasPending(campaignId: string): Promise<boolean>;
}

/** One message of any channel, for the campaign logs page. */
export interface CampaignLogEntry {
  id: string;
  channel: Channel | "linkedin" | "instagram";
  campaignId: string | null;
  campaignName: string | null;
  recipient: string;
  to: string;
  status: AttemptStatus;
  error: string | null;
  sentAt: Date | null;
  updatedAt: Date;
}

export interface CampaignLogRepository {
  /** Newest first. */
  list(query: { channel?: Channel | "linkedin" | "instagram"; status?: AttemptStatus; campaignId?: string; q?: string; skip: number; take: number }): Promise<{ items: CampaignLogEntry[]; total: number }>;
  /** Campaign events (started, paused, completed…) from the activity log, newest first. */
  events(take: number): Promise<{ id: string; action: string; status: string; message: string | null; createdAt: Date }[]>;
}

// ---- Social accounts (OAuth) ----

export type SocialPlatform = "facebook_page" | "instagram" | "linkedin";

export interface SocialAccountRecord {
  id: string;
  platform: string;
  externalId: string;
  name: string;
  username: string | null;
  pictureUrl: string | null;
  tokenEnc: string;
  tokenExpiresAt: Date | null;
  scopes: string;
  status: string;
  lastError: string | null;
  meta: string;
  connectedById: string | null;
  lastCheckedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SocialAccountData = Omit<SocialAccountRecord, "id" | "createdAt" | "updatedAt" | "lastCheckedAt" | "status" | "lastError"> &
  Partial<Pick<SocialAccountRecord, "status" | "lastError" | "lastCheckedAt">>;

export interface SocialAccountRepository {
  list(): Promise<SocialAccountRecord[]>;
  findById(id: string): Promise<SocialAccountRecord | null>;
  /** Create, or replace the token and details of the same platform account. */
  upsert(data: SocialAccountData): Promise<SocialAccountRecord>;
  update(id: string, data: Partial<Pick<SocialAccountRecord, "status" | "lastError" | "lastCheckedAt" | "name" | "username" | "pictureUrl">>): Promise<void>;
  delete(id: string): Promise<boolean>;
}

// ---- AI Inbox ----

export type InboxPlatform = "telegram" | "facebook" | "instagram" | "linkedin";
export type ReplyMode = "smart" | "auto" | "draft" | "off";

export interface InboxConversationRecord {
  id: string;
  platform: string;
  accountKey: string;
  externalThreadId: string;
  participantId: string | null;
  participantName: string;
  participantUsername: string | null;
  replyMode: string | null;
  status: string;
  lastIntent: string | null;
  summary: string | null;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface InboxMessageRecord {
  id: string;
  conversationId: string;
  direction: string;
  externalId: string | null;
  text: string;
  author: string;
  sentAt: Date;
  createdAt: Date;
}

export interface InboxDraftRecord {
  id: string;
  conversationId: string;
  status: string;
  text: string;
  intent: string | null;
  summary: string | null;
  language: string | null;
  confidence: number | null;
  needsHuman: boolean;
  decision: string | null;
  forMessageId: string | null;
  model: string | null;
  error: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AiAssistantSettingsRecord {
  id: string;
  enabled: boolean;
  businessProfile: string;
  faqs: string;
  style: string;
  neverSay: string;
  modes: string;
  minConfidence: number;
  maxAutoPerChatPerDay: number;
  telegramOffset: number;
  aiProvider: string;
  aiModel: string;
  aiEffort: string;
  anthropicKeyEnc: string | null;
  anthropicKeyHint: string | null;
  geminiKeyEnc: string | null;
  geminiKeyHint: string | null;
  telegramTokenEnc: string | null;
  telegramTokenHint: string | null;
  updatedAt: Date;
}

export type InboxConversationListItem = InboxConversationRecord & {
  lastMessage: Pick<InboxMessageRecord, "direction" | "text" | "author" | "sentAt"> | null;
  pendingDraft: Pick<InboxDraftRecord, "id" | "text" | "confidence" | "needsHuman" | "decision"> | null;
};

export interface InboxRepository {
  getSettings(): Promise<AiAssistantSettingsRecord>;
  updateSettings(data: Partial<Omit<AiAssistantSettingsRecord, "id" | "updatedAt">>): Promise<AiAssistantSettingsRecord>;
  upsertConversation(data: Pick<InboxConversationRecord, "platform" | "accountKey" | "externalThreadId" | "participantName"> & Partial<Pick<InboxConversationRecord, "participantId" | "participantUsername">>): Promise<InboxConversationRecord>;
  findConversation(id: string): Promise<InboxConversationRecord | null>;
  findConversationByThread(platform: string, accountKey: string, externalThreadId: string): Promise<InboxConversationRecord | null>;
  updateConversation(id: string, data: Partial<Omit<InboxConversationRecord, "id" | "createdAt" | "updatedAt">>): Promise<InboxConversationRecord>;
  listConversations(query: { platform?: string; status?: string; q?: string; skip: number; take: number }): Promise<{ items: InboxConversationListItem[]; total: number }>;
  countByStatus(): Promise<Record<string, number>>;
  /** Inserts messages not stored yet (by externalId); returns the new ones. */
  addMessages(conversationId: string, messages: Pick<InboxMessageRecord, "direction" | "externalId" | "text" | "author" | "sentAt">[]): Promise<InboxMessageRecord[]>;
  /** The latest `take` messages, oldest first. */
  recentMessages(conversationId: string, take: number): Promise<InboxMessageRecord[]>;
  lastInbound(conversationId: string): Promise<InboxMessageRecord | null>;
  countAutoRepliesSince(conversationId: string, since: Date): Promise<number>;
  /** Chats whose latest message is from the customer, received between since and before. */
  awaitingReply(since: Date, before: Date, take: number): Promise<InboxConversationRecord[]>;
  createDraft(data: Omit<InboxDraftRecord, "id" | "createdAt" | "updatedAt" | "sentAt" | "error"> & { error?: string | null }): Promise<InboxDraftRecord>;
  findDraft(id: string): Promise<InboxDraftRecord | null>;
  draftFor(conversationId: string, forMessageId: string): Promise<InboxDraftRecord | null>;
  pendingDraft(conversationId: string): Promise<InboxDraftRecord | null>;
  listDrafts(conversationId: string, take: number): Promise<InboxDraftRecord[]>;
  /** Changes a draft only while its status is one of `from`. */
  updateDraft(id: string, from: string[], data: Partial<Pick<InboxDraftRecord, "status" | "text" | "error" | "sentAt" | "decision">>): Promise<boolean>;
  supersedePending(conversationId: string): Promise<number>;
  /** LinkedIn drafts waiting for the extension to type them, optionally for one thread. */
  pendingLinkedInDrafts(threadId?: string): Promise<(InboxDraftRecord & { threadId: string; participantName: string })[]>;
}

export interface Repositories {
  adminUsers: AdminUserRepository;
  sessions: SessionRepository;
  apiTokens: ApiTokenRepository;
  leads: LeadRepository;
  jobs: JobRepository;
  jobItems: JobItemRepository;
  agentLogs: AgentLogRepository;
  templates: TemplateRepository;
  campaigns: CampaignRepository;
  attempts: AttemptRepository;
  preferences: PreferenceRepository;
  emailEvents: EmailEventRepository;
  trackedLinks: TrackedLinkRepository;
  whatsappEvents: WhatsAppEventRepository;
  suppressions: SuppressionRepository;
  webhooks: WebhookRepository;
  linkedinLeads: LinkedInLeadRepository;
  contacts: ContactRepository;
  linkedinOutreach: LinkedInOutreachRepository;
  campaignLogs: CampaignLogRepository;
  socialAccounts: SocialAccountRepository;
  inbox: InboxRepository;
  /** Runs `fn` in one database transaction; all-or-nothing. */
  transaction<T>(fn: (tx: Repositories) => Promise<T>): Promise<T>;
}

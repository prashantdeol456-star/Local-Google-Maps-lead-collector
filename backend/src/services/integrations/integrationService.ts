// Outgoing webhooks for integrations such as n8n (or Zapier / Make). Domain events from the
// event bus are turned into JSON payloads and queued per subscribed endpoint; the webhook
// worker sends them with a signature and retries. Each event is queued once per endpoint
// (stable event id), so receivers can de-duplicate on it.

import { randomBytes, randomUUID } from "node:crypto";
import type { Repositories, WebhookEndpointRecord } from "../../database/repositories/index.js";
import { Errors } from "../../utils/errors.js";
import type { SecretBox } from "../../utils/secretBox.js";
import type { AppEvent, EventBus } from "../events.js";

export const INTEGRATION_EVENTS = ["lead.created", "collection.finished", "campaign.completed", "reply.received", "optout.recorded"] as const;
export type IntegrationEvent = (typeof INTEGRATION_EVENTS)[number];

export const EVENT_DESCRIPTIONS: Record<IntegrationEvent, string> = {
  "lead.created": "A new business was saved from Google Maps (duplicates are not sent)",
  "collection.finished": "A collection job completed, was stopped or failed",
  "campaign.completed": "An email or WhatsApp campaign sent everything it had queued",
  "reply.received": "A WhatsApp reply arrived, or an email reply was logged",
  "optout.recorded": "Someone unsubscribed, replied STOP, reported spam or was marked do-not-contact",
};

const FINISHED_JOB = new Set(["completed", "stopped", "failed"]);

/** Only these fields leave the platform (an explicit list: internal fields never do). */
const LEAD_FIELDS = [
  "id", "name", "category", "phone", "email", "website", "address", "city", "state", "country", "postalCode",
  "latitude", "longitude", "rating", "reviewCount", "mapsUrl", "placeId", "searchKeyword", "source", "createdAt",
] as const;
const JOB_FIELDS = [
  "id", "searchKeyword", "location", "maxRecords", "status", "statusReason",
  "totalFound", "newRecords", "duplicateRecords", "errorRecords", "startedAt", "completedAt", "createdAt",
] as const;

function pick<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((k) => [k, obj[k]])) as Pick<T, K>;
}
const MAX_TEXT = 2000;

export interface EndpointInput {
  name: string;
  url: string;
  events: IntegrationEvent[];
  enabled?: boolean;
}

export function newSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

/** http(s) only, no credentials in the URL. Local addresses are allowed (n8n usually runs locally). */
export function checkWebhookUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw Errors.badRequest("Enter a full URL, e.g. http://localhost:5678/webhook/leads");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw Errors.badRequest("The URL must start with http:// or https://");
  if (url.username || url.password) throw Errors.badRequest("Do not put a user name or password in the URL; use the signing secret instead");
  return url.toString();
}

export class IntegrationService {
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly repos: Repositories,
    private readonly box: SecretBox,
    private readonly bus?: EventBus,
    private readonly log?: (msg: string) => void,
  ) {}

  /** Listens to domain events. Errors are logged, never thrown into the code that published. */
  start() {
    if (!this.bus || this.unsubscribe) return;
    this.unsubscribe = this.bus.subscribe((event) => {
      this.handle(event).catch((err) => this.log?.(`integrations: ${String(err)}`));
    });
  }

  stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  // ---- Events → deliveries ----

  async handle(event: AppEvent): Promise<number> {
    switch (event.type) {
      case "lead.saved": {
        if (event.result !== "new") return 0;
        const lead = await this.repos.leads.findById(event.leadId);
        if (!lead) return 0;
        return this.emit("lead.created", `lead.created:${lead.id}`, { lead: pick(lead, LEAD_FIELDS), jobId: event.jobId });
      }
      case "job.updated": {
        if (!FINISHED_JOB.has(event.status)) return 0;
        const job = await this.repos.jobs.findById(event.jobId);
        if (!job || job.status !== event.status) return 0;
        return this.emit("collection.finished", `collection.finished:${job.id}:${job.status}`, { job: pick(job, JOB_FIELDS) });
      }
      case "campaign.updated": {
        if (event.status !== "completed") return 0;
        const campaign = await this.repos.campaigns.findById(event.campaignId);
        if (!campaign || campaign.status !== "completed") return 0;
        const counts = await this.repos.attempts.countByStatus(campaign.id);
        const { id, channel, name, provider, startedAt, completedAt } = campaign;
        return this.emit("campaign.completed", `campaign.completed:${id}`, { campaign: { id, channel, name, provider, startedAt, completedAt, counts } });
      }
      case "reply.received":
        return this.reply(event.channel, event.eventId);
      case "optout.recorded": {
        const s = await this.repos.suppressions.findById(event.suppressionId);
        if (!s) return 0;
        const lead = s.leadId ? await this.repos.leads.findById(s.leadId) : null;
        return this.emit("optout.recorded", `optout.recorded:${s.id}`, {
          optOut: { channel: s.channel, address: s.address, reason: s.reason, source: s.source, recordedAt: s.createdAt },
          lead: lead ? { id: lead.id, name: lead.name } : null,
        });
      }
      default:
        return 0;
    }
  }

  private async reply(channel: "email" | "whatsapp", eventId: string): Promise<number> {
    if (channel === "email") {
      const e = await this.repos.emailEvents.findById(eventId);
      if (!e) return 0;
      const attempt = e.attemptId ? await this.repos.attempts.findById(e.attemptId) : null;
      const lead = e.leadId ? await this.repos.leads.findById(e.leadId) : null;
      const message = (e.metadata ? (JSON.parse(e.metadata) as { message?: string }).message : null) ?? null;
      return this.emit("reply.received", `reply.received:email:${e.id}`, {
        reply: { channel, from: attempt?.toAddress ?? lead?.email ?? null, text: message?.slice(0, MAX_TEXT) ?? null, receivedAt: e.occurredAt, campaignId: attempt?.campaignId ?? null },
        lead: lead ? { id: lead.id, name: lead.name } : null,
      });
    }
    const e = await this.repos.whatsappEvents.findById(eventId);
    if (!e) return 0;
    const attempt = e.attemptId ? await this.repos.attempts.findById(e.attemptId) : null;
    const lead = e.leadId ? await this.repos.leads.findById(e.leadId) : null;
    const meta = e.metadata ? (JSON.parse(e.metadata) as { profileName?: string | null; messageType?: string }) : {};
    return this.emit("reply.received", `reply.received:whatsapp:${e.id}`, {
      reply: {
        channel,
        from: e.phone,
        profileName: meta.profileName ?? null,
        messageType: meta.messageType ?? null,
        text: e.text?.slice(0, MAX_TEXT) ?? null,
        receivedAt: e.occurredAt,
        campaignId: attempt?.campaignId ?? null,
      },
      lead: lead ? { id: lead.id, name: lead.name } : null,
    });
  }

  /** Queues one event for every enabled endpoint subscribed to it. Returns how many were queued. */
  async emit(
    type: IntegrationEvent | "ping",
    eventId: string,
    data: Record<string, unknown>,
    opts: { only?: WebhookEndpointRecord; nextAttemptAt?: Date } = {},
  ): Promise<number> {
    const only = opts.only;
    const endpoints = only ? [only] : (await this.repos.webhooks.listEndpoints()).filter((e) => e.enabled && (JSON.parse(e.events) as string[]).includes(type));
    if (endpoints.length === 0) return 0;
    const payload = JSON.stringify({ id: eventId, type, createdAt: new Date().toISOString(), data });
    let queued = 0;
    for (const endpoint of endpoints) {
      if (await this.repos.webhooks.enqueue({ endpointId: endpoint.id, eventId, event: type, payload, nextAttemptAt: opts.nextAttemptAt })) queued++;
    }
    return queued;
  }

  // ---- Endpoints ----

  private view(e: WebhookEndpointRecord) {
    return {
      ...pick(e, ["id", "name", "url", "enabled", "createdAt", "updatedAt"]),
      events: JSON.parse(e.events) as IntegrationEvent[],
      secret: `whsec_••••${e.secretHint}`,
    };
  }

  async list() {
    const endpoints = await this.repos.webhooks.listEndpoints();
    return Promise.all(endpoints.map(async (e) => ({ ...this.view(e), deliveries: await this.repos.webhooks.countDeliveries(e.id) })));
  }

  async get(id: string) {
    const e = await this.repos.webhooks.findEndpoint(id);
    if (!e) throw Errors.notFound("Webhook not found");
    return e;
  }

  /** Returns the secret in full this one time. */
  async create(input: EndpointInput) {
    const secret = newSecret();
    const e = await this.repos.webhooks.createEndpoint({
      name: input.name,
      url: checkWebhookUrl(input.url),
      events: JSON.stringify([...new Set(input.events)]),
      enabled: input.enabled ?? true,
      secretEnc: this.box.seal(secret),
      secretHint: secret.slice(-4),
    });
    await this.repos.agentLogs.create({ jobId: null, action: "webhook_created", status: "info", message: `${e.name} → ${e.url}` });
    return { endpoint: this.view(e), secret };
  }

  async update(id: string, input: Partial<EndpointInput>) {
    await this.get(id);
    const updated = await this.repos.webhooks.updateEndpoint(id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.url !== undefined ? { url: checkWebhookUrl(input.url) } : {}),
      ...(input.events !== undefined ? { events: JSON.stringify([...new Set(input.events)]) } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    });
    return this.view(updated!);
  }

  async rotateSecret(id: string) {
    await this.get(id);
    const secret = newSecret();
    const updated = await this.repos.webhooks.updateEndpoint(id, { secretEnc: this.box.seal(secret), secretHint: secret.slice(-4) });
    await this.repos.agentLogs.create({ jobId: null, action: "webhook_secret_rotated", status: "warning", message: updated!.name });
    return { endpoint: this.view(updated!), secret };
  }

  async remove(id: string) {
    const e = await this.get(id);
    await this.repos.webhooks.deleteEndpoint(id);
    await this.repos.agentLogs.create({ jobId: null, action: "webhook_deleted", status: "warning", message: `${e.name} → ${e.url}` });
  }

  /** Queues a "ping" event for one endpoint (sent by the caller right away). */
  async queuePing(id: string) {
    const e = await this.get(id);
    const eventId = `ping:${randomUUID()}`;
    // Not due for the background worker: the test request sends it itself, right away.
    await this.emit("ping", eventId, { message: "Test event from the lead platform" }, { only: e, nextAttemptAt: new Date(Date.now() + 86_400_000) });
    return eventId;
  }

  deliveries(endpointId: string, query: { status?: "pending" | "delivered" | "failed"; skip: number; take: number }) {
    return this.repos.webhooks.listDeliveries({ endpointId, ...query });
  }
}

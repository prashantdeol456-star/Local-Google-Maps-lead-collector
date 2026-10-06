// Meta WhatsApp Cloud API. Request/response and webhook formats verified against
// developers.facebook.com (business-messaging/whatsapp docs, Graph API v26.0) on 2026-10-06.

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  WhatsAppProviderError,
  WhatsAppWebhookRejected,
  type OutgoingTemplate,
  type RawWebhook,
  type WhatsAppEvent,
  type WhatsAppProvider,
  type WhatsAppSendResult,
} from "./types.js";

const TIMEOUT_MS = 15_000;
const STATUSES = new Set(["sent", "delivered", "read", "failed"]);

export interface MetaOptions {
  accessToken: string;
  phoneNumberId: string;
  /** App secret: verifies X-Hub-Signature-256 on webhooks. */
  appSecret?: string;
  /** Your own string, entered in the App Dashboard, checked on webhook subscription. */
  verifyToken?: string;
  apiVersion?: string;
  /** "messages" (Cloud API) or "marketing_messages" (Marketing Messages API, falls back to Cloud API). */
  endpoint?: "messages" | "marketing_messages";
  fetchImpl?: typeof fetch;
}

function header(headers: RawWebhook["headers"], name: string): string | undefined {
  const v = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const fromUnix = (ts: unknown) => (typeof ts === "string" && /^\d+$/.test(ts) ? new Date(Number(ts) * 1000) : new Date());

export class MetaWhatsAppProvider implements WhatsAppProvider {
  readonly name = "meta" as const;
  readonly capabilities = { delivery: true, read: true, replies: true };
  readonly sender: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: MetaOptions) {
    this.sender = `phone number id ${options.phoneNumberId}`;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async sendTemplate(message: OutgoingTemplate): Promise<WhatsAppSendResult> {
    const endpoint = this.options.endpoint ?? "messages";
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: message.to,
      type: "template",
      template: {
        name: message.templateName,
        language: { code: message.language },
        ...(message.bodyParams.length
          ? {
              components: [
                {
                  type: "body",
                  parameters: message.bodyParams.map((p) => ({ type: "text", ...(p.name ? { parameter_name: p.name } : {}), text: p.value })),
                },
              ],
            }
          : {}),
      },
      ...(message.callbackData ? { biz_opaque_callback_data: message.callbackData.slice(0, 512) } : {}),
      ...(endpoint === "marketing_messages" ? { product_policy: "CLOUD_API_FALLBACK" } : {}),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await this.fetchImpl(
        `https://graph.facebook.com/${this.options.apiVersion ?? "v26.0"}/${encodeURIComponent(this.options.phoneNumberId)}/${endpoint}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${this.options.accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );
    } catch {
      throw new WhatsAppProviderError("Could not reach WhatsApp (graph.facebook.com)", true);
    } finally {
      clearTimeout(timer);
    }

    const data = (await res.json().catch(() => null)) as {
      messages?: { id?: string }[];
      error?: { message?: string; code?: number; error_data?: { details?: string } };
    } | null;
    if (!res.ok) {
      const err = data?.error;
      const detail = err?.error_data?.details ? ` (${err.error_data.details})` : "";
      // Rate / throughput limits (Meta error codes): trying again later can succeed.
      const rateLimited = res.status === 429 || [4, 80007, 130429, 131056].includes(err?.code ?? 0);
      // 131048 = the number is restricted because messages were blocked/reported as spam:
      // retrying makes it worse, so it is not retryable.
      const hint =
        res.status === 401 || err?.code === 190
          ? " (check META_WA_ACCESS_TOKEN)"
          : err?.code === 131048
            ? " (sending is restricted for spam reports: check the number's quality rating in WhatsApp Manager)"
            : "";
      throw new WhatsAppProviderError(
        `WhatsApp: ${err?.message ?? `HTTP ${res.status}`}${detail}${hint}`,
        rateLimited || res.status >= 500,
        res.status,
        err?.code,
      );
    }
    const id = data?.messages?.[0]?.id;
    if (!id) throw new WhatsAppProviderError("WhatsApp did not return a message id", true);
    return { externalMessageId: id };
  }

  verifySubscription(query: Record<string, string | undefined>): string | null {
    const token = this.options.verifyToken;
    if (!token || query["hub.mode"] !== "subscribe" || !query["hub.verify_token"] || !query["hub.challenge"]) return null;
    return safeEqual(query["hub.verify_token"], token) ? query["hub.challenge"] : null;
  }

  async handleWebhook(request: RawWebhook): Promise<WhatsAppEvent[]> {
    if (!this.options.appSecret) throw new WhatsAppWebhookRejected("META_WA_APP_SECRET is not configured");
    const signature = header(request.headers, "x-hub-signature-256") ?? "";
    const expected = `sha256=${createHmac("sha256", this.options.appSecret).update(request.body).digest("hex")}`;
    if (!safeEqual(signature, expected)) throw new WhatsAppWebhookRejected();

    type Value = {
      metadata?: { phone_number_id?: string };
      contacts?: { wa_id?: string; profile?: { name?: string } }[];
      statuses?: Record<string, unknown>[];
      messages?: Record<string, unknown>[];
      user_preferences?: Record<string, unknown>[];
    };
    const payload = JSON.parse(request.body) as { entry?: { changes?: { field?: string; value?: Value }[] }[] };
    const events: WhatsAppEvent[] = [];
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        // One app can serve several business numbers: only events for ours.
        const numberId = value?.metadata?.phone_number_id;
        if (!value || (numberId && numberId !== this.options.phoneNumberId)) continue;

        if (change.field === "user_preferences") {
          for (const p of value.user_preferences ?? []) {
            if (p.category !== "marketing_messages" || (p.value !== "stop" && p.value !== "resume") || typeof p.wa_id !== "string") continue;
            const at = typeof p.timestamp === "number" ? new Date(p.timestamp * 1000) : fromUnix(p.timestamp);
            events.push({
              kind: "preference",
              providerEventId: `pref:${p.wa_id}:${p.value}:${at.getTime()}`,
              waId: p.wa_id.replace(/^[+]/, ""),
              value: p.value,
              occurredAt: at,
              metadata: { detail: p.detail ?? null },
            });
          }
          continue;
        }
        if (change.field !== "messages") continue;

        for (const s of value.statuses ?? []) {
          const status = String(s.status);
          if (!STATUSES.has(status) || typeof s.id !== "string") continue;
          const errors = Array.isArray(s.errors) ? (s.errors as { code?: number; title?: string; message?: string; error_data?: { details?: string } }[]) : [];
          const first = errors[0];
          events.push({
            kind: "status",
            providerEventId: `${s.id}:${status}`,
            externalMessageId: s.id,
            status: status as "sent" | "delivered" | "read" | "failed",
            occurredAt: fromUnix(s.timestamp),
            callbackData: typeof s.biz_opaque_callback_data === "string" ? s.biz_opaque_callback_data : null,
            error: first ? [first.code, first.title ?? first.message, first.error_data?.details].filter(Boolean).join(": ") : null,
            errorCode: typeof first?.code === "number" ? first.code : null,
            metadata: { recipient: s.recipient_id ?? null, errors: errors.length ? errors : undefined, pricing: s.pricing },
          });
        }
        for (const m of value.messages ?? []) {
          if (typeof m.id !== "string" || typeof m.from !== "string") continue;
          const from = m.from.replace(/^[+]/, "");
          const interactive = m.interactive as { button_reply?: { title?: string }; list_reply?: { title?: string } } | undefined;
          const text =
            (m.text as { body?: string } | undefined)?.body ??
            (m.button as { text?: string } | undefined)?.text ??
            interactive?.button_reply?.title ??
            interactive?.list_reply?.title ??
            null;
          const contact = value.contacts?.find((c) => c.wa_id === m.from || c.wa_id === from) ?? (value.contacts?.length === 1 ? value.contacts[0] : undefined);
          events.push({
            kind: "inbound",
            providerEventId: m.id,
            from,
            text,
            messageType: String(m.type ?? "unknown"),
            inReplyTo: (m.context as { id?: string } | undefined)?.id ?? null,
            profileName: contact?.profile?.name ?? null,
            occurredAt: fromUnix(m.timestamp),
            metadata: { type: m.type },
          });
        }
      }
    }
    return events;
  }
}

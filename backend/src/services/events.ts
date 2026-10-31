import { EventEmitter } from "node:events";
import { ownerScope } from "../database/ownerScope.js";

// In-process event bus for live admin updates (Server-Sent Events).
// Events carry only ids and small summaries; clients refetch what they display.
// Hosting several backend instances later would need a shared bus (e.g. Postgres LISTEN/NOTIFY).

export type AppEvent =
  | { type: "lead.saved"; leadId: string; result: "new" | "duplicate"; jobId: string | null }
  | { type: "lead.updated"; leadId: string }
  | { type: "lead.deleted"; leadId: string }
  | { type: "job.updated"; jobId: string; status: string }
  | { type: "campaign.updated"; campaignId: string; status: string }
  /** A reply (or a message from an unknown number) was recorded: EmailEvent / WhatsAppEvent id. */
  | { type: "reply.received"; channel: "email" | "whatsapp"; eventId: string }
  /** A new suppression entry (unsubscribe, STOP, spam report, do-not-contact…). */
  | { type: "optout.recorded"; suppressionId: string }
  /** A chat in the AI Inbox changed (new message, draft, reply). */
  | { type: "inbox.updated"; conversationId: string };

/** An event as delivered: with the user who caused it (from the request's data scope), if any. */
export type ScopedAppEvent = AppEvent & { ownerId?: string };

export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Each open admin tab is one listener.
    this.emitter.setMaxListeners(100);
  }

  publish(event: AppEvent): void {
    // Customers' live streams only get events of their own data (see api/routes/events.ts).
    const ownerId = ownerScope.getStore()?.userId;
    this.emitter.emit("event", ownerId ? { ...event, ownerId } : event);
  }

  subscribe(listener: (event: AppEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }

  listenerCount(): number {
    return this.emitter.listenerCount("event");
  }
}

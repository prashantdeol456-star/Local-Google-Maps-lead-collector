// Provider-neutral WhatsApp interface. Business-initiated WhatsApp messages must use
// templates approved by Meta (directly or through a BSP such as Gupshup / MSG91).

export type WhatsAppProviderName = "log" | "meta";

export interface TemplateParam {
  /** For templates with named parameters ({{first_name}}); omit for positional ({{1}}, {{2}}). */
  name?: string;
  value: string;
}

export interface OutgoingTemplate {
  /** Recipient in E.164 without "+", e.g. 918957926677 */
  to: string;
  templateName: string;
  /** Template language code, e.g. "en", "en_US", "hi" */
  language: string;
  bodyParams: TemplateParam[];
  /** Echoed back in status webhooks (we pass the attempt id). */
  callbackData?: string;
}

export interface WhatsAppSendResult {
  externalMessageId: string;
}

export interface WhatsAppCapabilities {
  delivery: boolean;
  read: boolean;
  replies: boolean;
}

export type WhatsAppEvent =
  | {
      kind: "status";
      providerEventId: string;
      externalMessageId: string;
      status: "sent" | "delivered" | "read" | "failed";
      occurredAt: Date;
      callbackData: string | null;
      error: string | null;
      /** Provider error code of a failed message (Meta: 131050, 131026…). */
      errorCode: number | null;
      metadata: Record<string, unknown>;
    }
  | {
      kind: "inbound";
      providerEventId: string;
      /** Sender in E.164 without "+" */
      from: string;
      text: string | null;
      messageType: string;
      /** The business message this replies to (the user used "reply" or tapped a button in it). */
      inReplyTo: string | null;
      /** Name from the sender's WhatsApp profile (self-chosen, not verified). */
      profileName: string | null;
      /** Photo, document, voice note, video or sticker: WhatsApp's media id (download with downloadMedia). */
      media: IncomingMedia | null;
      occurredAt: Date;
      metadata: Record<string, unknown>;
    }
  | {
      /** The user stopped or resumed marketing messages from this business (in WhatsApp itself). */
      kind: "preference";
      providerEventId: string;
      /** WhatsApp user id (usually, not always, the phone number without "+") */
      waId: string;
      value: "stop" | "resume";
      occurredAt: Date;
      metadata: Record<string, unknown>;
    };

export interface IncomingMedia {
  id: string;
  mime: string | null;
  filename: string | null;
  caption: string | null;
}

/** Kinds of file WhatsApp can send. */
export type MediaKind = "image" | "document" | "audio" | "video";

export interface RawWebhook {
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface WhatsAppProvider {
  readonly name: WhatsAppProviderName;
  readonly capabilities: WhatsAppCapabilities;
  /** Sender shown in the UI (the business phone number id / display). */
  readonly sender: string;
  sendTemplate(message: OutgoingTemplate): Promise<WhatsAppSendResult>;
  /** Webhook subscription check (GET). Returns the challenge to echo, or null if the token is wrong. */
  verifySubscription(query: Record<string, string | undefined>): string | null;
  /** Verifies the signature and returns the events. Throws WhatsAppWebhookRejected if not genuine. */
  handleWebhook(request: RawWebhook): Promise<WhatsAppEvent[]>;

  // ---- Chats (WhatsApp Chat page). Free-form messages only within 24 hours of the person's last message. ----
  sendText?(to: string, text: string, replyTo?: string | null): Promise<WhatsAppSendResult>;
  /** Uploads a file to WhatsApp and returns its media id (valid for sending for a while). */
  uploadMedia?(file: { data: Buffer; mime: string; filename: string }): Promise<string>;
  sendMedia?(to: string, media: { kind: MediaKind; mediaId: string; caption?: string | null; filename?: string | null }): Promise<WhatsAppSendResult>;
  /** Shows blue ticks on the person's phone for this message (and the ones before it). */
  markRead?(wamid: string): Promise<void>;
  /** Downloads a received file (null if it is too big or gone). */
  downloadMedia?(mediaId: string, maxBytes: number): Promise<{ data: Buffer; mime: string } | null>;
}

export class WhatsAppProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly status?: number,
    public readonly code?: number,
  ) {
    super(message);
    this.name = "WhatsAppProviderError";
  }
}

export class WhatsAppWebhookRejected extends Error {
  constructor(message = "WhatsApp webhook signature verification failed") {
    super(message);
    this.name = "WhatsAppWebhookRejected";
  }
}

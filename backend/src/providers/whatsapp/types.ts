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
      /** "played": the person played a voice message (voice notes only). */
      status: "sent" | "delivered" | "read" | "failed" | "played";
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
      /** Reply/forward context, reactions, locations, contact cards, button choices, edits and deletions. */
      details?: InboundDetails;
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

export interface SharedContact {
  name: string;
  phones: { phone: string; waId: string | null; type: string | null }[];
  emails: string[];
  org: string | null;
}

export interface SharedLocation {
  latitude: number;
  longitude: number;
  name: string | null;
  address: string | null;
  url: string | null;
}

export interface InboundDetails {
  /** The message this one quotes, and whether it was forwarded */
  context: { id: string | null; forwarded: boolean; frequentlyForwarded: boolean } | null;
  /** A reaction to an earlier message (emoji null = reaction removed) */
  reaction: { messageId: string; emoji: string | null } | null;
  location: SharedLocation | null;
  contacts: SharedContact[] | null;
  /** The button or list row the person tapped */
  choice: { kind: "button" | "list" | "flow" | "template_button"; id: string | null; title: string | null; description: string | null } | null;
  /** The person edited an earlier message (new text or caption) */
  edit: { originalId: string; text: string | null } | null;
  /** The person deleted an earlier message for everyone */
  revoke: { originalId: string } | null;
  /** WhatsApp system notice, e.g. the person changed their number */
  system: string | null;
}

/** Interactive messages (sent within 24 hours of the person's last message). */
export type OutgoingInteractive =
  | { type: "buttons"; body: string; footer?: string | null; header?: string | null; buttons: { id: string; title: string }[] }
  | { type: "list"; body: string; footer?: string | null; header?: string | null; button: string; sections: { title: string; rows: { id: string; title: string; description?: string | null }[] }[] }
  | { type: "cta_url"; body: string; footer?: string | null; header?: string | null; displayText: string; url: string }
  | { type: "location_request"; body: string };

export interface BusinessProfile {
  about: string | null;
  address: string | null;
  description: string | null;
  email: string | null;
  websites: string[];
  vertical: string | null;
  profilePictureUrl: string | null;
}

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
  sendMedia?(
    to: string,
    media: { kind: MediaKind | "sticker"; mediaId: string; caption?: string | null; filename?: string | null; voice?: boolean },
    replyTo?: string | null,
  ): Promise<WhatsAppSendResult>;
  /** Emoji reaction on one of the person's messages ("" removes it). */
  sendReaction?(to: string, messageId: string, emoji: string): Promise<WhatsAppSendResult>;
  sendLocation?(to: string, location: Omit<SharedLocation, "url">, replyTo?: string | null): Promise<WhatsAppSendResult>;
  sendContacts?(to: string, contacts: { name: string; phone: string }[], replyTo?: string | null): Promise<WhatsAppSendResult>;
  sendInteractive?(to: string, message: OutgoingInteractive, replyTo?: string | null): Promise<WhatsAppSendResult>;
  /** "typing…" on the person's phone (up to 25 s or until you reply), with blue ticks on this message. */
  sendTyping?(wamid: string): Promise<void>;
  /** Block or unblock numbers that messaged you in the last 24 hours. */
  setBlocked?(phones: string[], blocked: boolean): Promise<void>;
  getProfile?(): Promise<BusinessProfile>;
  updateProfile?(profile: Partial<Omit<BusinessProfile, "profilePictureUrl">>): Promise<void>;
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

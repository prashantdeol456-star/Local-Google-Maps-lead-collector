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

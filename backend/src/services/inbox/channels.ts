// Reading and sending chat messages on each platform, through the official APIs:
// - Telegram Bot API (getUpdates long polling; works without a public address)
// - Facebook Pages / Instagram via the Graph API Conversations endpoint (polled) and the Send API
// LinkedIn has no API for this; its messages come from the LinkedIn Messenger extension.

export class ChannelError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** A photo, video, voice note, file or sticker in a message (shown in the panel, not read by the AI). */
export interface Attachment {
  type: "image" | "video" | "audio" | "file" | "sticker";
  /** Meta's link (it expires after a while) */
  url?: string | null;
  /** "tg:<file_id>": Telegram file, fetched through the platform (the bot token stays on the server) */
  ref?: string | null;
  name?: string | null;
  mime?: string | null;
}

export interface IncomingMessage {
  externalId: string;
  direction: "in" | "out";
  text: string;
  sentAt: Date;
  attachments?: Attachment[];
}

export interface IncomingThread {
  /** Which inbox account it belongs to (Telegram: "bot", or "business:<connection id>" for your own number) */
  accountKey?: string;
  externalThreadId: string;
  participantId: string | null;
  participantName: string;
  participantUsername: string | null;
  messages: IncomingMessage[];
}

/** Text shown for messages without text (we only answer text). */
function placeholder(kind: string) {
  return `[${kind}]`;
}

// ---- Telegram ----

interface TgUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}
type TgFile = { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
interface TgMessage {
  message_id: number;
  date: number;
  chat: { id: number; type: string; first_name?: string; last_name?: string; username?: string; title?: string };
  from?: TgUser;
  /** Telegram Business: the connection the message came through (your own account) */
  business_connection_id?: string;
  text?: string;
  caption?: string;
  photo?: TgFile[];
  voice?: TgFile;
  audio?: TgFile;
  video?: TgFile;
  video_note?: TgFile;
  document?: TgFile;
  sticker?: TgFile & { emoji?: string };
}
/** Telegram Business: you connected the bot to your own account (Settings → Telegram Business → Chatbots). */
export interface TgBusinessConnection {
  id: string;
  user: TgUser;
  user_chat_id: number;
  date: number;
  is_enabled: boolean;
  rights?: { can_reply?: boolean };
  can_reply?: boolean;
}
interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  business_connection?: TgBusinessConnection;
  business_message?: TgMessage;
}

/** Text and attachments of a Telegram message (the AI reads the text; files are shown). */
function telegramContent(m: TgMessage): { text: string; attachments: Attachment[] } {
  const attachments: Attachment[] = [];
  const add = (type: Attachment["type"], f: TgFile | undefined) => f && attachments.push({ type, ref: `tg:${f.file_id}`, name: f.file_name ?? null, mime: f.mime_type ?? null });
  add("image", m.photo?.length ? m.photo[m.photo.length - 1] : undefined);
  add("audio", m.voice ?? m.audio);
  add("video", m.video ?? m.video_note);
  add("file", m.document);
  add("sticker", m.sticker);
  const text =
    m.text ??
    m.caption ??
    (m.photo ? placeholder("photo") : m.voice ? placeholder("voice message") : m.audio ? placeholder("audio") : m.video || m.video_note ? placeholder("video") : m.document ? placeholder("file") : m.sticker ? (m.sticker.emoji ?? placeholder("sticker")) : placeholder("message"));
  return { text, attachments };
}

export class TelegramBot {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(method: string, body: Record<string, unknown>, timeoutMs = 15_000): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new ChannelError("Could not reach Telegram", true);
    }
    const data = (await res.json().catch(() => null)) as { ok: boolean; result?: T; description?: string; error_code?: number } | null;
    if (!data?.ok) {
      const status = data?.error_code ?? res.status;
      if (status === 401 || status === 404) throw new ChannelError("Telegram rejected the bot token (TELEGRAM_BOT_TOKEN)", false);
      if (status === 409) throw new ChannelError("This bot has a webhook set or another program is reading it; remove the webhook (deleteWebhook) or stop the other program", false);
      if (status === 403) throw new ChannelError("The person blocked the bot or never started it", false);
      throw new ChannelError(`Telegram: ${data?.description ?? `HTTP ${status}`}`, status === 429 || status >= 500);
    }
    return data.result as T;
  }

  me() {
    return this.call<TgUser>("getMe", {});
  }

  /**
   * Waits up to `waitSec` for new messages: chats with the bot, and (Telegram Business) the chats of
   * the account the bot is connected to. Business connections are reported to `onConnection`.
   */
  async updates(offset: number, waitSec: number, onConnection?: (c: TgBusinessConnection) => void): Promise<{ nextOffset: number; threads: IncomingThread[] }> {
    const updates = await this.call<TgUpdate[]>(
      "getUpdates",
      { offset, timeout: waitSec, allowed_updates: ["message", "business_connection", "business_message"] },
      (waitSec + 10) * 1000,
    );
    const byChat = new Map<string, IncomingThread>();
    let nextOffset = offset;
    for (const u of updates) {
      nextOffset = Math.max(nextOffset, u.update_id + 1);
      if (u.business_connection) onConnection?.(u.business_connection);
      const business = !!u.business_message;
      const m = u.business_message ?? u.message;
      // Private chats only: the AI never posts in groups.
      if (!m || m.chat.type !== "private" || (!business && m.from?.is_bot)) continue;
      const chatId = String(m.chat.id);
      const conn = m.business_connection_id ?? "";
      const key = business ? `b:${conn}:${chatId}` : chatId;
      const name = [m.chat.first_name, m.chat.last_name].filter(Boolean).join(" ") || m.chat.username || "Telegram user";
      const thread = byChat.get(key) ?? {
        accountKey: business ? `business:${conn}` : "bot",
        externalThreadId: key,
        participantId: chatId,
        participantName: name,
        participantUsername: m.chat.username ?? null,
        messages: [],
      };
      const { text, attachments } = telegramContent(m);
      // In a business chat the other person's id is the chat id: anything else was you (from your phone).
      const direction = business && m.from && String(m.from.id) !== chatId ? "out" : "in";
      thread.messages.push({
        externalId: `tg:${business ? `${conn}:` : ""}${m.message_id}`,
        direction,
        text: text === "/start" && !business ? "(started the chat)" : text,
        sentAt: new Date(m.date * 1000),
        ...(attachments.length ? { attachments } : {}),
      });
      byChat.set(key, thread);
    }
    return { nextOffset, threads: [...byChat.values()] };
  }

  /** Sends text; with `businessConnectionId`, as your own Telegram account (Telegram Business). */
  async send(chatId: string, text: string, businessConnectionId?: string | null): Promise<{ externalId: string }> {
    const sent = await this.call<TgMessage>("sendMessage", { chat_id: chatId, text, ...(businessConnectionId ? { business_connection_id: businessConnectionId } : {}) });
    return { externalId: `tg:${businessConnectionId ? `${businessConnectionId}:` : ""}${sent.message_id}` };
  }

  /** A file sent in a chat (photos, voice notes…), at most 20 MB (Bot API limit). */
  async download(fileId: string): Promise<{ data: Buffer; mime: string | null } | null> {
    const file = await this.call<{ file_path?: string; file_size?: number }>("getFile", { file_id: fileId });
    if (!file.file_path || (file.file_size ?? 0) > 20 * 1024 * 1024) return null;
    const res = await this.fetchImpl(`https://api.telegram.org/file/bot${this.token}/${file.file_path}`, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
    if (!res?.ok) return null;
    return { data: Buffer.from(await res.arrayBuffer()), mime: res.headers.get("content-type") };
  }
}

// ---- Facebook Pages and Instagram (Graph API) ----

interface GraphConversation {
  id: string;
  updated_time: string;
  participants?: { data: { id: string; name?: string; username?: string }[] };
  messages?: {
    data: {
      id: string;
      message?: string;
      created_time: string;
      from?: { id: string; name?: string; username?: string };
      attachments?: { data?: { mime_type?: string; name?: string; image_data?: { url?: string }; video_data?: { url?: string }; file_url?: string }[] };
    }[];
  };
}

function metaAttachment(a: { mime_type?: string; name?: string; image_data?: { url?: string }; video_data?: { url?: string }; file_url?: string }): Attachment {
  const mime = a.mime_type ?? null;
  if (a.image_data?.url) return { type: /gif|webp/.test(mime ?? "") && /sticker/i.test(a.name ?? "") ? "sticker" : "image", url: a.image_data.url, name: a.name ?? null, mime };
  if (a.video_data?.url) return { type: "video", url: a.video_data.url, name: a.name ?? null, mime };
  return { type: /^audio\//.test(mime ?? "") ? "audio" : "file", url: a.file_url ?? null, name: a.name ?? null, mime };
}

export class MetaMessaging {
  constructor(
    private readonly graphVersion: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async graph<T>(path: string, token: string, init: { method?: "GET" | "POST"; query?: Record<string, string>; body?: unknown } = {}): Promise<T> {
    const url = new URL(`https://graph.facebook.com/${this.graphVersion}/${path}`);
    url.search = new URLSearchParams({ ...(init.query ?? {}), access_token: token }).toString();
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: init.method ?? "GET",
        headers: init.body ? { "Content-Type": "application/json" } : undefined,
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new ChannelError("Could not reach Facebook", true);
    }
    const data = (await res.json().catch(() => null)) as (T & { error?: { message?: string; code?: number; error_subcode?: number } }) | null;
    if (!res.ok || !data || data.error) {
      const e = data?.error;
      if (e?.code === 190) throw new ChannelError("The Facebook login for this Page expired or was removed. Connect again under Social Accounts.", false);
      if (e?.code === 10 || e?.code === 200 || e?.code === 230) {
        throw new ChannelError(`Facebook permission missing: ${e.message ?? "allow messaging for this Page/Instagram account"} (connect again and allow the messaging permissions)`, false);
      }
      if (e?.code === 551 || e?.error_subcode === 2018278) throw new ChannelError("Facebook does not allow a reply here (outside the 24-hour window or the person is unavailable)", false);
      throw new ChannelError(`Facebook: ${e?.message ?? `HTTP ${res.status}`}`, res.status >= 500 || e?.code === 4 || e?.code === 32 || e?.code === 613);
    }
    return data;
  }

  /**
   * Recent conversations of a Page (platform "messenger") or of the Instagram account linked to
   * it (platform "instagram"), with their latest messages. `selfId` is the Page id or the
   * Instagram account id: messages from it are ours.
   */
  async conversations(pageId: string, token: string, platform: "messenger" | "instagram", selfId: string, updatedSince: Date | null): Promise<IncomingThread[]> {
    const page = await this.graph<{ data: GraphConversation[] }>(`${pageId}/conversations`, token, {
      query: {
        platform,
        fields: "id,updated_time,participants,messages.limit(20){id,message,created_time,from,attachments{mime_type,name,image_data,video_data,file_url}}",
        limit: "25",
      },
    });
    const threads: IncomingThread[] = [];
    for (const c of page.data) {
      if (updatedSince && new Date(c.updated_time) <= updatedSince) continue;
      const other = c.participants?.data.find((p) => p.id !== selfId && p.id !== pageId);
      if (!other) continue;
      const messages = (c.messages?.data ?? [])
        .map((m) => ({
          externalId: `meta:${m.id}`,
          direction: (m.from?.id === selfId || m.from?.id === pageId ? "out" : "in") as "in" | "out",
          text: m.message?.trim() || (m.attachments ? placeholder("attachment") : placeholder("message")),
          sentAt: new Date(m.created_time),
          ...(m.attachments?.data?.length ? { attachments: m.attachments.data.map(metaAttachment) } : {}),
        }))
        .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
      threads.push({
        externalThreadId: c.id,
        participantId: other.id,
        participantName: other.name || other.username || (platform === "instagram" ? "Instagram user" : "Facebook user"),
        participantUsername: other.username ?? null,
        messages,
      });
    }
    return threads;
  }

  /** Reply through the Page (Messenger) or the Instagram account linked to the Page. */
  async send(pageId: string, token: string, recipientId: string, text: string): Promise<{ externalId: string }> {
    const sent = await this.graph<{ message_id?: string; recipient_id?: string }>(`${pageId}/messages`, token, {
      method: "POST",
      body: { recipient: { id: recipientId }, messaging_type: "RESPONSE", message: { text } },
    });
    if (!sent.message_id) throw new ChannelError("Facebook did not confirm the message", true);
    return { externalId: `meta:${sent.message_id}` };
  }
}

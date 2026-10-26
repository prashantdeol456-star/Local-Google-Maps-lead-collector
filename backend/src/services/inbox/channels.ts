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

export interface IncomingMessage {
  externalId: string;
  direction: "in" | "out";
  text: string;
  sentAt: Date;
}

export interface IncomingThread {
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
interface TgMessage {
  message_id: number;
  date: number;
  chat: { id: number; type: string; first_name?: string; last_name?: string; username?: string; title?: string };
  from?: TgUser;
  text?: string;
  caption?: string;
  photo?: unknown;
  voice?: unknown;
  video?: unknown;
  document?: unknown;
  sticker?: { emoji?: string };
}
interface TgUpdate {
  update_id: number;
  message?: TgMessage;
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

  /** Waits up to `waitSec` for new messages. */
  async updates(offset: number, waitSec: number): Promise<{ nextOffset: number; threads: IncomingThread[] }> {
    const updates = await this.call<TgUpdate[]>("getUpdates", { offset, timeout: waitSec, allowed_updates: ["message"] }, (waitSec + 10) * 1000);
    const byChat = new Map<string, IncomingThread>();
    let nextOffset = offset;
    for (const u of updates) {
      nextOffset = Math.max(nextOffset, u.update_id + 1);
      const m = u.message;
      // Private chats only: the AI never posts in groups.
      if (!m || m.chat.type !== "private" || m.from?.is_bot) continue;
      const id = String(m.chat.id);
      const name = [m.chat.first_name, m.chat.last_name].filter(Boolean).join(" ") || m.chat.username || "Telegram user";
      const thread = byChat.get(id) ?? { externalThreadId: id, participantId: id, participantName: name, participantUsername: m.chat.username ?? null, messages: [] };
      const text =
        m.text ??
        m.caption ??
        (m.photo ? placeholder("photo") : m.voice ? placeholder("voice message") : m.video ? placeholder("video") : m.document ? placeholder("file") : m.sticker ? (m.sticker.emoji ?? placeholder("sticker")) : placeholder("message"));
      // /start is Telegram's "open the bot" button.
      thread.messages.push({ externalId: `tg:${m.message_id}`, direction: "in", text: text === "/start" ? "(started the chat)" : text, sentAt: new Date(m.date * 1000) });
      byChat.set(id, thread);
    }
    return { nextOffset, threads: [...byChat.values()] };
  }

  async send(chatId: string, text: string): Promise<{ externalId: string }> {
    const sent = await this.call<TgMessage>("sendMessage", { chat_id: chatId, text });
    return { externalId: `tg:${sent.message_id}` };
  }
}

// ---- Facebook Pages and Instagram (Graph API) ----

interface GraphConversation {
  id: string;
  updated_time: string;
  participants?: { data: { id: string; name?: string; username?: string }[] };
  messages?: { data: { id: string; message?: string; created_time: string; from?: { id: string; name?: string; username?: string }; attachments?: unknown }[] };
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
        fields: "id,updated_time,participants,messages.limit(20){id,message,created_time,from,attachments}",
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

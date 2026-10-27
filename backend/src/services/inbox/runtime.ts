// The AI Inbox's live configuration: which AI provider and model write replies, and the
// Telegram bot. Keys entered in the admin panel (stored encrypted) take effect at once, without
// a restart; backend/.env values are the fallback.

import Anthropic from "@anthropic-ai/sdk";
import { ApiError, GoogleGenAI } from "@google/genai";
import type { AiAssistantSettingsRecord, Repositories } from "../../database/repositories/index.js";
import type { InboxConfig } from "../../providers/inbox/config.js";
import type { SecretBox } from "../../utils/secretBox.js";
import { ChannelError, TelegramBot } from "./channels.js";
import { GeminiReplyWriter } from "./geminiWriter.js";
import { AnthropicReplyWriter, type ReplyWriter } from "./replyWriter.js";

export type AiProvider = "anthropic" | "gemini";
export type Effort = "low" | "medium" | "high";

export interface ModelOption {
  id: string;
  label: string;
  note: string;
}

/** Models offered in the admin panel (a custom model id can be typed too). */
export const MODELS: Record<AiProvider, ModelOption[]> = {
  anthropic: [
    { id: "claude-opus-5-5", label: "Claude Opus 5.5", note: "Best replies (recommended) · $4 / $20 per million tokens" },
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", note: "Fast and capable · $2 / $10" },
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", note: "Cheapest · $0.10 / $0.50" },
    { id: "claude-fable-5-1", label: "Claude Fable 5.1", note: "Most capable, most expensive · $10 / $50" },
  ],
  gemini: [
    { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", note: "Fast, newest Flash (recommended)" },
    { id: "gemini-4-argon", label: "Gemini 4 Argon", note: "Google's most capable model, slower and costlier" },
    { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", note: "Previous Flash" },
    { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", note: "Cheapest" },
  ],
};

export const DEFAULT_MODEL: Record<AiProvider, string> = { anthropic: "claude-opus-5-5", gemini: "gemini-3.8-flash" };

export type SecretName = "anthropicKey" | "geminiKey" | "telegramToken";

const COLUMNS: Record<SecretName, { enc: "anthropicKeyEnc" | "geminiKeyEnc" | "telegramTokenEnc"; hint: "anthropicKeyHint" | "geminiKeyHint" | "telegramTokenHint" }> = {
  anthropicKey: { enc: "anthropicKeyEnc", hint: "anthropicKeyHint" },
  geminiKey: { enc: "geminiKeyEnc", hint: "geminiKeyHint" },
  telegramToken: { enc: "telegramTokenEnc", hint: "telegramTokenHint" },
};

export const TELEGRAM_TOKEN = /^\d+:[A-Za-z0-9_-]{30,}$/;

const hint = (value: string) => `…${value.slice(-4)}`;

export class InboxRuntime {
  private cache: { stamp: string; writer: ReplyWriter | null; telegram: TelegramBot | null; telegramToken: string | null } | null = null;

  constructor(
    private readonly repos: Repositories,
    private readonly box: SecretBox,
    private readonly env: InboxConfig,
    private readonly opts: { writerOverride?: ReplyWriter | null; fetch?: typeof fetch } = {},
  ) {}

  private open(sealed: string | null): string | null {
    if (!sealed) return null;
    try {
      return this.box.open(sealed);
    } catch {
      return null; // SESSION_SECRET changed: the admin enters the key again
    }
  }

  /** The key in use for each secret, and where it comes from. */
  private secrets(s: AiAssistantSettingsRecord) {
    const pick = (name: SecretName, fromEnv: string | null) => {
      const stored = this.open(s[COLUMNS[name].enc]);
      return stored ? { value: stored, source: "admin" as const, hint: s[COLUMNS[name].hint] } : fromEnv ? { value: fromEnv, source: "env" as const, hint: hint(fromEnv) } : null;
    };
    return {
      anthropicKey: pick("anthropicKey", this.env.ai?.apiKey ?? null),
      geminiKey: pick("geminiKey", this.env.geminiApiKey),
      telegramToken: pick("telegramToken", this.env.telegramBotToken),
    };
  }

  private choice(s: AiAssistantSettingsRecord) {
    const provider: AiProvider = s.aiProvider === "gemini" ? "gemini" : "anthropic";
    const envModel = provider === "anthropic" ? this.env.ai?.model : undefined;
    const model = s.aiModel.trim() || envModel || DEFAULT_MODEL[provider];
    const effort: Effort = s.aiEffort === "low" || s.aiEffort === "high" ? s.aiEffort : "medium";
    return { provider, model, effort };
  }

  private async resolve() {
    const s = await this.repos.inbox.getSettings();
    const stamp = [s.updatedAt.getTime(), s.aiProvider, s.aiModel, s.aiEffort, s.anthropicKeyEnc, s.geminiKeyEnc, s.telegramTokenEnc].join("|");
    if (this.cache?.stamp === stamp) return this.cache;
    const keys = this.secrets(s);
    const { provider, model, effort } = this.choice(s);
    let writer: ReplyWriter | null = null;
    if (this.opts.writerOverride !== undefined) writer = this.opts.writerOverride;
    else if (provider === "anthropic" && keys.anthropicKey) writer = new AnthropicReplyWriter({ apiKey: keys.anthropicKey.value, model, effort });
    else if (provider === "gemini" && keys.geminiKey) writer = new GeminiReplyWriter({ apiKey: keys.geminiKey.value, model, effort });
    const telegramToken = keys.telegramToken?.value ?? null;
    const telegram = telegramToken ? new TelegramBot(telegramToken, this.opts.fetch) : null;
    this.cache = { stamp, writer, telegram, telegramToken };
    return this.cache;
  }

  async writer(): Promise<ReplyWriter | null> {
    return (await this.resolve()).writer;
  }

  async telegram(): Promise<{ bot: TelegramBot; token: string } | null> {
    const r = await this.resolve();
    return r.telegram && r.telegramToken ? { bot: r.telegram, token: r.telegramToken } : null;
  }

  /** What the admin panel shows (never the keys themselves). */
  async describe() {
    const s = await this.repos.inbox.getSettings();
    const keys = this.secrets(s);
    const { provider, model, effort } = this.choice(s);
    const info = (k: { source: "admin" | "env"; hint: string | null } | null) => (k ? { set: true, source: k.source, hint: k.hint } : { set: false, source: null, hint: null });
    return {
      provider,
      model,
      effort,
      models: MODELS,
      ready: provider === "anthropic" ? !!keys.anthropicKey : !!keys.geminiKey,
      keys: { anthropicKey: info(keys.anthropicKey), geminiKey: info(keys.geminiKey), telegramToken: info(keys.telegramToken) },
    };
  }

  /** Saves (or with null, removes) a key entered in the admin panel. */
  async setSecret(name: SecretName, value: string | null) {
    const cols = COLUMNS[name];
    const clean = value?.trim() || null;
    if (clean && name === "telegramToken" && !TELEGRAM_TOKEN.test(clean)) throw new Error("That does not look like a bot token from @BotFather (digits, a colon, then a long code)");
    if (clean && name === "anthropicKey" && !clean.startsWith("sk-ant-")) throw new Error('A Claude API key starts with "sk-ant-"');
    if (clean && clean.length > 500) throw new Error("That key is too long");
    await this.repos.inbox.updateSettings({ [cols.enc]: clean ? this.box.seal(clean) : null, [cols.hint]: clean ? hint(clean) : null });
    this.cache = null;
  }

  invalidate() {
    this.cache = null;
  }

  /** Checks a key with a free call (no message is generated or sent). */
  async test(what: "ai" | "telegram"): Promise<{ ok: boolean; detail: string }> {
    const s = await this.repos.inbox.getSettings();
    const keys = this.secrets(s);
    if (what === "telegram") {
      if (!keys.telegramToken) return { ok: false, detail: "No Telegram bot token yet" };
      try {
        const me = await new TelegramBot(keys.telegramToken.value, this.opts.fetch).me();
        return { ok: true, detail: `Connected to @${me.username ?? me.first_name}` };
      } catch (err) {
        return { ok: false, detail: err instanceof ChannelError ? err.message : String(err) };
      }
    }
    const { provider, model } = this.choice(s);
    if (provider === "anthropic") {
      if (!keys.anthropicKey) return { ok: false, detail: "No Claude API key yet" };
      try {
        const info = await new Anthropic({ apiKey: keys.anthropicKey.value, maxRetries: 0, timeout: 15_000 }).models.retrieve(model);
        return { ok: true, detail: `Key works · ${info.display_name ?? model}` };
      } catch (err) {
        if (err instanceof Anthropic.AuthenticationError) return { ok: false, detail: "The Claude API key was rejected" };
        if (err instanceof Anthropic.NotFoundError) return { ok: false, detail: `Model "${model}" was not found for this key` };
        if (err instanceof Anthropic.APIError) return { ok: false, detail: `Claude API error ${err.status ?? ""}: ${err.message}` };
        return { ok: false, detail: "Could not reach the Claude API" };
      }
    }
    if (!keys.geminiKey) return { ok: false, detail: "No Gemini API key yet" };
    try {
      const m = await new GoogleGenAI({ apiKey: keys.geminiKey.value }).models.get({ model });
      return { ok: true, detail: `Key works · ${m.displayName ?? model}` };
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 404) return { ok: false, detail: `Model "${model}" was not found for this key` };
        if (err.status === 400 || err.status === 401 || err.status === 403) return { ok: false, detail: "The Gemini API key was rejected" };
        return { ok: false, detail: `Gemini API error ${err.status}: ${err.message}` };
      }
      return { ok: false, detail: "Could not reach the Gemini API" };
    }
  }
}

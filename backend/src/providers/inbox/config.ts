import { z } from "zod";

// AI Inbox: the Claude key and model that write replies, and the Telegram bot token.
// (Facebook/Instagram use the Pages connected under Social Accounts.)

const empty = (v: unknown) => (v === "" ? undefined : v);

const InboxEnv = z.object({
  ANTHROPIC_API_KEY: z.preprocess(empty, z.string().trim().optional()),
  INBOX_AI_MODEL: z.preprocess(empty, z.string().trim().regex(/^[a-z0-9.-]+$/, "must be a model id such as claude-opus-5-5").default("claude-opus-5-5")),
  INBOX_AI_EFFORT: z.preprocess(empty, z.enum(["low", "medium", "high"]).default("medium")),
  /** From @BotFather; empty = Telegram off */
  TELEGRAM_BOT_TOKEN: z.preprocess(empty, z.string().trim().regex(/^\d+:[A-Za-z0-9_-]{30,}$/, "does not look like a bot token from @BotFather").optional()),
  /** How often Facebook/Instagram inboxes are checked */
  INBOX_POLL_SECONDS: z.preprocess(empty, z.coerce.number().int().min(20).max(3600).default(60)),
});

export interface InboxConfig {
  ai: { apiKey: string; model: string; effort: "low" | "medium" | "high" } | null;
  telegramBotToken: string | null;
  pollSeconds: number;
}

export function parseInboxConfig(env: Record<string, string | undefined>): InboxConfig {
  const parsed = InboxEnv.safeParse(env);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new Error(`AI Inbox settings: ${issue.path.join(".")} ${issue.message}`);
  }
  const e = parsed.data;
  return {
    ai: e.ANTHROPIC_API_KEY ? { apiKey: e.ANTHROPIC_API_KEY, model: e.INBOX_AI_MODEL, effort: e.INBOX_AI_EFFORT } : null,
    telegramBotToken: e.TELEGRAM_BOT_TOKEN ?? null,
    pollSeconds: e.INBOX_POLL_SECONDS,
  };
}

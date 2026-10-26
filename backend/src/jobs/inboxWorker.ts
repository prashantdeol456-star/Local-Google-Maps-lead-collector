// Background work for the AI Inbox:
// - Telegram: long polling (getUpdates), so it works on a laptop without a public address;
// - Facebook Pages and Instagram: the Conversations API, checked every INBOX_POLL_SECONDS;
// - every few seconds: answer chats that are waiting (InboxService.processDue).

import type { Repositories } from "../database/repositories/index.js";
import { ChannelError, type MetaMessaging, type TelegramBot } from "../services/inbox/channels.js";
import type { InboxService } from "../services/inbox/inboxService.js";
import type { SocialService } from "../services/social/socialService.js";

export class InboxWorker {
  private stopped = true;
  private timers: ReturnType<typeof setInterval>[] = [];
  private telegramLoop: Promise<void> | null = null;
  private telegramAbort = new AbortController();
  private processing: Promise<unknown> | null = null;
  private polling: Promise<unknown> | null = null;
  /** account id → newest conversation update seen */
  private readonly seen = new Map<string, Date>();

  constructor(
    private readonly repos: Repositories,
    private readonly inbox: InboxService,
    private readonly opts: {
      telegram: TelegramBot | null;
      meta: MetaMessaging | null;
      social: SocialService;
      pollSeconds: number;
      log: (msg: string) => void;
    },
  ) {}

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.timers.push(setInterval(() => void this.processOnce(), 5_000));
    if (this.opts.meta) {
      this.timers.push(setInterval(() => void this.pollMetaOnce(), this.opts.pollSeconds * 1000));
      void this.pollMetaOnce();
    }
    if (this.opts.telegram) this.telegramLoop = this.runTelegram();
  }

  async stop() {
    this.stopped = true;
    this.timers.forEach(clearInterval);
    this.timers = [];
    this.telegramAbort.abort();
    await Promise.allSettled([this.telegramLoop, this.processing, this.polling]);
  }

  processOnce() {
    this.processing ??= this.inbox
      .processDue()
      .catch((err) => this.opts.log(`AI inbox: ${String(err)}`))
      .finally(() => (this.processing = null));
    return this.processing;
  }

  private async runTelegram() {
    const bot = this.opts.telegram!;
    try {
      const me = await bot.me();
      this.opts.log(`AI inbox: Telegram bot @${me.username ?? me.first_name} is listening`);
    } catch (err) {
      this.opts.log(`AI inbox: Telegram bot not available: ${err instanceof Error ? err.message : String(err)}`);
      if (err instanceof ChannelError && !err.retryable) return;
    }
    while (!this.stopped) {
      try {
        await this.telegramOnce(25);
      } catch (err) {
        const retryable = !(err instanceof ChannelError) || err.retryable;
        this.opts.log(`AI inbox: Telegram: ${err instanceof Error ? err.message : String(err)}`);
        await this.sleep(retryable ? 10_000 : 120_000);
      }
    }
  }

  /** One long-poll round (also used by tests with waitSec 0). */
  async telegramOnce(waitSec: number) {
    const bot = this.opts.telegram;
    if (!bot) return 0;
    const settings = await this.repos.inbox.getSettings();
    const { nextOffset, threads } = await bot.updates(settings.telegramOffset, waitSec);
    for (const t of threads) await this.inbox.ingest("telegram", "bot", t);
    if (nextOffset !== settings.telegramOffset) await this.repos.inbox.updateSettings({ telegramOffset: nextOffset });
    return threads.length;
  }

  pollMetaOnce() {
    this.polling ??= this.pollMeta()
      .catch((err) => this.opts.log(`AI inbox: Facebook/Instagram: ${String(err)}`))
      .finally(() => (this.polling = null));
    return this.polling;
  }

  private async pollMeta() {
    const meta = this.opts.meta;
    if (!meta) return;
    const accounts = (await this.repos.socialAccounts.list()).filter((a) => (a.platform === "facebook_page" || a.platform === "instagram") && a.status !== "expired");
    for (const account of accounts) {
      let token: string;
      try {
        token = (await this.opts.social.tokenFor(account.id)).token;
      } catch {
        continue; // unreadable token: Social Accounts shows it
      }
      const isInstagram = account.platform === "instagram";
      let pageId = account.externalId;
      if (isInstagram) {
        try {
          pageId = (JSON.parse(account.meta) as { pageId?: string }).pageId ?? "";
        } catch {
          pageId = "";
        }
        if (!pageId) continue;
      }
      try {
        const since = this.seen.get(account.id) ?? null;
        const threads = await meta.conversations(pageId, token, isInstagram ? "instagram" : "messenger", account.externalId, since);
        let newest = since;
        for (const t of threads) {
          await this.inbox.ingest(isInstagram ? "instagram" : "facebook", account.id, t);
          const last = t.messages.at(-1)?.sentAt;
          if (last && (!newest || last > newest)) newest = last;
        }
        if (newest) this.seen.set(account.id, newest);
        if (account.lastError?.startsWith("Inbox:")) await this.repos.socialAccounts.update(account.id, { lastError: null });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (err instanceof ChannelError && !err.retryable) await this.repos.socialAccounts.update(account.id, { lastError: `Inbox: ${message}`.slice(0, 500) });
        this.opts.log(`AI inbox: ${account.name}: ${message}`);
      }
    }
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      this.telegramAbort.signal.addEventListener("abort", () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
}

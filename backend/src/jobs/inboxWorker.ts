// Background work for the AI Inbox:
// - Telegram: long polling (getUpdates), so it works on a laptop without a public address;
// - Facebook Pages and Instagram: the Conversations API, checked every INBOX_POLL_SECONDS;
// - every few seconds: answer chats that are waiting (InboxService.processDue).

import { ownerScope, type OwnerScope } from "../database/ownerScope.js";
import type { Repositories } from "../database/repositories/index.js";
import { ChannelError, type MetaMessaging } from "../services/inbox/channels.js";
import type { InboxRuntime } from "../services/inbox/runtime.js";
import type { InboxService } from "../services/inbox/inboxService.js";
import type { SocialService } from "../services/social/socialService.js";

export class InboxWorker {
  private stopped = true;
  private timers: ReturnType<typeof setInterval>[] = [];
  private telegramLoop: Promise<void> | null = null;
  /** user id → their bot's polling loop (each user can connect their own bot) */
  private readonly telegramLoops = new Map<string, Promise<void>>();
  private telegramAbort = new AbortController();
  private processing: Promise<unknown> | null = null;
  private polling: Promise<unknown> | null = null;
  /** account id → newest conversation update seen */
  private readonly seen = new Map<string, Date>();

  constructor(
    private readonly repos: Repositories,
    private readonly inbox: InboxService,
    private readonly opts: {
      runtime: InboxRuntime;
      meta: MetaMessaging | null;
      metaReady?: () => boolean;
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
    this.telegramLoop = this.runTelegram();
  }

  async stop() {
    this.stopped = true;
    this.timers.forEach(clearInterval);
    this.timers = [];
    this.telegramAbort.abort();
    await Promise.allSettled([this.telegramLoop, this.processing, this.polling]);
  }

  /** Each user with inbox settings, as the data scope to work in (their chats, keys and bot). */
  private async owners(): Promise<OwnerScope[]> {
    // Users who saved inbox settings, and every super admin (they can run on the .env keys).
    const superAdmins = (await this.repos.adminUsers.list({ status: "active" })).filter((u) => u.role === "super_admin").map((u) => u.id);
    const ids = new Set([...superAdmins, ...(await this.repos.inbox.listSettingsOwners())]);
    const scopes: OwnerScope[] = [];
    for (const id of ids) {
      const scope = await this.scopeOf(id);
      if (scope) scopes.push(scope);
    }
    return scopes;
  }

  private async scopeOf(userId: string | null | undefined): Promise<OwnerScope | null> {
    if (!userId) return null;
    const user = await this.repos.adminUsers.findById(userId);
    return user?.status === "active" ? { userId, ownerId: userId, customer: user.role !== "super_admin" } : null;
  }

  processOnce() {
    this.processing ??= (async () => {
      for (const scope of await this.owners()) {
        await ownerScope.run(scope, () => this.inbox.processDue()).catch((err) => this.opts.log(`AI inbox: ${String(err)}`));
      }
    })()
      .catch((err) => this.opts.log(`AI inbox: ${String(err)}`))
      .finally(() => (this.processing = null));
    return this.processing;
  }

  /** Starts a polling loop for every user whose bot token is set; loops end when it is removed. */
  private async runTelegram() {
    while (!this.stopped) {
      try {
        for (const scope of await this.owners()) {
          if (this.telegramLoops.has(scope.userId)) continue;
          const bot = await ownerScope.run(scope, () => this.opts.runtime.telegram()).catch(() => null);
          if (!bot) continue;
          const loop = this.runTelegramFor(scope).finally(() => this.telegramLoops.delete(scope.userId));
          this.telegramLoops.set(scope.userId, loop);
        }
      } catch (err) {
        this.opts.log(`AI inbox: Telegram: ${String(err)}`);
      }
      await this.sleep(15_000);
    }
    await Promise.allSettled(this.telegramLoops.values());
  }

  /** Keeps reading one user's bot; follows a token changed in the admin panel, ends when removed. */
  private async runTelegramFor(scope: OwnerScope) {
    let announced: string | null = null;
    while (!this.stopped) {
      const telegram = await ownerScope.run(scope, () => this.opts.runtime.telegram()).catch(() => null);
      if (!telegram) return;
      if (announced !== telegram.token) {
        announced = telegram.token;
        try {
          const me = await telegram.bot.me();
          this.opts.log(`AI inbox: Telegram bot @${me.username ?? me.first_name} is listening`);
        } catch (err) {
          this.opts.log(`AI inbox: Telegram bot not available: ${err instanceof Error ? err.message : String(err)}`);
          await this.sleep(err instanceof ChannelError && !err.retryable ? 60_000 : 10_000);
          announced = null;
          continue;
        }
      }
      try {
        await ownerScope.run(scope, () => this.telegramRound(25));
      } catch (err) {
        const retryable = !(err instanceof ChannelError) || err.retryable;
        this.opts.log(`AI inbox: Telegram: ${err instanceof Error ? err.message : String(err)}`);
        await this.sleep(retryable ? 10_000 : 60_000);
        announced = null;
      }
    }
  }

  /** One long-poll round of the current user's bot (inside their scope). */
  private async telegramRound(waitSec: number) {
    const bot = (await this.opts.runtime.telegram())?.bot;
    if (!bot) return 0;
    const settings = await this.repos.inbox.getSettings();
    const { nextOffset, threads } = await bot.updates(settings.telegramOffset, waitSec);
    for (const t of threads) await this.inbox.ingest("telegram", "bot", t);
    if (nextOffset !== settings.telegramOffset) await this.repos.inbox.updateSettings({ telegramOffset: nextOffset });
    return threads.length;
  }

  /** One round of every user's bot (tests use waitSec 0). */
  async telegramOnce(waitSec: number) {
    let total = 0;
    for (const scope of await this.owners()) total += await ownerScope.run(scope, () => this.telegramRound(waitSec));
    return total;
  }

  pollMetaOnce() {
    this.polling ??= this.pollMeta()
      .catch((err) => this.opts.log(`AI inbox: Facebook/Instagram: ${String(err)}`))
      .finally(() => (this.polling = null));
    return this.polling;
  }

  private async pollMeta() {
    const meta = this.opts.meta;
    if (!meta || !(this.opts.metaReady?.() ?? true)) return;
    const accounts = (await this.repos.socialAccounts.list()).filter((a) => (a.platform === "facebook_page" || a.platform === "instagram") && a.status !== "expired");
    for (const account of accounts) {
      const scope = await this.scopeOf(account.ownerId);
      if (!scope) continue; // owner disabled or deleted
      await ownerScope.run(scope, () => this.pollAccount(meta, account));
    }
  }

  private async pollAccount(meta: MetaMessaging, account: Awaited<ReturnType<Repositories["socialAccounts"]["list"]>>[number]) {
    {
      let token: string;
      try {
        token = (await this.opts.social.tokenFor(account.id)).token;
      } catch {
        return; // unreadable token: Social Accounts shows it
      }
      const isInstagram = account.platform === "instagram";
      let pageId = account.externalId;
      if (isInstagram) {
        try {
          pageId = (JSON.parse(account.meta) as { pageId?: string }).pageId ?? "";
        } catch {
          pageId = "";
        }
        if (!pageId) return;
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

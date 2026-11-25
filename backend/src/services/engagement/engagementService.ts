// Social Engagement: who commented, reacted or shared on the user's own Facebook Page and
// Instagram posts, saved as people with their history.
//
//   sync:     every few minutes (EngagementWorker) and on "Sync now": the latest posts of each
//             connected account; a post whose counts changed (or is new) is read again in full
//             (comments, Facebook reactions, public Facebook shares).
//   realtime: Meta webhooks ("feed" for Pages, "comments" for Instagram) → that post is read
//             again a few seconds later. Signed with the Meta app secret.
//   people:   one row per person per platform, with counts, last comment, a lead signal
//             (comments asking about price, details…), status and notes.
//   reply:    answer a comment from the admin panel (posted as the Page / Instagram account).
//
// SaaS: every customer connects their own accounts (Social Accounts); all rows carry the
// account owner's id, so each customer only sees their own engagement.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { PrismaClient, SocialAccount, SocialEngagement, SocialPerson, SocialPost } from "../../generated/prisma/client.js";
import { containsInsensitive } from "../../database/client.js";
import { ownerScope, type OwnerScope } from "../../database/ownerScope.js";
import type { SocialConfig } from "../../providers/social/config.js";
import { Errors } from "../../utils/errors.js";
import type { EventBus } from "../events.js";
import { csvRow, UTF8_BOM } from "../export/csv.js";
import type { SocialService } from "../social/socialService.js";
import { EngagementApiError, type ApiComment, type ApiPerson, type MetaEngagementApi } from "./metaEngagement.js";

export const ENGAGEMENT_PLATFORMS = ["facebook", "instagram"] as const;
export type EngagementPlatform = (typeof ENGAGEMENT_PLATFORMS)[number];
export const PERSON_STATUSES = ["new", "lead", "customer", "ignore"] as const;
export const ENGAGEMENT_KINDS = ["comment", "reaction", "share"] as const;

/** Posts read on the first sync of an account, and on later ones. */
const BACKFILL_POSTS = 50;
const RECENT_POSTS = 25;
const WEBHOOK_DELAY_MS = 3_000;
/** Page webhook fields this app subscribes each Page to. */
const PAGE_FIELDS = "feed,messages";

/** Words in a comment that usually mean the person wants to buy or know more. */
const LEAD_WORDS =
  /(\bprice\b|\bprices\b|\bpricing\b|\bcost\b|\bfees?\b|\brates?\b|\bcharges?\b|\bkitn[aie]\b|\bkitne\b|\bdetails?\b|\binfo\b|\binformation\b|\binterested\b|\bdm\b|\binbox\b|\bcontact\b|\bnumber\b|\bwhatsapp\b|\bcall me\b|\bbook(ing)?\b|\benquiry\b|\binquiry\b|how much|\bavailable\b|\baddress\b|\blocation\b|\badmission\b|\bapply\b|\border\b|\bbuy\b|\bdelivery\b|\bplease share\b|\bsend\b)/i;

export function looksLikeLead(text: string | null | undefined): boolean {
  return !!text && LEAD_WORDS.test(text);
}

interface AccountMeta {
  pageId?: string;
  engagement?: { syncedAt?: string; error?: string | null; realtime?: boolean; realtimeError?: string | null; realtimeFields?: string };
}

function readMeta(account: SocialAccount): AccountMeta {
  try {
    return JSON.parse(account.meta) as AccountMeta;
  } catch {
    return {};
  }
}

const platformOf = (account: SocialAccount): EngagementPlatform => (account.platform === "instagram" ? "instagram" : "facebook");

export interface PublicAccountSync {
  id: string;
  platform: EngagementPlatform;
  name: string;
  username: string | null;
  pictureUrl: string | null;
  status: string;
  syncedAt: string | null;
  error: string | null;
  realtime: boolean;
  posts: number;
}

export class EngagementService {
  /** "accountId|postId" → timer: webhooks for one post within a few seconds are read once. */
  private readonly pending = new Map<string, { timer: ReturnType<typeof setTimeout>; run: () => Promise<void> }>();
  private readonly running = new Set<Promise<unknown>>();

  constructor(
    private readonly db: PrismaClient,
    private readonly opts: {
      api: MetaEngagementApi;
      social: SocialService;
      bus?: EventBus;
      /** The Meta app (Integrations page or .env), read each time: it can change. */
      meta: () => SocialConfig["meta"];
      /** Typed on the Meta app's Webhooks page (shown to super admins in the Setup box). */
      verifyToken: string;
      publicBaseUrl: string | null;
      webhookDelayMs?: number;
      /** New Messenger / Instagram messages for these accounts (the AI Inbox reads them now) */
      onMessages?: (accountIds: string[]) => void;
      now?: () => Date;
      log?: (msg: string) => void;
    },
  ) {}

  private now() {
    return this.opts.now?.() ?? new Date();
  }

  // ---- Accounts and sync ----

  /** Facebook Pages and Instagram accounts of the current user (all accounts for a super admin). */
  async accounts(): Promise<PublicAccountSync[]> {
    const rows = await this.db.socialAccount.findMany({ where: { platform: { in: ["facebook_page", "instagram"] } }, orderBy: { createdAt: "asc" } });
    const counts = await this.db.socialPost.groupBy({ by: ["accountId"], _count: { _all: true } });
    const byAccount = new Map(counts.map((c) => [c.accountId, c._count._all]));
    return rows.map((a) => {
      const e = readMeta(a).engagement ?? {};
      return {
        id: a.id,
        platform: platformOf(a),
        name: a.name,
        username: a.username,
        pictureUrl: a.pictureUrl,
        status: a.status,
        syncedAt: e.syncedAt ?? null,
        error: e.error ?? null,
        realtime: !!e.realtime,
        posts: byAccount.get(a.id) ?? 0,
      };
    });
  }

  private async saveSyncState(account: SocialAccount, patch: NonNullable<AccountMeta["engagement"]>) {
    const fresh = await this.db.socialAccount.findUnique({ where: { id: account.id } });
    if (!fresh) return;
    const meta = readMeta(fresh);
    meta.engagement = { ...(meta.engagement ?? {}), ...patch };
    await this.db.socialAccount.update({ where: { id: account.id }, data: { meta: JSON.stringify(meta) } });
  }

  private async token(account: SocialAccount) {
    try {
      return (await this.opts.social.tokenFor(account.id)).token;
    } catch {
      throw new EngagementApiError("The stored login cannot be read. Connect the account again under Social Accounts.", false);
    }
  }

  /** Reads the latest posts of one account and, for posts that changed, who engaged. */
  async syncAccount(accountId: string): Promise<{ posts: number; added: number }> {
    if (!this.opts.meta()) throw Errors.badRequest("Facebook login is not set up: the administrator adds the Meta app on the Integrations page");
    const account = await this.db.socialAccount.findUnique({ where: { id: accountId } });
    if (!account || (account.platform !== "facebook_page" && account.platform !== "instagram")) throw Errors.notFound("Account not found");
    try {
      const result = await this.syncAccountInner(account);
      await this.saveSyncState(account, { syncedAt: this.now().toISOString(), error: null });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.saveSyncState(account, { error: message.slice(0, 500) });
      throw err instanceof EngagementApiError ? Errors.badRequest(message) : err;
    }
  }

  private async syncAccountInner(account: SocialAccount) {
    const token = await this.token(account);
    const platform = platformOf(account);
    const meta = readMeta(account);
    const first = !meta.engagement?.syncedAt;
    const limit = first ? BACKFILL_POSTS : RECENT_POSTS;
    const posts = platform === "facebook" ? await this.opts.api.facebookPosts(account.externalId, token, limit) : await this.opts.api.instagramPosts(account.externalId, token, limit);

    let added = 0;
    for (const p of posts) {
      const existing = await this.db.socialPost.findFirst({ where: { accountId: account.id, externalId: p.externalId } });
      const data = {
        message: p.message,
        permalink: p.permalink,
        imageUrl: p.imageUrl,
        postedAt: p.postedAt,
        commentCount: p.commentCount,
        reactionCount: p.reactionCount,
        shareCount: p.shareCount,
      };
      const changed =
        !existing ||
        !existing.lastSyncedAt ||
        existing.commentCount !== p.commentCount ||
        existing.reactionCount !== p.reactionCount ||
        (existing.shareCount ?? 0) !== (p.shareCount ?? 0);
      const post = existing
        ? await this.db.socialPost.update({ where: { id: existing.id }, data })
        : await this.db.socialPost.create({ data: { ...data, ownerId: account.ownerId, accountId: account.id, platform, externalId: p.externalId } });
      if (changed) added += await this.syncPost(account, post, token);
    }

    // Real-time updates: ask Meta to send this Page's posts and messages to the app (once).
    if (platform === "facebook" && meta.engagement?.realtimeFields !== PAGE_FIELDS) {
      try {
        await this.opts.api.subscribePage(account.externalId, token);
        await this.saveSyncState(account, { realtime: true, realtimeError: null, realtimeFields: PAGE_FIELDS });
      } catch (err) {
        await this.saveSyncState(account, { realtime: false, realtimeError: (err instanceof Error ? err.message : String(err)).slice(0, 300) });
      }
    }
    if (platform === "instagram" && !meta.engagement?.realtime) await this.saveSyncState(account, { realtime: true });
    return { posts: posts.length, added };
  }

  /** Reads every comment (and on Facebook every reaction and public share) of one post. Returns new rows. */
  private async syncPost(account: SocialAccount, post: SocialPost, token: string): Promise<number> {
    const platform = platformOf(account);
    const touched = new Set<string>();
    let added = 0;

    const comments: ApiComment[] = platform === "facebook" ? await this.opts.api.facebookComments(post.externalId, token) : await this.opts.api.instagramComments(post.externalId, token);
    const ownReplies = new Map<string, { at: Date; text: string }>();
    for (const c of comments) {
      if (!c.from) continue; // Meta did not say who wrote it
      if (c.from.externalId === account.externalId || (!!account.username && c.from.username === account.username)) {
        // The account's own reply: the comment it answers counts as replied.
        if (c.parentExternalId) {
          const prev = ownReplies.get(c.parentExternalId);
          if (!prev || prev.at > c.occurredAt) ownReplies.set(c.parentExternalId, { at: c.occurredAt, text: c.text });
        }
        continue;
      }
      const person = await this.person(account, platform, c.from, c.occurredAt);
      touched.add(person.id);
      const lead = looksLikeLead(c.text);
      const found = await this.db.socialEngagement.findFirst({ where: { accountId: account.id, kind: "comment", externalId: c.externalId } });
      if (found) {
        if (found.text !== c.text || found.removedAt) await this.db.socialEngagement.update({ where: { id: found.id }, data: { text: c.text, leadSignal: lead, removedAt: null } });
      } else {
        await this.db.socialEngagement.create({
          data: {
            ownerId: account.ownerId,
            accountId: account.id,
            postId: post.id,
            personId: person.id,
            platform,
            kind: "comment",
            externalId: c.externalId,
            text: c.text,
            parentExternalId: c.parentExternalId,
            permalink: c.permalink ?? post.permalink,
            leadSignal: lead,
            occurredAt: c.occurredAt,
          },
        });
        added++;
      }
    }
    for (const [commentId, reply] of ownReplies) {
      await this.db.socialEngagement.updateMany({ where: { accountId: account.id, kind: "comment", externalId: commentId, repliedAt: null }, data: { repliedAt: reply.at, replyText: reply.text } });
    }

    if (platform === "facebook") {
      const reactions = await this.opts.api.facebookReactions(post.externalId, token);
      const seen = new Set<string>();
      for (const r of reactions.items) {
        const externalId = `reaction:${post.externalId}:${r.person.externalId}`;
        seen.add(externalId);
        const found = await this.db.socialEngagement.findFirst({ where: { accountId: account.id, kind: "reaction", externalId } });
        if (found) {
          if (found.reactionType !== r.type) await this.db.socialEngagement.update({ where: { id: found.id }, data: { reactionType: r.type } });
          continue;
        }
        const person = await this.person(account, platform, r.person, null);
        touched.add(person.id);
        await this.db.socialEngagement.create({
          data: {
            ownerId: account.ownerId,
            accountId: account.id,
            postId: post.id,
            personId: person.id,
            platform,
            kind: "reaction",
            externalId,
            reactionType: r.type,
            permalink: post.permalink,
            // Meta does not say when someone reacted: the time it was first seen here.
            occurredAt: this.now(),
          },
        });
        added++;
      }
      if (reactions.complete) {
        // Reactions taken back since the last read.
        const gone = await this.db.socialEngagement.findMany({ where: { postId: post.id, kind: "reaction", externalId: { notIn: [...seen] } } });
        if (gone.length) {
          await this.db.socialEngagement.deleteMany({ where: { id: { in: gone.map((g) => g.id) } } });
          gone.forEach((g) => touched.add(g.personId));
        }
      }

      for (const s of await this.opts.api.facebookShares(post.externalId, token)) {
        if (s.person.externalId === account.externalId) continue;
        const found = await this.db.socialEngagement.findFirst({ where: { accountId: account.id, kind: "share", externalId: s.externalId } });
        if (found) continue;
        const person = await this.person(account, platform, s.person, s.occurredAt);
        touched.add(person.id);
        await this.db.socialEngagement.create({
          data: {
            ownerId: account.ownerId,
            accountId: account.id,
            postId: post.id,
            personId: person.id,
            platform,
            kind: "share",
            externalId: s.externalId,
            text: s.text,
            permalink: s.permalink,
            occurredAt: s.occurredAt,
          },
        });
        added++;
      }
    }

    for (const id of touched) await this.recount(id);
    await this.db.socialPost.update({ where: { id: post.id }, data: { lastSyncedAt: this.now() } });
    if (added > 0) this.opts.bus?.publish({ type: "engagement.updated", accountId: account.id });
    return added;
  }

  private async person(account: SocialAccount, platform: EngagementPlatform, p: ApiPerson, at: Date | null): Promise<SocialPerson> {
    const found = await this.db.socialPerson.findFirst({ where: { ownerId: account.ownerId, platform, externalId: p.externalId } });
    if (found) {
      const changes: Partial<SocialPerson> = {};
      if (p.name && p.name !== found.name && !/^(Facebook|Instagram) user$/.test(p.name)) changes.name = p.name;
      if (p.username && p.username !== found.username) changes.username = p.username;
      if (p.pictureUrl && p.pictureUrl !== found.pictureUrl) changes.pictureUrl = p.pictureUrl;
      if (p.profileUrl && p.profileUrl !== found.profileUrl) changes.profileUrl = p.profileUrl;
      return Object.keys(changes).length ? this.db.socialPerson.update({ where: { id: found.id }, data: changes }) : found;
    }
    const when = at ?? this.now();
    return this.db.socialPerson.create({
      data: {
        ownerId: account.ownerId,
        platform,
        externalId: p.externalId,
        name: p.name,
        username: p.username,
        profileUrl: p.profileUrl,
        pictureUrl: p.pictureUrl,
        firstSeenAt: when,
        lastSeenAt: when,
      },
    });
  }

  /** Counts, lead signal, last comment and first/last seen from the person's rows. */
  private async recount(personId: string) {
    const rows = await this.db.socialEngagement.findMany({ where: { personId, removedAt: null }, orderBy: { occurredAt: "asc" } });
    const comments = rows.filter((r) => r.kind === "comment");
    await this.db.socialPerson.update({
      where: { id: personId },
      data: {
        comments: comments.length,
        reactions: rows.filter((r) => r.kind === "reaction").length,
        shares: rows.filter((r) => r.kind === "share").length,
        leadSignal: comments.some((c) => c.leadSignal),
        lastComment: comments.at(-1)?.text?.slice(0, 500) ?? null,
        ...(rows.length ? { firstSeenAt: rows[0]!.occurredAt, lastSeenAt: rows.at(-1)!.occurredAt } : {}),
      },
    });
  }

  // ---- Webhooks ----

  /** For the Meta app's Webhooks page (super admins). */
  setup() {
    const base = this.opts.publicBaseUrl?.replace(/\/+$/, "") ?? null;
    return {
      metaConfigured: !!this.opts.meta(),
      callbackUrl: base ? `${base}/api/webhooks/meta/social` : null,
      verifyToken: this.opts.verifyToken,
      fields: { page: ["feed", "messages"], instagram: ["comments", "messages"] },
    };
  }

  verifySubscription(query: Record<string, string | undefined>): string | null {
    if (query["hub.mode"] !== "subscribe" || !query["hub.challenge"] || !query["hub.verify_token"]) return null;
    return safeEqual(query["hub.verify_token"], this.opts.verifyToken) ? query["hub.challenge"] : null;
  }

  /** A signed webhook from Meta. Returns false when the signature is wrong. */
  async handleWebhook(rawBody: string, signature: string | undefined): Promise<boolean> {
    const secret = this.opts.meta()?.appSecret;
    if (!secret || !signature) return false;
    const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
    if (!safeEqual(signature, expected)) return false;

    type FeedValue = { item?: string; verb?: string; post_id?: string; comment_id?: string; from?: { id?: string } };
    type IgValue = { id?: string; media?: { id?: string } };
    let payload: { object?: string; entry?: { id?: string; changes?: { field?: string; value?: FeedValue & IgValue }[]; messaging?: unknown[] }[] };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return true; // signed but unreadable: nothing to do
    }
    const isInstagram = payload.object === "instagram";
    if (payload.object !== "page" && !isInstagram) return true;

    for (const entry of payload.entry ?? []) {
      if (!entry.id) continue;
      // One Page can be connected by several users: each gets the update.
      const accounts = await this.db.socialAccount.findMany({ where: { platform: isInstagram ? "instagram" : "facebook_page", externalId: entry.id } });
      // Messenger / Instagram messages: the AI Inbox reads the chat right away.
      if (Array.isArray(entry.messaging) && entry.messaging.length && accounts.length) this.opts.onMessages?.(accounts.map((a) => a.id));
      for (const change of entry.changes ?? []) {
        const v = change.value;
        if (!v) continue;
        for (const account of accounts) {
          const scope: OwnerScope | null = account.ownerId ? { userId: account.ownerId, ownerId: account.ownerId, customer: true } : null;
          const run = () => (isInstagram ? this.onInstagram(account, change.field, v) : this.onFeed(account, change.field, v));
          await (scope ? ownerScope.run(scope, run) : run());
        }
      }
    }
    return true;
  }

  private async onFeed(account: SocialAccount, field: string | undefined, v: { item?: string; verb?: string; post_id?: string; comment_id?: string; from?: { id?: string } }) {
    if (field !== "feed" || !v.post_id) return;
    if (!["comment", "reaction", "share", "status", "post", "photo", "video"].includes(v.item ?? "")) return;
    if (v.verb === "remove" && v.item === "comment" && v.comment_id) {
      const rows = await this.db.socialEngagement.findMany({ where: { accountId: account.id, kind: "comment", externalId: v.comment_id } });
      for (const r of rows) {
        await this.db.socialEngagement.update({ where: { id: r.id }, data: { removedAt: this.now() } });
        await this.recount(r.personId);
      }
      return;
    }
    if (v.verb === "remove" && v.item === "reaction" && v.from?.id) {
      const rows = await this.db.socialEngagement.findMany({ where: { accountId: account.id, kind: "reaction", externalId: `reaction:${v.post_id}:${v.from.id}` } });
      for (const r of rows) {
        await this.db.socialEngagement.delete({ where: { id: r.id } });
        await this.recount(r.personId);
      }
      return;
    }
    this.later(account, v.post_id);
  }

  private async onInstagram(account: SocialAccount, field: string | undefined, v: { id?: string; media?: { id?: string } }) {
    if ((field === "comments" || field === "live_comments") && v.media?.id) this.later(account, v.media.id);
  }

  /** Reads one post again a few seconds from now (several webhooks for it → one read). */
  private later(account: SocialAccount, postExternalId: string) {
    const key = `${account.id}|${postExternalId}`;
    if (this.pending.has(key)) return;
    const scope = ownerScope.getStore();
    const run = async () => {
      this.pending.delete(key);
      const work = (async () => {
        const fresh = await this.db.socialAccount.findUnique({ where: { id: account.id } });
        if (!fresh || !this.opts.meta()) return;
        const token = await this.token(fresh);
        let post = await this.db.socialPost.findFirst({ where: { accountId: fresh.id, externalId: postExternalId } });
        if (!post) {
          // A new post (or one older than what was read): the latest posts include it.
          await this.syncAccountInner(fresh);
          post = await this.db.socialPost.findFirst({ where: { accountId: fresh.id, externalId: postExternalId } });
          return;
        }
        await this.syncPost(fresh, post, token);
      })().catch((err) => this.opts.log?.(`Social engagement: ${account.name}: ${err instanceof Error ? err.message : String(err)}`));
      this.running.add(work);
      await work.finally(() => this.running.delete(work));
    };
    const wrapped = () => (scope ? ownerScope.run(scope, run) : run());
    const timer = setTimeout(() => void wrapped(), this.opts.webhookDelayMs ?? WEBHOOK_DELAY_MS);
    this.pending.set(key, { timer, run: wrapped });
  }

  /** Runs the waiting webhook reads now (tests, shutdown). */
  async flushPending() {
    const waiting = [...this.pending.values()];
    for (const p of waiting) clearTimeout(p.timer);
    await Promise.all(waiting.map((p) => p.run()));
    await Promise.allSettled([...this.running]);
  }

  // ---- Reading ----

  async summary() {
    const since = new Date(this.now().getTime() - 24 * 60 * 60 * 1000);
    const [people, leads, comments, reactions, shares, today, unreplied] = await Promise.all([
      this.db.socialPerson.count(),
      this.db.socialPerson.count({ where: { OR: [{ leadSignal: true }, { status: "lead" }], NOT: { status: "ignore" } } }),
      this.db.socialEngagement.count({ where: { kind: "comment", removedAt: null } }),
      this.db.socialEngagement.count({ where: { kind: "reaction" } }),
      this.db.socialEngagement.count({ where: { kind: "share" } }),
      this.db.socialEngagement.count({ where: { occurredAt: { gte: since }, removedAt: null } }),
      this.db.socialEngagement.count({ where: { kind: "comment", repliedAt: null, removedAt: null, parentExternalId: null } }),
    ]);
    return { people, leads, comments, reactions, shares, today, unreplied };
  }

  private async attach(rows: SocialEngagement[]) {
    const [people, posts] = await Promise.all([
      this.db.socialPerson.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.personId))] } } }),
      this.db.socialPost.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.postId))] } } }),
    ]);
    const p = new Map(people.map((x) => [x.id, x]));
    const q = new Map(posts.map((x) => [x.id, x]));
    return rows.map((r) => {
      const person = p.get(r.personId);
      const post = q.get(r.postId);
      return {
        ...r,
        person: person ? { id: person.id, name: person.name, username: person.username, profileUrl: person.profileUrl, pictureUrl: person.pictureUrl, status: person.status } : null,
        post: post ? { id: post.id, message: post.message?.slice(0, 200) ?? null, permalink: post.permalink, imageUrl: post.imageUrl } : null,
      };
    });
  }

  async activity(f: { platform?: EngagementPlatform; kind?: string; accountId?: string; postId?: string; leadOnly?: boolean; unreplied?: boolean; q?: string; skip: number; take: number }) {
    const where = {
      removedAt: null,
      ...(f.platform ? { platform: f.platform } : {}),
      ...(f.kind ? { kind: f.kind } : {}),
      ...(f.accountId ? { accountId: f.accountId } : {}),
      ...(f.postId ? { postId: f.postId } : {}),
      ...(f.leadOnly ? { leadSignal: true } : {}),
      ...(f.unreplied ? { kind: "comment", repliedAt: null, parentExternalId: null } : {}),
      ...(f.q ? { text: containsInsensitive(f.q) } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.socialEngagement.findMany({ where, orderBy: { occurredAt: "desc" }, skip: f.skip, take: f.take }),
      this.db.socialEngagement.count({ where }),
    ]);
    return { items: await this.attach(rows), total };
  }

  async posts(f: { platform?: EngagementPlatform; accountId?: string; skip: number; take: number }) {
    const where = { ...(f.platform ? { platform: f.platform } : {}), ...(f.accountId ? { accountId: f.accountId } : {}) };
    const [rows, total] = await Promise.all([this.db.socialPost.findMany({ where, orderBy: { postedAt: "desc" }, skip: f.skip, take: f.take }), this.db.socialPost.count({ where })]);
    const counts = await this.db.socialEngagement.groupBy({ by: ["postId", "kind"], where: { postId: { in: rows.map((r) => r.id) }, removedAt: null }, _count: { _all: true } });
    const people = await this.db.socialEngagement.groupBy({ by: ["postId", "personId"], where: { postId: { in: rows.map((r) => r.id) }, removedAt: null } });
    return {
      total,
      items: rows.map((r) => {
        const of = (kind: string) => counts.find((c) => c.postId === r.id && c.kind === kind)?._count._all ?? 0;
        return { ...r, saved: { comments: of("comment"), reactions: of("reaction"), shares: of("share"), people: people.filter((x) => x.postId === r.id).length } };
      }),
    };
  }

  async people(f: { platform?: EngagementPlatform; status?: string; leadOnly?: boolean; q?: string; sort?: "recent" | "active"; skip: number; take: number }) {
    const where = {
      ...(f.platform ? { platform: f.platform } : {}),
      ...(f.status ? { status: f.status } : {}),
      ...(f.leadOnly ? { leadSignal: true } : {}),
      ...(f.q ? { OR: [{ name: containsInsensitive(f.q) }, { username: containsInsensitive(f.q) }, { lastComment: containsInsensitive(f.q) }] } : {}),
    };
    const orderBy = f.sort === "active" ? [{ comments: "desc" as const }, { reactions: "desc" as const }, { lastSeenAt: "desc" as const }] : [{ lastSeenAt: "desc" as const }];
    const [items, total] = await Promise.all([this.db.socialPerson.findMany({ where, orderBy, skip: f.skip, take: f.take }), this.db.socialPerson.count({ where })]);
    return { items, total };
  }

  async personDetail(id: string) {
    const person = await this.db.socialPerson.findUnique({ where: { id } });
    if (!person) throw Errors.notFound("Person not found");
    const rows = await this.db.socialEngagement.findMany({ where: { personId: id }, orderBy: { occurredAt: "desc" }, take: 200 });
    return { person, history: await this.attach(rows) };
  }

  async updatePerson(id: string, patch: { status?: string; notes?: string | null }) {
    const person = await this.db.socialPerson.findUnique({ where: { id } });
    if (!person) throw Errors.notFound("Person not found");
    return this.db.socialPerson.update({ where: { id }, data: patch });
  }

  /** Forgets a person and everything saved about them (a privacy request). */
  async removePerson(id: string) {
    const person = await this.db.socialPerson.findUnique({ where: { id } });
    if (!person) throw Errors.notFound("Person not found");
    await this.db.socialEngagement.deleteMany({ where: { personId: id } });
    await this.db.socialPerson.delete({ where: { id } });
  }

  /** Instagram people go to Contacts (Instagram Outreach can then message them). */
  async addToContacts(id: string) {
    const person = await this.db.socialPerson.findUnique({ where: { id } });
    if (!person) throw Errors.notFound("Person not found");
    if (person.platform !== "instagram" || !person.username) throw Errors.badRequest("Only Instagram people (with a username) can be added to Contacts");
    const instagramUrl = `https://www.instagram.com/${person.username.toLowerCase()}/`;
    const existing = await this.db.outreachContact.findFirst({ where: { ownerId: person.ownerId, instagramUrl } });
    const contact =
      existing ??
      (await this.db.outreachContact.create({ data: { ownerId: person.ownerId, name: person.name, instagramUrl, listName: "Social Engagement", source: "admin" } }));
    return this.db.socialPerson.update({ where: { id }, data: { contactId: contact.id, status: person.status === "new" ? "lead" : person.status } });
  }

  // ---- Reply ----

  async reply(engagementId: string, text: string) {
    const e = await this.db.socialEngagement.findUnique({ where: { id: engagementId } });
    if (!e || e.kind !== "comment") throw Errors.notFound("Comment not found");
    if (e.removedAt) throw Errors.badRequest("This comment was removed");
    const account = await this.db.socialAccount.findUnique({ where: { id: e.accountId } });
    if (!account) throw Errors.badRequest("The account of this comment is no longer connected");
    if (!this.opts.meta()) throw Errors.badRequest("Facebook login is not set up");
    const token = await this.token(account);
    try {
      if (e.platform === "instagram") await this.opts.api.replyInstagram(e.externalId, token, text);
      else await this.opts.api.replyFacebook(e.externalId, token, text);
    } catch (err) {
      if (err instanceof EngagementApiError) throw Errors.badRequest(err.message);
      throw err;
    }
    const updated = await this.db.socialEngagement.update({ where: { id: e.id }, data: { repliedAt: this.now(), replyText: text } });
    this.opts.bus?.publish({ type: "engagement.updated", accountId: account.id });
    return updated;
  }

  /**
   * One private message to the person who wrote the comment (Messenger for a Page comment,
   * Instagram Direct for an Instagram comment). Meta allows one per comment, within 7 days; the
   * chat then continues in the AI Inbox / All messages when they answer.
   */
  async privateReply(engagementId: string, text: string) {
    const e = await this.db.socialEngagement.findUnique({ where: { id: engagementId } });
    if (!e || e.kind !== "comment") throw Errors.notFound("Comment not found");
    if (e.removedAt) throw Errors.badRequest("This comment was removed");
    if (e.privateReplyAt) throw Errors.conflict("ALREADY_SENT", "A private message was already sent for this comment (Meta allows one)");
    if (this.now().getTime() - e.occurredAt.getTime() > 7 * 24 * 60 * 60 * 1000) throw Errors.badRequest("Meta allows a private message only within 7 days of the comment");
    const account = await this.db.socialAccount.findUnique({ where: { id: e.accountId } });
    if (!account) throw Errors.badRequest("The account of this comment is no longer connected");
    if (!this.opts.meta()) throw Errors.badRequest("Facebook login is not set up");
    const pageId = account.platform === "instagram" ? readMeta(account).pageId : account.externalId;
    if (!pageId) throw Errors.badRequest("This Instagram account has no linked Facebook Page; connect it again");
    const token = await this.token(account);
    try {
      await this.opts.api.privateReply(pageId, token, e.externalId, text);
    } catch (err) {
      if (err instanceof EngagementApiError) throw Errors.badRequest(err.message);
      throw err;
    }
    const updated = await this.db.socialEngagement.update({ where: { id: e.id }, data: { privateReplyAt: this.now(), privateReplyText: text } });
    this.opts.bus?.publish({ type: "engagement.updated", accountId: account.id });
    return updated;
  }

  // ---- Export ----

  async exportPeople(write: (chunk: string) => Promise<void> | void, f: { platform?: EngagementPlatform; status?: string; leadOnly?: boolean }) {
    await write(UTF8_BOM + csvRow(["Platform", "Name", "Username", "Profile", "Platform ID", "Comments", "Reactions", "Shares", "Looks like a lead", "Status", "Last comment", "First seen", "Last seen", "Notes"]));
    let cursor: string | undefined;
    for (;;) {
      const rows = await this.db.socialPerson.findMany({
        where: { ...(f.platform ? { platform: f.platform } : {}), ...(f.status ? { status: f.status } : {}), ...(f.leadOnly ? { leadSignal: true } : {}) },
        orderBy: { id: "asc" },
        take: 500,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!rows.length) break;
      let chunk = "";
      for (const p of rows) {
        chunk += csvRow([
          p.platform,
          p.name,
          p.username,
          p.profileUrl,
          p.externalId,
          p.comments,
          p.reactions,
          p.shares,
          p.leadSignal ? "yes" : "",
          p.status,
          p.lastComment,
          p.firstSeenAt.toISOString(),
          p.lastSeenAt.toISOString(),
          p.notes,
        ]);
      }
      await write(chunk);
      cursor = rows.at(-1)!.id;
    }
  }
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The verify token for the Meta Webhooks page, derived from SESSION_SECRET (stable, not stored). */
export function engagementVerifyToken(sessionSecret: string) {
  return createHmac("sha256", sessionSecret).update("social-engagement-webhook").digest("base64url").slice(0, 32);
}

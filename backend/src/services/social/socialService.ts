// Connects Facebook Pages, Instagram professional accounts and LinkedIn profiles with the
// platforms' own login (OAuth 2.0). The user types their password only on facebook.com /
// linkedin.com; this backend receives an access token, stores it encrypted and never shows it.
//
// Meta: one login returns every Facebook Page the user manages, and the Instagram Business /
// Creator account linked to each Page. Page tokens obtained from a long-lived user token do not
// expire (until the password changes or the app is removed).
// LinkedIn: the member's own profile ("Sign In with LinkedIn using OpenID Connect").

import { ownerScope } from "../../database/ownerScope.js";
import { randomBytes } from "node:crypto";
import type { Repositories, SocialAccountRecord, SocialPlatform } from "../../database/repositories/index.js";
import type { SocialConfig } from "../../providers/social/config.js";
import { Errors } from "../../utils/errors.js";
import type { SecretBox } from "../../utils/secretBox.js";

export type OAuthProvider = "meta" | "linkedin";

const STATE_TTL_MS = 10 * 60_000;
const MAX_PENDING_STATES = 50;

export interface PublicSocialAccount {
  id: string;
  platform: SocialPlatform;
  externalId: string;
  name: string;
  username: string | null;
  pictureUrl: string | null;
  tokenExpiresAt: Date | null;
  scopes: string[];
  status: string;
  lastError: string | null;
  linkedPageId: string | null;
  lastCheckedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class OAuthError extends Error {}

interface GraphPage {
  id: string;
  name: string;
  access_token?: string;
  picture?: { data?: { url?: string } };
  instagram_business_account?: { id: string; username?: string; name?: string; profile_picture_url?: string };
}

export class SocialService {
  /** state → who started it, for which provider, until when. In memory: a restart cancels pending logins. */
  private readonly states = new Map<string, { provider: OAuthProvider; adminId: string; expiresAt: number }>();

  constructor(
    private readonly repos: Repositories,
    private readonly config: SocialConfig,
    private readonly box: SecretBox,
    private readonly opts: { fetch?: typeof fetch; now?: () => number } = {},
  ) {}

  private get fetch() {
    return this.opts.fetch ?? fetch;
  }
  private now() {
    return this.opts.now?.() ?? Date.now();
  }

  redirectUri(provider: OAuthProvider) {
    return `${this.config.redirectBaseUrl}/api/oauth/callback/${provider}`;
  }

  /** What the admin panel shows: which apps are set up, and what to register on each platform. */
  providers() {
    return {
      meta: { configured: !!this.config.meta, redirectUri: this.redirectUri("meta"), scopes: this.config.meta?.scopes ?? [], graphVersion: this.config.meta?.graphVersion ?? null },
      linkedin: { configured: !!this.config.linkedin, redirectUri: this.redirectUri("linkedin"), scopes: this.config.linkedin?.scopes ?? [] },
    };
  }

  async list(): Promise<PublicSocialAccount[]> {
    const rows = await this.repos.socialAccounts.list();
    const now = this.now();
    return rows.map((r) => this.toPublic(r, now));
  }

  private toPublic(r: SocialAccountRecord, now: number): PublicSocialAccount {
    let meta: { pageId?: string } = {};
    try {
      meta = JSON.parse(r.meta);
    } catch {
      /* ignore */
    }
    let scopes: string[] = [];
    try {
      scopes = JSON.parse(r.scopes);
    } catch {
      /* ignore */
    }
    const expired = r.tokenExpiresAt !== null && r.tokenExpiresAt.getTime() <= now;
    return {
      id: r.id,
      platform: r.platform as SocialPlatform,
      externalId: r.externalId,
      name: r.name,
      username: r.username,
      pictureUrl: r.pictureUrl,
      tokenExpiresAt: r.tokenExpiresAt,
      scopes,
      status: expired ? "expired" : r.status,
      lastError: expired ? "The login expired. Connect again." : r.lastError,
      linkedPageId: meta.pageId ?? null,
      lastCheckedAt: r.lastCheckedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  /** Starts a login: returns the platform's authorization page to send the browser to. */
  start(provider: OAuthProvider, adminId: string): string {
    const now = this.now();
    for (const [key, s] of this.states) if (s.expiresAt <= now) this.states.delete(key);
    if (this.states.size >= MAX_PENDING_STATES) throw Errors.conflict("TOO_MANY_LOGINS", "Too many logins in progress; try again in a few minutes");
    const state = randomBytes(32).toString("base64url");

    if (provider === "meta") {
      const meta = this.config.meta;
      if (!meta) throw Errors.badRequest("Facebook login is not set up: add META_APP_ID and META_APP_SECRET to backend/.env");
      this.states.set(state, { provider, adminId, expiresAt: now + STATE_TTL_MS });
      const url = new URL(`https://www.facebook.com/${meta.graphVersion}/dialog/oauth`);
      url.search = new URLSearchParams({ client_id: meta.appId, redirect_uri: this.redirectUri("meta"), state, response_type: "code", scope: meta.scopes.join(",") }).toString();
      return url.toString();
    }
    const li = this.config.linkedin;
    if (!li) throw Errors.badRequest("LinkedIn login is not set up: add LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET to backend/.env");
    this.states.set(state, { provider, adminId, expiresAt: now + STATE_TTL_MS });
    const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
    url.search = new URLSearchParams({ response_type: "code", client_id: li.clientId, redirect_uri: this.redirectUri("linkedin"), state, scope: li.scopes.join(" ") }).toString();
    return url.toString();
  }

  /** The platform redirected back. Returns how many accounts were connected. */
  async callback(provider: OAuthProvider, query: { code?: string; state?: string; error?: string; error_description?: string; error_reason?: string }) {
    const pending = query.state ? this.states.get(query.state) : undefined;
    if (query.state) this.states.delete(query.state); // single use
    if (!pending || pending.provider !== provider || pending.expiresAt <= this.now()) {
      throw new OAuthError("This login link is invalid or expired. Start again from the admin panel.");
    }
    if (query.error) {
      const denied = query.error === "access_denied" || query.error_reason === "user_denied" || query.error === "user_cancelled_login";
      throw new OAuthError(denied ? "The login was cancelled." : `${provider === "meta" ? "Facebook" : "LinkedIn"} refused: ${query.error_description ?? query.error}`);
    }
    if (!query.code) throw new OAuthError("No authorization code came back.");

    // The redirect carries no login: the accounts belong to whoever started the connection.
    const code = query.code;
    const accounts = await ownerScope.run({ userId: pending.adminId, ownerId: pending.adminId, customer: true }, () =>
      provider === "meta" ? this.connectMeta(code, pending.adminId) : this.connectLinkedIn(code, pending.adminId),
    );
    await this.repos.agentLogs.create({
      jobId: null,
      action: "social_connected",
      status: "success",
      message: accounts.map((a) => `${label(a.platform)}: ${a.name}`).join(", "),
    });
    return accounts;
  }

  // ---- Meta (Facebook Pages + Instagram) ----

  private async graph<T>(path: string, params: Record<string, string>): Promise<T> {
    const meta = this.config.meta!;
    const url = new URL(`https://graph.facebook.com/${meta.graphVersion}/${path.replace(/^\//, "")}`);
    url.search = new URLSearchParams(params).toString();
    let res: Response;
    try {
      res = await this.fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new OAuthError("Could not reach Facebook. Check the internet connection and try again.");
    }
    const body = (await res.json().catch(() => null)) as (T & { error?: { message?: string; code?: number } }) | null;
    if (!res.ok || !body || body.error) throw new OAuthError(`Facebook: ${body?.error?.message ?? `HTTP ${res.status}`}`);
    return body;
  }

  private async connectMeta(code: string, adminId: string) {
    const meta = this.config.meta!;
    const short = await this.graph<{ access_token: string }>("oauth/access_token", {
      client_id: meta.appId,
      client_secret: meta.appSecret,
      redirect_uri: this.redirectUri("meta"),
      code,
    });
    // Long-lived user token (about 60 days); Page tokens taken from it do not expire.
    const long = await this.graph<{ access_token: string }>("oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: meta.appId,
      client_secret: meta.appSecret,
      fb_exchange_token: short.access_token,
    });
    const granted = await this.graph<{ data: { permission: string; status: string }[] }>("me/permissions", { access_token: long.access_token });
    const scopes = granted.data.filter((p) => p.status === "granted").map((p) => p.permission);

    const pages: GraphPage[] = [];
    let after: string | undefined;
    for (let i = 0; i < 10; i++) {
      const page = await this.graph<{ data: GraphPage[]; paging?: { cursors?: { after?: string }; next?: string } }>("me/accounts", {
        access_token: long.access_token,
        fields: "id,name,access_token,picture{url},instagram_business_account{id,username,name,profile_picture_url}",
        limit: "100",
        ...(after ? { after } : {}),
      });
      pages.push(...page.data);
      after = page.paging?.next ? page.paging.cursors?.after : undefined;
      if (!after) break;
    }
    const usable = pages.filter((p) => p.access_token);
    if (usable.length === 0) {
      throw new OAuthError(
        "No Facebook Pages came back. Pick at least one Page in the Facebook dialog (Instagram must be a Business or Creator account linked to a Page), or check that you are an admin of the Page.",
      );
    }

    const saved: SocialAccountRecord[] = [];
    for (const p of usable) {
      saved.push(
        await this.repos.socialAccounts.upsert({
          platform: "facebook_page",
          externalId: p.id,
          name: p.name,
          username: null,
          pictureUrl: p.picture?.data?.url ?? null,
          tokenEnc: this.box.seal(p.access_token!),
          tokenExpiresAt: null,
          scopes: JSON.stringify(scopes.filter((s) => !s.startsWith("instagram_"))),
          meta: "{}",
          connectedById: adminId,
        }),
      );
      const ig = p.instagram_business_account;
      if (ig) {
        saved.push(
          await this.repos.socialAccounts.upsert({
            platform: "instagram",
            externalId: ig.id,
            name: ig.name || ig.username || "Instagram account",
            username: ig.username ?? null,
            pictureUrl: ig.profile_picture_url ?? null,
            // The Instagram Graph API is used with the linked Page's token.
            tokenEnc: this.box.seal(p.access_token!),
            tokenExpiresAt: null,
            scopes: JSON.stringify(scopes.filter((s) => s.startsWith("instagram_") || s === "pages_show_list" || s === "business_management")),
            meta: JSON.stringify({ pageId: p.id, pageName: p.name }),
            connectedById: adminId,
          }),
        );
      }
    }
    return saved;
  }

  // ---- LinkedIn ----

  private async connectLinkedIn(code: string, adminId: string) {
    const li = this.config.linkedin!;
    let tokenRes: Response;
    try {
      tokenRes = await this.fetch("https://www.linkedin.com/oauth/v2/accessToken", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: this.redirectUri("linkedin"), client_id: li.clientId, client_secret: li.clientSecret }).toString(),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new OAuthError("Could not reach LinkedIn. Check the internet connection and try again.");
    }
    const token = (await tokenRes.json().catch(() => null)) as { access_token?: string; expires_in?: number; scope?: string; error_description?: string; error?: string } | null;
    if (!tokenRes.ok || !token?.access_token) throw new OAuthError(`LinkedIn: ${token?.error_description ?? token?.error ?? `HTTP ${tokenRes.status}`}`);

    const user = await this.linkedinUserinfo(token.access_token);
    const saved = await this.repos.socialAccounts.upsert({
      platform: "linkedin",
      externalId: user.sub,
      name: user.name ?? ([user.given_name, user.family_name].filter(Boolean).join(" ") || "LinkedIn member"),
      username: user.email ?? null,
      pictureUrl: user.picture ?? null,
      tokenEnc: this.box.seal(token.access_token),
      tokenExpiresAt: token.expires_in ? new Date(this.now() + token.expires_in * 1000) : null,
      scopes: JSON.stringify((token.scope ?? li.scopes.join(" ")).split(/[\s,]+/).filter(Boolean)),
      meta: "{}",
      connectedById: adminId,
    });
    return [saved];
  }

  private async linkedinUserinfo(accessToken: string) {
    let res: Response;
    try {
      res = await this.fetch("https://api.linkedin.com/v2/userinfo", { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new OAuthError("Could not reach LinkedIn. Check the internet connection and try again.");
    }
    const body = (await res.json().catch(() => null)) as { sub?: string; name?: string; given_name?: string; family_name?: string; email?: string; picture?: string; message?: string } | null;
    if (!res.ok || !body?.sub) throw new OAuthError(`LinkedIn: ${body?.message ?? `HTTP ${res.status}`}`);
    return body as { sub: string; name?: string; given_name?: string; family_name?: string; email?: string; picture?: string };
  }

  // ---- Status ----

  /** Calls the platform with the stored token to see whether it still works. */
  async check(id: string): Promise<PublicSocialAccount> {
    const account = await this.repos.socialAccounts.findById(id);
    if (!account) throw Errors.notFound("Account not found");
    let token: string;
    try {
      token = this.box.open(account.tokenEnc);
    } catch {
      await this.repos.socialAccounts.update(id, { status: "error", lastError: "The stored login cannot be read (SESSION_SECRET changed?). Connect again.", lastCheckedAt: new Date(this.now()) });
      return this.toPublic((await this.repos.socialAccounts.findById(id))!, this.now());
    }
    try {
      if (account.platform === "linkedin") {
        if (!this.config.linkedin) throw new OAuthError("LinkedIn login is not set up in backend/.env");
        const user = await this.linkedinUserinfo(token);
        await this.repos.socialAccounts.update(id, { status: "connected", lastError: null, name: user.name ?? account.name, pictureUrl: user.picture ?? account.pictureUrl, lastCheckedAt: new Date(this.now()) });
      } else {
        if (!this.config.meta) throw new OAuthError("Facebook login is not set up in backend/.env");
        const fields = account.platform === "instagram" ? "id,username,name,profile_picture_url" : "id,name,picture{url}";
        const info = await this.graph<{ name?: string; username?: string; profile_picture_url?: string; picture?: { data?: { url?: string } } }>(account.externalId, {
          access_token: token,
          fields,
        });
        await this.repos.socialAccounts.update(id, {
          status: "connected",
          lastError: null,
          name: info.name || info.username || account.name,
          username: info.username ?? account.username,
          pictureUrl: info.profile_picture_url ?? info.picture?.data?.url ?? account.pictureUrl,
          lastCheckedAt: new Date(this.now()),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.repos.socialAccounts.update(id, { status: "error", lastError: message.slice(0, 500), lastCheckedAt: new Date(this.now()) });
    }
    return this.toPublic((await this.repos.socialAccounts.findById(id))!, this.now());
  }

  /** Forgets the token here. (To revoke it on the platform too, remove the app in its settings.) */
  async disconnect(id: string) {
    const account = await this.repos.socialAccounts.findById(id);
    if (!account || !(await this.repos.socialAccounts.delete(id))) throw Errors.notFound("Account not found");
    await this.repos.agentLogs.create({ jobId: null, action: "social_disconnected", status: "info", message: `${label(account.platform)}: ${account.name}` });
  }

  /** For later features (publishing, inbox): the decrypted token of a connected account. */
  async tokenFor(id: string): Promise<{ account: SocialAccountRecord; token: string }> {
    const account = await this.repos.socialAccounts.findById(id);
    if (!account) throw Errors.notFound("Account not found");
    return { account, token: this.box.open(account.tokenEnc) };
  }
}

function label(platform: string) {
  return platform === "facebook_page" ? "Facebook Page" : platform === "instagram" ? "Instagram" : "LinkedIn";
}

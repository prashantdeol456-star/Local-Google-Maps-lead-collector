import { createHash, randomBytes } from "node:crypto";
import { Errors } from "../../utils/errors.js";
import type { AdminUserRecord, ApiTokenRecord, Repositories } from "../../database/repositories/index.js";
import { hashPassword, verifyPassword } from "./password.js";

export interface AuthenticatedAdmin {
  id: string;
  email: string;
  name: string | null;
}

export interface LoginResult {
  token: string;
  expiresAt: Date;
  admin: AuthenticatedAdmin;
}

export interface ApiTokenResult {
  token: string;
  tokenId: string;
  expiresAt: Date | null;
  admin: AuthenticatedAdmin;
}

/** Public view of an API token — never includes the token or its hash. */
export interface ApiTokenInfo {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  /** full | read */
  scope: string;
}

export type ApiTokenScope = "full" | "read";

export interface AuthServiceOptions {
  sessionTtlMs: number;
  apiTokenTtlMs: number | null;
}

/** Bearer tokens are recognisable in logs/leaks by this prefix. */
export const API_TOKEN_PREFIX = "mlp_";

// lastUsedAt is written at most this often per token, not on every request.
const LAST_USED_WRITE_INTERVAL_MS = 60_000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function toAdmin(u: { id: string; email: string; name: string | null }): AuthenticatedAdmin {
  return { id: u.id, email: u.email, name: u.name };
}

function toTokenInfo(t: ApiTokenRecord): ApiTokenInfo {
  return { id: t.id, name: t.name, prefix: t.prefix, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt, expiresAt: t.expiresAt, scope: t.scope };
}

export class AuthService {
  constructor(
    private readonly repos: Repositories,
    private readonly options: AuthServiceOptions,
  ) {}

  /** Creates the first admin from .env if the database has no admins yet. */
  async ensureInitialAdmin(initial: { email: string; password: string } | null): Promise<"created" | "exists" | "skipped"> {
    if ((await this.repos.adminUsers.count()) > 0) return "exists";
    if (!initial) return "skipped";
    await this.repos.adminUsers.create({
      email: initial.email.toLowerCase(),
      name: "Admin",
      passwordHash: await hashPassword(initial.password),
    });
    return "created";
  }

  private async verifyCredentials(email: string, password: string): Promise<AdminUserRecord> {
    const user = await this.repos.adminUsers.findByEmail(email.trim().toLowerCase());
    const ok = await verifyPassword(password, user?.passwordHash ?? null);
    if (!user || !ok) throw Errors.invalidCredentials();
    return user;
  }

  // ---- Browser sessions (admin panel, cookie) ----

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.verifyCredentials(email, password);

    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.options.sessionTtlMs);
    await this.repos.sessions.create({ tokenHash: hashToken(token), userId: user.id, expiresAt });
    await this.repos.adminUsers.touchLastLogin(user.id, now);
    await this.repos.sessions.deleteExpired(now);

    return { token, expiresAt, admin: toAdmin(user) };
  }

  /** Returns the admin for a session token, or null if missing/expired. */
  async authenticate(token: string | undefined): Promise<AuthenticatedAdmin | null> {
    if (!token) return null;
    const session = await this.repos.sessions.findByTokenHash(hashToken(token));
    if (!session) return null;
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.repos.sessions.deleteByTokenHash(session.tokenHash);
      return null;
    }
    const user = await this.repos.adminUsers.findById(session.userId);
    return user ? toAdmin(user) : null;
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) await this.repos.sessions.deleteByTokenHash(hashToken(token));
  }

  // ---- API tokens (Chrome extension, Bearer) ----

  async issueApiToken(email: string, password: string, name: string): Promise<ApiTokenResult> {
    const user = await this.verifyCredentials(email, password);

    const token = API_TOKEN_PREFIX + randomBytes(32).toString("base64url");
    const now = new Date();
    const expiresAt = this.options.apiTokenTtlMs ? new Date(now.getTime() + this.options.apiTokenTtlMs) : null;
    const record = await this.repos.apiTokens.create({
      name,
      prefix: token.slice(0, API_TOKEN_PREFIX.length + 6),
      tokenHash: hashToken(token),
      userId: user.id,
      expiresAt,
    });
    await this.repos.adminUsers.touchLastLogin(user.id, now);

    return { token, tokenId: record.id, expiresAt, admin: toAdmin(user) };
  }

  /**
   * Token for an integration such as n8n, created by a logged-in admin (no password needed
   * again). "read" tokens can only make GET requests. Shown in full only once.
   */
  async createIntegrationToken(userId: string, input: { name: string; scope: ApiTokenScope; expiresInDays: number | null }) {
    const token = API_TOKEN_PREFIX + randomBytes(32).toString("base64url");
    const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null;
    const record = await this.repos.apiTokens.create({
      name: input.name,
      prefix: token.slice(0, API_TOKEN_PREFIX.length + 6),
      tokenHash: hashToken(token),
      userId,
      expiresAt,
      scope: input.scope,
    });
    return { token, info: toTokenInfo(record) };
  }

  /** Returns the admin and token id for a bearer token, or null if unknown/revoked/expired. */
  async authenticateApiToken(token: string | undefined): Promise<{ admin: AuthenticatedAdmin; tokenId: string; scope: string } | null> {
    if (!token?.startsWith(API_TOKEN_PREFIX)) return null;
    const record = await this.repos.apiTokens.findByTokenHash(hashToken(token));
    if (!record || record.revokedAt) return null;
    const now = new Date();
    if (record.expiresAt && record.expiresAt <= now) return null;

    const user = await this.repos.adminUsers.findById(record.userId);
    if (!user) return null;

    if (!record.lastUsedAt || now.getTime() - record.lastUsedAt.getTime() > LAST_USED_WRITE_INTERVAL_MS) {
      await this.repos.apiTokens.touchLastUsed(record.id, now);
    }
    return { admin: toAdmin(user), tokenId: record.id, scope: record.scope };
  }

  async listApiTokens(userId: string): Promise<ApiTokenInfo[]> {
    return (await this.repos.apiTokens.listActiveByUser(userId, new Date())).map(toTokenInfo);
  }

  async revokeApiToken(id: string, userId: string): Promise<void> {
    const revoked = await this.repos.apiTokens.revoke(id, userId, new Date());
    if (!revoked) throw Errors.notFound("Token not found");
  }
}

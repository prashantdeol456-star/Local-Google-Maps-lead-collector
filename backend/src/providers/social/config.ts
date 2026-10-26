import { z } from "zod";

// Apps you create once on developers.facebook.com and linkedin.com/developers. The platforms'
// own login pages ask for your password; this backend only ever receives access tokens.

const empty = (v: unknown) => (v === "" ? undefined : v);
const text = z.preprocess(empty, z.string().trim().optional());

/** Permissions asked from Meta. Publishing, inbox and comments need them (some need App Review for other users). */
export const DEFAULT_META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "pages_manage_metadata",
  "pages_messaging",
  "business_management",
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_comments",
  "instagram_manage_messages",
];

/** "Sign In with LinkedIn using OpenID Connect" + "Share on LinkedIn" products. */
export const DEFAULT_LINKEDIN_SCOPES = ["openid", "profile", "email", "w_member_social"];

const SocialEnv = z.object({
  META_APP_ID: z.preprocess(empty, z.string().trim().regex(/^\d+$/, "must be the numeric App ID").optional()),
  META_APP_SECRET: text,
  META_GRAPH_VERSION: z.preprocess(empty, z.string().regex(/^v\d+\.\d+$/, 'must look like "v26.0"').default("v26.0")),
  META_SCOPES: text,
  LINKEDIN_CLIENT_ID: text,
  LINKEDIN_CLIENT_SECRET: text,
  LINKEDIN_SCOPES: text,
  /** Address the browser uses for this backend; the OAuth redirect URIs are built from it. */
  SOCIAL_REDIRECT_BASE_URL: z.preprocess(empty, z.url().optional()),
});

export interface SocialConfig {
  meta: { appId: string; appSecret: string; graphVersion: string; scopes: string[] } | null;
  linkedin: { clientId: string; clientSecret: string; scopes: string[] } | null;
  /** e.g. http://localhost:3000 (no trailing slash) */
  redirectBaseUrl: string;
}

const list = (v: string | undefined, fallback: string[]) =>
  v
    ? v
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    : fallback;

export function parseSocialConfig(env: Record<string, string | undefined>, fallbackBase: string): SocialConfig {
  const parsed = SocialEnv.safeParse(env);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new Error(`Social login settings: ${issue.path.join(".")} ${issue.message}`);
  }
  const e = parsed.data;
  if (!!e.META_APP_ID !== !!e.META_APP_SECRET) throw new Error("Social login settings: set both META_APP_ID and META_APP_SECRET (or neither)");
  if (!!e.LINKEDIN_CLIENT_ID !== !!e.LINKEDIN_CLIENT_SECRET) {
    throw new Error("Social login settings: set both LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET (or neither)");
  }
  return {
    meta: e.META_APP_ID ? { appId: e.META_APP_ID, appSecret: e.META_APP_SECRET!, graphVersion: e.META_GRAPH_VERSION, scopes: list(e.META_SCOPES, DEFAULT_META_SCOPES) } : null,
    linkedin: e.LINKEDIN_CLIENT_ID
      ? { clientId: e.LINKEDIN_CLIENT_ID, clientSecret: e.LINKEDIN_CLIENT_SECRET!, scopes: list(e.LINKEDIN_SCOPES, DEFAULT_LINKEDIN_SCOPES) }
      : null,
    redirectBaseUrl: (e.SOCIAL_REDIRECT_BASE_URL ?? fallbackBase).replace(/\/+$/, ""),
  };
}

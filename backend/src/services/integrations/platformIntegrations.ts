// Platform-wide integration keys entered by a super admin on the Integrations page: Razorpay
// (online recharge), the Meta app (Facebook / Instagram Connect) and the LinkedIn app. They are
// stored encrypted in IntegrationSetting and take effect immediately; when a provider has
// nothing saved, the .env values are used. Secrets are never sent back to the browser.

import { z } from "zod";
import type { PrismaClient } from "../../database/client.js";
import { DEFAULT_LINKEDIN_SCOPES, DEFAULT_META_SCOPES, type SocialConfig } from "../../providers/social/config.js";
import { Errors } from "../../utils/errors.js";
import type { SecretBox } from "../../utils/secretBox.js";
import { RazorpayClient, razorpayMode, type RazorpayKeys } from "../billing/razorpay.js";

export const PLATFORM_PROVIDERS = ["razorpay", "meta", "linkedin"] as const;
export type PlatformProvider = (typeof PLATFORM_PROVIDERS)[number];

const id = (re: RegExp, msg: string) => z.string().trim().regex(re, msg);
/** Secrets may be left empty on an update to keep the saved one. */
const secret = z.string().trim().max(500).optional().default("");

const Inputs = {
  razorpay: z.object({ keyId: id(/^rzp_(test|live)_[A-Za-z0-9]+$/, "Key ID starts with rzp_test_ or rzp_live_"), keySecret: secret, webhookSecret: secret }),
  meta: z.object({ appId: id(/^\d{5,25}$/, "App ID is a number"), appSecret: secret }),
  linkedin: z.object({ clientId: id(/^[A-Za-z0-9]{6,50}$/, "Client ID: letters and digits"), clientSecret: secret }),
};
type Stored = {
  razorpay: { keyId: string; keySecret: string; webhookSecret: string };
  meta: { appId: string; appSecret: string };
  linkedin: { clientId: string; clientSecret: string };
};
const REQUIRED_SECRETS: Record<PlatformProvider, string[]> = { razorpay: ["keySecret"], meta: ["appSecret"], linkedin: ["clientSecret"] };

export interface PlatformEnv {
  razorpay: RazorpayKeys | null;
  meta: SocialConfig["meta"];
  linkedin: SocialConfig["linkedin"];
  metaGraphVersion: string;
}

export class PlatformIntegrations {
  private stored: Partial<Stored> = {};

  constructor(
    private readonly db: PrismaClient,
    private readonly box: SecretBox,
    /** The social config the services use; updated in place when keys change. */
    private readonly social: SocialConfig,
    private readonly env: PlatformEnv,
    private readonly opts: { publicBaseUrl: string | null; fetch?: typeof fetch },
  ) {}

  /** Reads the saved keys (call once at startup). */
  async load(): Promise<void> {
    this.stored = {};
    for (const row of await this.db.integrationSetting.findMany()) {
      if (!(PLATFORM_PROVIDERS as readonly string[]).includes(row.provider)) continue;
      try {
        (this.stored as Record<string, unknown>)[row.provider] = JSON.parse(this.box.open(row.config));
      } catch {
        // sealed with another SESSION_SECRET: ignore it (the page shows it as not set)
      }
    }
    this.apply();
  }

  private apply() {
    const m = this.stored.meta;
    this.social.meta = m ? { appId: m.appId, appSecret: m.appSecret, graphVersion: this.env.meta?.graphVersion ?? this.env.metaGraphVersion, scopes: this.env.meta?.scopes ?? DEFAULT_META_SCOPES } : this.env.meta;
    const l = this.stored.linkedin;
    this.social.linkedin = l ? { clientId: l.clientId, clientSecret: l.clientSecret, scopes: this.env.linkedin?.scopes ?? DEFAULT_LINKEDIN_SCOPES } : this.env.linkedin;
  }

  razorpay(): RazorpayKeys | null {
    const r = this.stored.razorpay;
    return r ? { keyId: r.keyId, keySecret: r.keySecret, webhookSecret: r.webhookSecret || null } : this.env.razorpay;
  }

  razorpayClient(): RazorpayClient | null {
    const keys = this.razorpay();
    return keys ? new RazorpayClient(keys, this.opts.fetch) : null;
  }

  private url(path: string) {
    return `${this.opts.publicBaseUrl ?? ""}${path}`;
  }

  /** What the Integrations page shows: ids and where each value comes from, never secrets. */
  status() {
    const rz = this.razorpay();
    const source = (p: PlatformProvider, envSet: boolean) => (this.stored[p] ? "panel" : envSet ? "env" : null);
    return {
      razorpay: {
        source: source("razorpay", !!this.env.razorpay),
        keyId: rz?.keyId ?? null,
        mode: rz ? razorpayMode(rz.keyId) : null,
        webhookSecretSet: !!rz?.webhookSecret,
        webhookUrl: this.url("/api/webhooks/razorpay"),
      },
      meta: { source: source("meta", !!this.env.meta), appId: this.social.meta?.appId ?? null, redirectUrl: this.url("/api/oauth/callback/meta") },
      linkedin: { source: source("linkedin", !!this.env.linkedin), clientId: this.social.linkedin?.clientId ?? null, redirectUrl: this.url("/api/oauth/callback/linkedin") },
    };
  }

  async save(provider: PlatformProvider, body: unknown) {
    const parsed = Inputs[provider].safeParse(body);
    if (!parsed.success) throw Errors.badRequest(parsed.error.issues[0]?.message ?? "Invalid settings");
    const previous = (this.stored[provider] ?? {}) as Record<string, string>;
    const next: Record<string, string> = { ...parsed.data };
    // Empty secret = keep the saved one
    for (const [k, v] of Object.entries(next)) if (v === "" && previous[k]) next[k] = previous[k]!;
    const missing = REQUIRED_SECRETS[provider].filter((k) => !next[k]);
    if (missing.length) throw Errors.badRequest(`Enter the ${missing.join(", ")}`);
    await this.db.integrationSetting.upsert({
      where: { provider },
      create: { provider, config: this.box.seal(JSON.stringify(next)) },
      update: { config: this.box.seal(JSON.stringify(next)) },
    });
    (this.stored as Record<string, unknown>)[provider] = next;
    this.apply();
    return this.status();
  }

  async remove(provider: PlatformProvider) {
    await this.db.integrationSetting.deleteMany({ where: { provider } });
    delete this.stored[provider];
    this.apply();
    return this.status();
  }

  /** Checks the Razorpay keys against Razorpay. */
  async testRazorpay() {
    const client = this.razorpayClient();
    if (!client) throw Errors.badRequest("Razorpay is not set up yet");
    await client.test();
    return { ok: true, mode: razorpayMode(this.razorpay()!.keyId) };
  }
}

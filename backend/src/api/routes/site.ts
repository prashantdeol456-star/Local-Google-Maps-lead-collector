import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { SiteService } from "../../services/site/siteService.js";
import {
  aboutPage,
  contactPage,
  FAVICON,
  featuresPage,
  homePage,
  pricingPage,
  privacyPage,
  robots,
  sitemap,
  termsPage,
  type ContactForm,
  type SiteInfo,
} from "../../site/pages.js";
import { SITE_CSS } from "../../site/styles.js";
import { requireSuperAdmin } from "../middleware/auth.js";
import { IdParams, Pagination, parse, toSkipTake } from "../validation.js";

// Public website (before login) and its settings/messages for super admins.

const PAGE_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "default-src 'self'; style-src 'self'; img-src 'self' data:; script-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'",
  "Cache-Control": "public, max-age=300",
};

const ContactBody = z.object({
  name: z.string().trim().min(2, "Please enter your name").max(100),
  email: z.email("Please enter a valid email").max(254),
  phone: z.string().trim().max(20).regex(/^[+\d\s()-]*$/, "Phone: digits only").optional().default(""),
  company: z.string().trim().max(150).optional().default(""),
  message: z.string().trim().min(5, "Please write a short message").max(3000),
  /** honeypot: people leave it empty */
  website: z.string().max(200).optional().default(""),
});

const text = (max: number) => z.string().trim().max(max);
/** Footer "Follow us" links: https only (or empty to hide the icon). */
const SocialUrl = z.url({ protocol: /^https$/ }).max(300).or(z.literal(""));
const SettingsBody = z
  .object({
    brandName: text(80).min(1),
    tagline: text(300),
    contactEmail: z.email().max(254).or(z.literal("")),
    contactPhone: text(30),
    whatsapp: text(30),
    address: text(300),
    linkedinUrl: SocialUrl,
    youtubeUrl: SocialUrl,
    xUrl: SocialUrl,
  })
  .partial();

export async function siteRoutes(app: FastifyInstance, opts: { site: SiteService; publicBaseUrl: string | null; contactRateLimitPerMinute: number }) {
  // The contact form posts as a normal HTML form (works without JavaScript).
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string", bodyLimit: 16 * 1024 }, (_req, body, done) => done(null, body));

  const info = async (): Promise<SiteInfo> => {
    const s = await opts.site.settings();
    return {
      brandName: s.brandName,
      tagline: s.tagline,
      contactEmail: s.contactEmail,
      contactPhone: s.contactPhone,
      whatsapp: s.whatsapp,
      address: s.address,
      linkedinUrl: s.linkedinUrl,
      youtubeUrl: s.youtubeUrl,
      xUrl: s.xUrl,
      baseUrl: opts.publicBaseUrl,
    };
  };
  const html = (reply: FastifyReply, body: string, extra: Record<string, string> = {}) => {
    for (const [k, v] of Object.entries({ ...PAGE_HEADERS, ...extra })) reply.header(k, v);
    return reply.type("text/html; charset=utf-8").send(body);
  };

  app.get("/", async (_req, reply) => html(reply, homePage(await info())));
  app.get("/features", async (_req, reply) => html(reply, featuresPage(await info())));
  app.get("/pricing", async (_req, reply) => html(reply, pricingPage(await info())));
  app.get("/privacy", async (_req, reply) => html(reply, privacyPage(await info())));
  app.get("/terms", async (_req, reply) => html(reply, termsPage(await info())));
  app.get("/about", async (_req, reply) => html(reply, aboutPage(await info())));
  app.get<{ Querystring: { sent?: string } }>("/contact", async (request, reply) =>
    html(reply, contactPage(await info(), { sent: request.query.sent === "1" }), { "Cache-Control": "no-store" }),
  );

  app.post("/contact", { config: { rateLimit: { max: opts.contactRateLimitPerMinute, timeWindow: "1 minute" } } }, async (request, reply) => {
    const raw = Object.fromEntries(new URLSearchParams(typeof request.body === "string" ? request.body : ""));
    const parsed = ContactBody.safeParse(raw);
    const values: Partial<ContactForm> = { name: raw.name, email: raw.email, phone: raw.phone, company: raw.company, message: raw.message };
    if (!parsed.success) {
      reply.code(400);
      return html(reply, contactPage(await info(), { error: parsed.error.issues[0]?.message ?? "Please check the form", values }), { "Cache-Control": "no-store" });
    }
    // Bots fill every field; people never see the honeypot. Pretend it worked.
    if (!parsed.data.website) await opts.site.createMessage(parsed.data);
    return reply.redirect("/contact?sent=1", 303);
  });

  app.get("/site.css", async (_req, reply) => reply.type("text/css; charset=utf-8").header("Cache-Control", "public, max-age=3600").send(SITE_CSS));
  app.get("/favicon.svg", async (_req, reply) => reply.type("image/svg+xml").header("Cache-Control", "public, max-age=86400").send(FAVICON));
  app.get("/robots.txt", async (_req, reply) => reply.type("text/plain; charset=utf-8").send(robots(await info())));
  app.get("/sitemap.xml", async (_req, reply) => reply.type("application/xml; charset=utf-8").send(sitemap(await info())));

  // ---- Super admin: website texts and contact messages ----
  app.get("/api/site/settings", async (request) => {
    requireSuperAdmin(request);
    return { settings: await opts.site.settings() };
  });
  app.put("/api/site/settings", async (request) => {
    requireSuperAdmin(request);
    return { settings: await opts.site.updateSettings(parse(SettingsBody, request.body)) };
  });
  app.get("/api/site/messages", async (request) => {
    requireSuperAdmin(request);
    const query = parse(Pagination.extend({ status: z.enum(["new", "read"]).optional() }), request.query);
    return { ...(await opts.site.messages({ status: query.status, ...toSkipTake(query) })), page: query.page, pageSize: query.pageSize };
  });
  app.post("/api/site/messages/:id/:status", async (request) => {
    requireSuperAdmin(request);
    const { id, status } = parse(IdParams.extend({ status: z.enum(["new", "read"]) }), request.params);
    await opts.site.setStatus(id, status);
    return { ok: true };
  });
  app.delete("/api/site/messages/:id", async (request) => {
    requireSuperAdmin(request);
    await opts.site.deleteMessage(parse(IdParams, request.params).id);
    return { ok: true };
  });
}

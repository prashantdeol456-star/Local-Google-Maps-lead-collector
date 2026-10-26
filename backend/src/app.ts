import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { authRoutes } from "./api/routes/auth.js";
import { healthRoutes } from "./api/routes/health.js";
import { jobRoutes } from "./api/routes/jobs.js";
import { leadRoutes } from "./api/routes/leads.js";
import { adminRoutes, isAdminPageRequest, sendAdminIndex } from "./api/routes/admin.js";
import { eventRoutes } from "./api/routes/events.js";
import { campaignRoutes } from "./api/routes/campaigns.js";
import { emailRoutes } from "./api/routes/email.js";
import { clickRoutes, replyRoutes, trackingWebhookRoutes } from "./api/routes/tracking.js";
import { unsubscribeRoutes } from "./api/routes/unsubscribe.js";
import { whatsappRoutes, whatsappWebhookRoutes } from "./api/routes/whatsapp.js";
import { createWhatsAppProvider, type WhatsAppProvider } from "./providers/whatsapp/index.js";
import { WhatsAppService } from "./services/whatsapp/whatsappService.js";
import { whatsappCampaignRoutes } from "./api/routes/whatsappCampaigns.js";
import { WhatsAppConsentService } from "./services/whatsapp/consent.js";
import { WhatsAppCampaignService } from "./services/whatsapp/whatsappCampaignService.js";
import { WhatsAppTemplateService } from "./services/whatsapp/whatsappTemplateService.js";
import { WhatsAppWorker } from "./jobs/whatsappWorker.js";
import { WhatsAppTrackingService } from "./services/whatsapp/trackingService.js";
import { preferenceRoutes } from "./api/routes/preferences.js";
import { PreferenceService } from "./services/outreach/preferenceService.js";
import { aiRoutes } from "./api/routes/ai.js";
import { createAiNavigator, type AiNavigator } from "./providers/ai/index.js";
import { AiNavigationService } from "./services/ai/navigationService.js";
import { integrationRoutes } from "./api/routes/integrations.js";
import { linkedinRoutes } from "./api/routes/linkedin.js";
import { LinkedInService } from "./services/linkedin/linkedinService.js";
import { contactRoutes } from "./api/routes/contacts.js";
import { linkedinOutreachRoutes } from "./api/routes/linkedinOutreach.js";
import { ContactService } from "./services/contacts/contactService.js";
import { ChannelTemplateService } from "./services/contacts/channelTemplates.js";
import { CampaignLogService } from "./services/outreach/campaignLogService.js";
import { LinkedInOutreachService } from "./services/linkedin/outreachService.js";
import { socialRoutes } from "./api/routes/social.js";
import { SocialService } from "./services/social/socialService.js";
import { WebhookWorker } from "./jobs/webhookWorker.js";
import { MaintenanceWorker } from "./jobs/maintenanceWorker.js";
import { IntegrationService } from "./services/integrations/integrationService.js";
import { SecretBox } from "./utils/secretBox.js";
import { TrackingService } from "./services/email/trackingService.js";
import { EmailWorker } from "./jobs/emailWorker.js";
import { CampaignService } from "./services/email/campaignService.js";
import { TemplateService } from "./services/email/templateService.js";
import { exportRoutes } from "./api/routes/export.js";
import { createEmailProvider, type EmailProvider } from "./providers/email/index.js";
import { EmailService } from "./services/email/emailService.js";
import { ExportService } from "./services/export/exportService.js";
import { statsRoutes } from "./api/routes/stats.js";
import { EventBus } from "./services/events.js";
import { JobService } from "./services/collection/jobService.js";
import { DedupeService } from "./services/lead/dedupeService.js";
import { LeadService } from "./services/lead/leadService.js";
import { StatsService } from "./services/statsService.js";
import { AppError } from "./utils/errors.js";
import { AuthService } from "./services/auth/authService.js";
import { registerAuthGuard } from "./api/middleware/auth.js";
import type { AppConfig } from "./config.js";
import type { PrismaClient } from "./database/client.js";
import { createRepositories } from "./database/repositories/index.js";

export interface AppDeps {
  config: AppConfig;
  db: PrismaClient;
  logger?: boolean;
  /** Override the providers built from config (tests). */
  emailProvider?: EmailProvider;
  whatsappProvider?: WhatsAppProvider;
  /** Override the AI navigator built from config (tests). */
  aiNavigator?: AiNavigator | null;
  /** Fake network for Facebook/LinkedIn OAuth (tests). */
  socialFetch?: typeof fetch;
}

export async function buildApp({ config, db, logger = true, emailProvider, whatsappProvider, aiNavigator, socialFetch }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger
      ? {
          level: config.logLevel,
          // Never write credentials to the logs.
          redact: ["req.headers.authorization", "req.headers.cookie", "req.headers[\"x-lead-platform-token\"]", "res.headers[\"set-cookie\"]"],
        }
      : false,
    // Behind a reverse proxy: real client IPs for rate limits, and https detection.
    // A number means "trust that many proxy hops".
    trustProxy: typeof config.trustProxy === "number" ? (_address: string, hop: number) => hop < (config.trustProxy as number) : config.trustProxy,
  });

  // Basic security headers on every response (the admin panel adds its own CSP).
  app.addHook("onSend", async (request, reply) => {
    if (!reply.hasHeader("X-Content-Type-Options")) reply.header("X-Content-Type-Options", "nosniff");
    if (!reply.hasHeader("Referrer-Policy")) reply.header("Referrer-Policy", "no-referrer");
    if (!reply.hasHeader("X-Frame-Options")) reply.header("X-Frame-Options", "DENY");
    if (config.isProduction && request.protocol === "https") reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  });

  const repos = createRepositories(db);
  const auth = new AuthService(repos, { sessionTtlMs: config.sessionTtlMs, apiTokenTtlMs: config.apiTokenTtlMs });
  const bus = new EventBus();
  const jobs = new JobService(repos, bus);
  const leads = new LeadService(repos, bus);
  const dedupe = new DedupeService(repos, bus);
  const stats = new StatsService(repos, config.timeZone);
  const exporter = new ExportService(repos, config.timeZone);
  const mailer = emailProvider ?? createEmailProvider(config.email);
  const email = new EmailService(mailer, config.email, repos, { publicBaseUrl: config.publicBaseUrl, trackClicks: config.trackClicks });
  const templates = new TemplateService(repos);
  const campaigns = new CampaignService(repos, {
    provider: mailer.name,
    timeZone: config.timeZone,
    publicBaseUrl: config.publicBaseUrl,
    bus,
  });
  const tracking = new TrackingService(repos, bus);
  const waProvider = whatsappProvider ?? createWhatsAppProvider(config.whatsapp);
  const whatsapp = new WhatsAppService(waProvider, config.whatsapp, repos, config.publicBaseUrl);
  const waTemplates = new WhatsAppTemplateService(repos, waProvider.name);
  const waCampaigns = new WhatsAppCampaignService(repos, { provider: waProvider.name, timeZone: config.timeZone, bus });
  const waConsent = new WhatsAppConsentService(repos, bus);
  const preferences = new PreferenceService(repos, bus);
  const linkedin = new LinkedInService(repos);
  const contacts = new ContactService(repos);
  const channelTemplates = new ChannelTemplateService(repos);
  const campaignLogs = new CampaignLogService(repos);
  const linkedinOutreach = new LinkedInOutreachService(repos, { timeZone: config.timeZone, bus });
  const webhookSecrets = new SecretBox(config.sessionSecret, "webhook-secrets");
  const social = new SocialService(repos, config.social, new SecretBox(config.sessionSecret, "social-tokens"), { fetch: socialFetch });
  const integrations = new IntegrationService(repos, webhookSecrets, bus, (msg) => app.log.error(msg));
  integrations.start();
  const webhookWorker = new WebhookWorker(repos, webhookSecrets, { log: (msg) => app.log.error(msg) });
  const maintenance = new MaintenanceWorker(repos, { log: (msg) => app.log.info(msg) });
  const navigation = new AiNavigationService(aiNavigator === undefined ? createAiNavigator(config.ai) : aiNavigator, config.ai, repos);
  const waTracking = new WhatsAppTrackingService(repos, waProvider.name, bus);
  const whatsappWorker = new WhatsAppWorker(repos, waProvider, { bus, log: (msg) => app.log.error(msg) });
  const emailWorker = new EmailWorker(repos, mailer, {
    trackClicks: config.trackClicks,
    baseUrl: config.publicBaseUrl ?? `http://${config.host}:${config.port}`,
    unsubscribeSecret: config.sessionSecret,
    bus,
    log: (msg) => app.log.error(msg),
  });

  // Only allow-listed browser origins get CORS headers; others are blocked by the browser.
  const allowedOrigins = new Set(config.corsOrigins);
  await app.register(cors, {
    origin: (origin, cb) => cb(null, origin !== undefined && allowedOrigins.has(origin)),
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    maxAge: 600,
  });
  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status === 429) {
      return reply.code(429).send({ error: { code: "TOO_MANY_REQUESTS", message: "Too many attempts, try again later" } });
    }
    if (status < 500) {
      return reply.code(status).send({ error: { code: "BAD_REQUEST", message: (error as Error).message } });
    }
    request.log.error(error);
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "Something went wrong" } });
  });

  app.setNotFoundHandler((request, reply) => {
    // Client-side routes of the admin panel (e.g. /admin/leads/abc) are not files.
    if (isAdminPageRequest(request, config.adminDir)) return sendAdminIndex(reply, config.adminDir);
    return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Route not found" } });
  });

  registerAuthGuard(app, auth);
  await app.register(healthRoutes, { db });
  await app.register(authRoutes, {
    auth,
    secureCookies: config.isProduction,
    loginRateLimitPerMinute: config.loginRateLimitPerMinute,
  });
  await app.register(jobRoutes, { jobs });
  await app.register(leadRoutes, { leads, dedupe });
  await app.register(statsRoutes, { stats });
  await app.register(eventRoutes, { bus });
  await app.register(exportRoutes, { exporter, timeZone: config.timeZone });
  await app.register(emailRoutes, { email });
  await app.register(campaignRoutes, { templates, campaigns });
  await app.register(unsubscribeRoutes, { repos, secret: config.sessionSecret, bus, tracking });
  await app.register(trackingWebhookRoutes, { provider: mailer, tracking });
  await app.register(clickRoutes, { tracking });
  await app.register(replyRoutes, { tracking });
  await app.register(whatsappRoutes, { whatsapp });
  await app.register(whatsappCampaignRoutes, { templates: waTemplates, campaigns: waCampaigns, consent: waConsent, repos });
  await app.register(preferenceRoutes, { preferences });
  await app.register(aiRoutes, { navigation });
  await app.register(integrationRoutes, { integrations, worker: webhookWorker });
  await app.register(linkedinRoutes, { linkedin, timeZone: config.timeZone });
  await app.register(contactRoutes, { contacts, channelTemplates, logs: campaignLogs });
  await app.register(linkedinOutreachRoutes, { outreach: linkedinOutreach });
  await app.register(socialRoutes, { social });
  await app.register(whatsappWebhookRoutes, { provider: waProvider, onEvents: (events) => waTracking.handle(events) });
  await app.register(adminRoutes, { adminDir: config.adminDir });

  app.decorate("authService", auth);
  app.decorate("events", bus);
  app.decorate("emailWorker", emailWorker);
  app.decorate("whatsappWorker", whatsappWorker);
  app.decorate("webhookWorker", webhookWorker);
  app.decorate("maintenance", maintenance);
  app.addHook("onClose", async () => {
    integrations.stop();
    maintenance.stop();
    await Promise.all([emailWorker.stop(), whatsappWorker.stop(), webhookWorker.stop()]);
  });
  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    authService: AuthService;
    events: EventBus;
    emailWorker: EmailWorker;
    whatsappWorker: WhatsAppWorker;
    webhookWorker: WebhookWorker;
    maintenance: MaintenanceWorker;
  }
}

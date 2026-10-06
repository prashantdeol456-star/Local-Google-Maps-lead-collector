import type { FastifyInstance, FastifyReply } from "fastify";
import type { Repositories } from "../../database/repositories/index.js";
import type { EventBus } from "../../services/events.js";
import type { TrackingService } from "../../services/email/trackingService.js";
import { verifyUnsubscribeToken } from "../../services/email/unsubscribe.js";
import { suppressLead } from "../../services/outreach/preferenceService.js";

// Public pages for recipients (no login). GET shows a confirmation button (link scanners in
// mail clients open GET links, so GET alone never unsubscribes); POST unsubscribes, including
// RFC 8058 one-click requests sent by Gmail/Outlook from the List-Unsubscribe header.

function page(reply: FastifyReply, status: number, title: string, body: string) {
  return reply
    .code(status)
    .type("text/html; charset=utf-8")
    .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'")
    .header("X-Frame-Options", "DENY")
    .header("Referrer-Policy", "no-referrer")
    .header("Cache-Control", "no-store")
    .send(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head>` +
        `<body style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:64px auto;padding:0 16px;color:#111827;line-height:1.5">` +
        `<h1 style="font-size:20px">${title}</h1>${body}</body></html>`,
    );
}

export async function unsubscribeRoutes(app: FastifyInstance, opts: { repos: Repositories; secret: string; bus?: EventBus; tracking?: TrackingService }) {
  // Accept form posts (the confirmation button and one-click requests); the body itself is not needed.
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string", bodyLimit: 1024 }, (_req, body, done) => done(null, body));

  const rateLimit = { rateLimit: { max: 30, timeWindow: "1 minute" } };
  const invalid = (reply: FastifyReply) =>
    page(reply, 404, "Link not valid", "<p>This unsubscribe link is not valid. If you copied it, please make sure the whole link was included.</p>");

  app.get<{ Params: { token: string } }>("/u/:token", { config: rateLimit }, async (request, reply) => {
    const leadId = verifyUnsubscribeToken(opts.secret, request.params.token);
    if (!leadId || !(await opts.repos.leads.findById(leadId))) return invalid(reply);
    return page(
      reply,
      200,
      "Unsubscribe from our emails",
      `<p>Click the button to stop receiving marketing emails from us.</p>` +
        `<form method="post"><button type="submit" style="padding:10px 18px;font-size:15px;cursor:pointer">Unsubscribe</button></form>`,
    );
  });

  app.post<{ Params: { token: string } }>("/u/:token", { config: rateLimit }, async (request, reply) => {
    const leadId = verifyUnsubscribeToken(opts.secret, request.params.token);
    const lead = leadId ? await opts.repos.leads.findById(leadId) : null;
    if (!leadId || !lead) return invalid(reply);

    // By address too, so it still holds if this business is collected again as a new lead.
    await suppressLead(opts.repos, lead, "email", { reason: "Unsubscribed via email link", source: "unsubscribe_link" }, opts.bus);
    const current = await opts.repos.preferences.find(leadId);
    if (current?.emailAllowed !== false) {
      await opts.repos.preferences.upsert(leadId, { emailAllowed: false, optOutReason: "unsubscribe_link", optedOutAt: new Date() });
      await opts.repos.agentLogs.create({ jobId: null, action: "email_unsubscribed", status: "warning", message: `Lead ${leadId} unsubscribed via link` });
      await opts.tracking?.unsubscribed(leadId);
      opts.bus?.publish({ type: "lead.updated", leadId });
    }
    return page(reply, 200, "You are unsubscribed", "<p>You will not receive further marketing emails from us. Sorry to see you go.</p>");
  });
}

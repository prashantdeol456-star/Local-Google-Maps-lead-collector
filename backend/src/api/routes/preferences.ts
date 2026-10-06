import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PreferenceService } from "../../services/outreach/preferenceService.js";
import { Errors } from "../../utils/errors.js";
import { IdParams, optionalText, Pagination, parse, toSkipTake } from "../validation.js";

const Reason = z.object({ reason: z.string().trim().min(3).max(300) });
/** Lifting an opt-out needs a note: only when the person asked to hear from you again. */
const Note = z.object({ note: z.string().trim().min(3).max(300) });
const Channel = z.enum(["email", "whatsapp"]);

const ListQuery = Pagination.extend({ channel: Channel.optional(), q: optionalText(200) });

const AddBody = z.object({
  channel: Channel,
  /** One address per line (or comma separated). */
  addresses: z.string().max(200_000),
  reason: z.string().trim().min(3).max(300),
});

export async function preferenceRoutes(app: FastifyInstance, opts: { preferences: PreferenceService }) {
  const { preferences } = opts;

  // ---- One lead ----
  app.get("/api/leads/:id/preferences", async (request) => preferences.get(parse(IdParams, request.params).id));

  app.post("/api/leads/:id/email-opt-out", async (request) =>
    preferences.optOutEmail(parse(IdParams, request.params).id, { reason: parse(Reason, request.body).reason, source: "admin" }),
  );
  app.post("/api/leads/:id/email-opt-in", async (request) => preferences.allowEmailAgain(parse(IdParams, request.params).id, parse(Note, request.body).note));

  app.post("/api/leads/:id/do-not-contact", async (request) =>
    preferences.setDoNotContact(parse(IdParams, request.params).id, parse(Reason, request.body).reason),
  );
  app.delete("/api/leads/:id/do-not-contact", async (request) =>
    preferences.clearDoNotContact(parse(IdParams, request.params).id, parse(Note, request.body ?? {}).note),
  );

  // ---- Suppression list ----
  app.get("/api/opt-outs", async (request) => {
    const query = parse(ListQuery, request.query);
    const result = await preferences.list({ channel: query.channel, q: query.q, ...toSkipTake(query) });
    return { ...result, page: query.page, pageSize: query.pageSize };
  });

  app.post("/api/opt-outs", async (request) => {
    const body = parse(AddBody, request.body);
    const addresses = body.addresses.split(/[\n,;]+/);
    if (addresses.length > 5000) throw Errors.badRequest("At most 5000 addresses at a time");
    return preferences.add(body.channel, addresses, body.reason);
  });

  app.delete("/api/opt-outs/:id", async (request) => {
    const entry = await preferences.remove(parse(IdParams, request.params).id, parse(Note, request.body ?? {}).note);
    return { removed: entry };
  });
}

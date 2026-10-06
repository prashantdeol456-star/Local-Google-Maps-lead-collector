import { AI_ACTIONS, AI_LIMITS } from "@platform/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AiNavigationService } from "../../services/ai/navigationService.js";
import { parse } from "../validation.js";

const text = (max: number) => z.string().max(max * 2).transform((s) => s.replace(/\s+/g, " ").trim().slice(0, max));

const Snapshot = z.object({
  pageKind: z.enum(["search", "place", "maps", "other"]),
  urlQuery: text(200).nullable(),
  title: text(AI_LIMITS.maxTitleLength),
  hasResultsList: z.boolean(),
  placeLinks: z.number().int().min(0).max(10_000),
  hasSearchBox: z.boolean(),
  candidates: z
    .array(z.object({ i: z.number().int().min(0).max(10_000), role: z.enum(["button", "link", "tab"]), label: text(AI_LIMITS.maxLabelLength) }))
    .max(AI_LIMITS.maxCandidates),
  text: text(AI_LIMITS.maxTextLength),
});

const NextActionBody = z.object({
  jobId: z.string().min(1).max(64),
  query: text(200).pipe(z.string().min(1)),
  snapshot: Snapshot,
  history: z
    .array(z.object({ action: z.enum(AI_ACTIONS), label: text(AI_LIMITS.maxLabelLength).nullable(), result: z.enum(["list_found", "no_change", "page_changed", "failed"]) }))
    .max(AI_LIMITS.maxHistory)
    .default([]),
});

export async function aiRoutes(app: FastifyInstance, opts: { navigation: AiNavigationService }) {
  app.get("/api/ai/status", async () => opts.navigation.status());

  // Called by the extension (bearer token) when the collector cannot find the results list.
  app.post("/api/ai/next-action", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request) => {
    return opts.navigation.nextAction(parse(NextActionBody, request.body));
  });
}

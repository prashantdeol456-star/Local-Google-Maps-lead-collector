import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { QUICK_SEND_MAX, type QuickSendService } from "../../services/outreach/quickSendService.js";
import { parse } from "../validation.js";

// Quick Send: save typed / uploaded emails and numbers as leads, ready for a campaign.

const text = (max: number) => z.string().trim().max(max).nullish();

const Body = z.object({
  list: z.string().trim().min(1, "Give the list a name").max(100),
  contacts: z.array(z.object({ name: text(200), email: text(254), phone: text(30) })).min(1, "Add at least one email or number").max(QUICK_SEND_MAX),
  /** The user confirms everyone with a number agreed to receive WhatsApp messages. */
  whatsappConsent: z.boolean().default(false),
});

export async function quickSendRoutes(app: FastifyInstance, opts: { quickSend: QuickSendService }) {
  app.post("/api/quick-send/contacts", { bodyLimit: 2 * 1024 * 1024 }, async (request) => opts.quickSend.save(parse(Body, request.body)));
}

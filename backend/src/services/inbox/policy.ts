// Decides, in code, whether an AI reply is sent on its own or kept as a draft for the owner.
// Pure and deterministic so it can be tested and explained ("held: needs a human").

import type { ReplyMode } from "../../database/repositories/index.js";
import type { WrittenReply } from "./replyWriter.js";

/** Never sent automatically, whatever the confidence. */
export const HOLD_INTENTS = new Set(["complaint", "order", "partnership", "job"]);

/** Facebook and Instagram only allow replies within 24 hours of the person's last message. */
export const META_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface SendContext {
  platform: string;
  mode: ReplyMode;
  minConfidence: number;
  autoRepliesToday: number;
  maxAutoPerChatPerDay: number;
  lastInboundAt: Date | null;
  now: Date;
}

export type Decision =
  | { action: "none"; reason: string }
  | { action: "draft"; reason: string }
  | { action: "send"; reason: string };

export function canReplyOnPlatform(platform: string, lastInboundAt: Date | null, now: Date): boolean {
  if (platform !== "facebook" && platform !== "instagram") return true;
  return !!lastInboundAt && now.getTime() - lastInboundAt.getTime() < META_WINDOW_MS;
}

export function decide(reply: WrittenReply, ctx: SendContext): Decision {
  if (ctx.mode === "off") return { action: "none", reason: "AI replies are off for this chat" };
  if (!reply.should_reply || !reply.reply) return { action: "none", reason: reply.intent === "spam" ? "Looks like spam: no reply" : "No reply needed" };
  // LinkedIn is never sent by the backend: the extension types it and you press Send.
  if (ctx.platform === "linkedin") return { action: "draft", reason: "LinkedIn: typed for you in the extension; you press Send" };
  if (!canReplyOnPlatform(ctx.platform, ctx.lastInboundAt, ctx.now)) {
    return { action: "draft", reason: "Over 24 hours since their last message: Facebook/Instagram no longer allow a reply from here" };
  }
  if (ctx.mode === "draft") return { action: "draft", reason: "Drafts only for this chat" };
  if (ctx.autoRepliesToday >= ctx.maxAutoPerChatPerDay) return { action: "draft", reason: `Already ${ctx.autoRepliesToday} automatic replies in this chat today` };
  if (ctx.mode === "auto") return { action: "send", reason: "Always-auto mode" };

  // smart
  if (reply.needs_human) return { action: "draft", reason: `Needs you: ${reply.reason || "the AI is not sure"}` };
  if (HOLD_INTENTS.has(reply.intent)) return { action: "draft", reason: `Held because it is about ${reply.intent === "job" ? "a job" : `a ${reply.intent}`}` };
  if (reply.confidence < ctx.minConfidence) {
    return { action: "draft", reason: `Confidence ${Math.round(reply.confidence * 100)}% is below ${Math.round(ctx.minConfidence * 100)}%${reply.reason ? `: ${reply.reason}` : ""}` };
  }
  return { action: "send", reason: `Confident (${Math.round(reply.confidence * 100)}%)` };
}

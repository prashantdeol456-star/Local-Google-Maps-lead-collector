// Google Gemini as the reply writer: the same prompt and output shape as Claude
// (replyWriter.ts), with Gemini's structured output (responseJsonSchema).

import { ApiError, GoogleGenAI, ThinkingLevel } from "@google/genai";
import * as z from "zod/v4";
import { ReplySchema, ReplyWriterError, chatTranscript, systemPrompt, type ReplyContext, type ReplyWriter, type WrittenReply } from "./replyWriter.js";

/** JSON Schema for Gemini, without the "$schema" key. */
function replyJsonSchema(): Record<string, unknown> {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(ReplySchema) as Record<string, unknown>;
  return schema;
}

const LEVEL = { low: ThinkingLevel.LOW, medium: ThinkingLevel.MEDIUM, high: ThinkingLevel.HIGH } as const;

export class GeminiReplyWriter implements ReplyWriter {
  private readonly ai: GoogleGenAI;
  private readonly schema = replyJsonSchema();

  constructor(private readonly options: { apiKey: string; model: string; effort: "low" | "medium" | "high"; client?: GoogleGenAI }) {
    this.ai = options.client ?? new GoogleGenAI({ apiKey: options.apiKey });
  }

  get model() {
    return this.options.model;
  }

  async write(context: ReplyContext): Promise<WrittenReply> {
    let text: string | undefined;
    try {
      const response = await this.ai.models.generateContent({
        model: this.options.model,
        contents: chatTranscript(context),
        config: {
          systemInstruction: systemPrompt(context.business),
          responseMimeType: "application/json",
          responseJsonSchema: this.schema,
          thinkingConfig: { thinkingLevel: LEVEL[this.options.effort] },
          maxOutputTokens: 16000,
        },
      });
      const finish = response.candidates?.[0]?.finishReason;
      if (finish === "SAFETY" || finish === "PROHIBITED_CONTENT" || finish === "BLOCKLIST" || response.promptFeedback?.blockReason) {
        throw new ReplyWriterError("Gemini declined to write a reply for this chat", false);
      }
      if (finish === "MAX_TOKENS") throw new ReplyWriterError("Gemini's answer was cut off", true);
      text = response.text;
    } catch (err) {
      if (err instanceof ReplyWriterError) throw err;
      if (err instanceof ApiError) {
        if (err.status === 400 && /api key/i.test(err.message)) throw new ReplyWriterError("The Gemini API key was rejected", false);
        if (err.status === 401 || err.status === 403) throw new ReplyWriterError("The Gemini API key was rejected or has no access to this model", false);
        if (err.status === 404) throw new ReplyWriterError(`Gemini model "${this.options.model}" was not found`, false);
        if (err.status === 429) throw new ReplyWriterError("Gemini rate limit or quota reached; trying again later", true);
        if (err.status >= 500) throw new ReplyWriterError(`Gemini API error ${err.status}`, true);
        throw new ReplyWriterError(`Gemini rejected the request: ${err.message}`, false);
      }
      throw new ReplyWriterError(`Could not reach the Gemini API: ${err instanceof Error ? err.message : String(err)}`, true);
    }
    if (!text) throw new ReplyWriterError("Gemini returned no answer", true);
    let parsed;
    try {
      parsed = ReplySchema.parse(JSON.parse(text));
    } catch {
      throw new ReplyWriterError("Gemini's answer did not match the expected format", true);
    }
    return { ...parsed, confidence: Math.min(1, Math.max(0, parsed.confidence)), reply: parsed.reply.trim() };
  }
}

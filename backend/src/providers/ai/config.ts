import { z } from "zod";

const empty = (v: unknown) => (v === "" ? undefined : v);

const AiEnv = z.object({
  // Off unless configured: the deterministic collector never needs AI.
  AI_PROVIDER: z.preprocess(empty, z.enum(["off", "anthropic"]).default("off")),
  ANTHROPIC_API_KEY: z.preprocess(empty, z.string().trim().optional()),
  AI_MODEL: z.preprocess(empty, z.string().trim().regex(/^[a-z0-9.-]+$/, "must be a model id such as claude-opus-5-5").default("claude-opus-5-5")),
  /** AI steps allowed per collection job (each step is one AI request). */
  AI_MAX_STEPS_PER_JOB: z.preprocess(empty, z.coerce.number().int().min(1).max(50).default(12)),
});

export type AiConfig = { provider: "off" } | { provider: "anthropic"; apiKey: string; model: string; maxStepsPerJob: number };

export function parseAiConfig(env: Record<string, string | undefined>): AiConfig {
  const parsed = AiEnv.safeParse(env);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new Error(`AI settings: ${issue.path.join(".")} ${issue.message}`);
  }
  const e = parsed.data;
  if (e.AI_PROVIDER === "off") return { provider: "off" };
  if (!e.ANTHROPIC_API_KEY) throw new Error("AI settings: AI_PROVIDER=anthropic needs ANTHROPIC_API_KEY in backend/.env");
  return { provider: "anthropic", apiKey: e.ANTHROPIC_API_KEY, model: e.AI_MODEL, maxStepsPerJob: e.AI_MAX_STEPS_PER_JOB };
}

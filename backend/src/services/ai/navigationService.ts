// Optional AI navigation: one step at a time, inside a per-job budget, every step logged on
// the job. AI never touches normalization, duplicates, storage or exports.

import { checkAiAction, type AiAction, type AiStep, type PageSnapshot } from "@platform/shared";
import type { Repositories } from "../../database/repositories/index.js";
import { AiProviderError, type AiConfig, type AiNavigator } from "../../providers/ai/index.js";
import { maskSecret } from "../../providers/email/index.js";
import { AppError, Errors } from "../../utils/errors.js";

const STEP_LOG = "ai_step";

export interface NextActionResult {
  action: AiAction;
  stepsUsed: number;
  stepsLeft: number;
}

export class AiNavigationService {
  constructor(
    private readonly navigator: AiNavigator | null,
    private readonly config: AiConfig,
    private readonly repos: Repositories,
  ) {}

  status() {
    const c = this.config;
    return c.provider === "off"
      ? { enabled: false as const, provider: "off" as const, model: null, maxStepsPerJob: 0, apiKey: null }
      : { enabled: true as const, provider: c.provider, model: c.model, maxStepsPerJob: c.maxStepsPerJob, apiKey: maskSecret(c.apiKey) };
  }

  private stop(note: string, stepsUsed: number, max: number): NextActionResult {
    return { action: { action: "stop", target: -1, seconds: 0, stopReason: "unknown_layout", note }, stepsUsed, stepsLeft: Math.max(0, max - stepsUsed) };
  }

  async nextAction(input: { jobId: string; query: string; snapshot: PageSnapshot; history: AiStep[] }): Promise<NextActionResult> {
    if (!this.navigator || this.config.provider === "off") {
      throw Errors.conflict("AI_DISABLED", "AI navigation is off. Set AI_PROVIDER and ANTHROPIC_API_KEY in backend/.env to use it");
    }
    const max = this.config.maxStepsPerJob;
    const job = await this.repos.jobs.findById(input.jobId);
    if (!job) throw Errors.notFound("Job not found");
    if (job.status !== "running") throw Errors.conflict("JOB_NOT_RUNNING", `The job is ${job.status}`);

    const used = await this.repos.agentLogs.countByJob(job.id, STEP_LOG);
    if (used >= max) {
      await this.repos.agentLogs.create({ jobId: job.id, action: "ai_budget_used", status: "warning", message: `All ${max} AI steps for this job are used` });
      return this.stop(`AI step budget for this job is used up (${max})`, used, max);
    }

    let raw: unknown;
    try {
      raw = await this.navigator.decide({ query: input.query, snapshot: input.snapshot, history: input.history });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.repos.agentLogs.create({ jobId: job.id, action: "ai_error", status: "error", message });
      if (err instanceof AiProviderError) throw new AppError(502, "AI_PROVIDER_ERROR", message);
      throw err;
    }

    const stepsUsed = used + 1;
    const checked = checkAiAction(raw, input.snapshot);
    if (!checked.ok) {
      // An answer outside the allowed steps (or pointing at an element that was not listed)
      // is never executed: the attempt ends.
      await this.repos.agentLogs.create({ jobId: job.id, action: STEP_LOG, status: "warning", message: `Rejected AI answer: ${checked.error}` });
      return this.stop(`AI answer rejected: ${checked.error}`, stepsUsed, max);
    }

    const a = checked.action;
    const label = a.action === "click" ? input.snapshot.candidates.find((c) => c.i === a.target)?.label : null;
    await this.repos.agentLogs.create({
      jobId: job.id,
      action: STEP_LOG,
      status: a.action === "stop" ? "warning" : "info",
      message: [a.action, label && `"${label}"`, a.action === "stop" && `(${a.stopReason})`].filter(Boolean).join(" ") + (a.note ? `: ${a.note}` : ""),
    });
    return { action: a, stepsUsed, stepsLeft: Math.max(0, max - stepsUsed) };
  }
}

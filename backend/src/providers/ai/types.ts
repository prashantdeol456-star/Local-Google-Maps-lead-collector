import type { AiStep, PageSnapshot } from "@platform/shared";

export interface NavigationRequest {
  /** The search being collected, e.g. "University in Lucknow" */
  query: string;
  snapshot: PageSnapshot;
  /** Steps already taken in this recovery, oldest first */
  history: AiStep[];
}

/** Picks the next navigation step. Returns the raw answer; the caller validates it. */
export interface AiNavigator {
  readonly name: "anthropic";
  readonly model: string;
  decide(request: NavigationRequest): Promise<unknown>;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

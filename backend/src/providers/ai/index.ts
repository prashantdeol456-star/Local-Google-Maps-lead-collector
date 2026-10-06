import { AnthropicNavigator } from "./anthropic.js";
import type { AiConfig } from "./config.js";
import type { AiNavigator } from "./types.js";

/** null when AI is off (the default). */
export function createAiNavigator(config: AiConfig): AiNavigator | null {
  return config.provider === "anthropic" ? new AnthropicNavigator({ apiKey: config.apiKey, model: config.model }) : null;
}

export * from "./types.js";
export { parseAiConfig, type AiConfig } from "./config.js";

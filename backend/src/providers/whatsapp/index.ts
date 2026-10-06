import { normalizePhone, isSharedPhone } from "@platform/shared";
import type { WhatsAppConfig } from "./config.js";
import { LogWhatsAppProvider } from "./log.js";
import { MetaWhatsAppProvider } from "./meta.js";
import type { WhatsAppProvider } from "./types.js";

export function createWhatsAppProvider(config: WhatsAppConfig): WhatsAppProvider {
  switch (config.provider) {
    case "log":
      return new LogWhatsAppProvider();
    case "meta":
      return new MetaWhatsAppProvider(config);
  }
}

/**
 * Phone → WhatsApp recipient id (E.164 digits without "+"), or null when it cannot be a
 * WhatsApp user (invalid, toll-free / shared service numbers).
 */
export function toWhatsAppNumber(phone: string | null | undefined): string | null {
  const e164 = normalizePhone(phone);
  if (!e164 || isSharedPhone(e164)) return null;
  return e164.slice(1);
}

export * from "./types.js";
export { parseWhatsAppConfig, type WhatsAppConfig } from "./config.js";

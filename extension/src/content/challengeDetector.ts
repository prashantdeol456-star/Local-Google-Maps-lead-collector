import { SELECTORS, TEXT_MARKERS } from "./maps/selectors";
import type { ChallengeKind } from "./maps/types";

/**
 * Detects a CAPTCHA / security / consent page. We never try to solve or bypass these:
 * the job pauses and the user handles it manually.
 */
export function detectChallenge(doc: Document, location: { hostname: string; pathname: string }): ChallengeKind | null {
  if (location.pathname.startsWith("/sorry")) return "captcha";
  if (doc.querySelector(SELECTORS.recaptchaFrame)) return "captcha";
  if (location.hostname.startsWith("consent.") || doc.querySelector(SELECTORS.consentForm)) return "consent";
  const text = doc.body?.textContent ?? "";
  if (TEXT_MARKERS.unusualTraffic.some((m) => text.includes(m))) return "unusual_traffic";
  return null;
}

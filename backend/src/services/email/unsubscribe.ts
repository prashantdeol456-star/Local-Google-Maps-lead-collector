import { createHmac, timingSafeEqual } from "node:crypto";

// Unsubscribe links: /u/<leadId-base64url>.<signature>. The HMAC means nobody can
// unsubscribe someone else by guessing ids. Links do not expire (they must keep working).

function sign(secret: string, leadId: string): string {
  return createHmac("sha256", `${secret}:unsubscribe`).update(leadId).digest("base64url").slice(0, 32);
}

export function createUnsubscribeToken(secret: string, leadId: string): string {
  return `${Buffer.from(leadId).toString("base64url")}.${sign(secret, leadId)}`;
}

/** Returns the lead id for a genuine token, otherwise null. */
export function verifyUnsubscribeToken(secret: string, token: string): string | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature || token.length > 200) return null;
  const leadId = Buffer.from(encoded, "base64url").toString("utf8");
  if (!leadId || !/^[A-Za-z0-9_-]{1,64}$/.test(leadId)) return null;
  const expected = Buffer.from(sign(secret, leadId));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given) ? leadId : null;
}

export function unsubscribeUrl(baseUrl: string, secret: string, leadId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/u/${createUnsubscribeToken(secret, leadId)}`;
}

/** True when recipients on the internet could open this URL (not localhost/private). */
export function isPublicUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname;
    if (u.protocol !== "https:") return false;
    return !(
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".test") ||
      host.endsWith(".local") ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host === "[::1]"
    );
  } catch {
    return false;
  }
}

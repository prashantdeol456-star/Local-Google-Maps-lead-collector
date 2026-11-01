// Razorpay (https://razorpay.com/docs/api/): orders, payments and signature checks.

import { createHmac, timingSafeEqual } from "node:crypto";

export interface RazorpayKeys {
  keyId: string;
  keySecret: string;
  /** Secret of the Razorpay webhook (Account & Settings → Webhooks) */
  webhookSecret: string | null;
}

export interface RazorpayPayment {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: "created" | "authorized" | "captured" | "refunded" | "failed";
  method?: string;
  error_description?: string | null;
}

export class RazorpayError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const API = "https://api.razorpay.com/v1";

function sameHex(expected: string, given: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(given, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export const hmacHex = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("hex");

/** Checkout handler: signature = HMAC-SHA256(order_id + "|" + payment_id, key secret). */
export function checkoutSignatureValid(keySecret: string, orderId: string, paymentId: string, signature: string): boolean {
  return sameHex(hmacHex(keySecret, `${orderId}|${paymentId}`), signature);
}

/** Webhook: X-Razorpay-Signature = HMAC-SHA256(raw body, webhook secret). */
export function webhookSignatureValid(webhookSecret: string, rawBody: string, signature: string): boolean {
  return sameHex(hmacHex(webhookSecret, rawBody), signature);
}

export const razorpayMode = (keyId: string) => (keyId.startsWith("rzp_live_") ? "live" : "test");

export class RazorpayClient {
  constructor(
    private readonly keys: RazorpayKeys,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${API}${path}`, {
      method,
      headers: {
        authorization: `Basic ${Buffer.from(`${this.keys.keyId}:${this.keys.keySecret}`).toString("base64")}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => null)) as { error?: { description?: string } } | null;
    if (!res.ok) {
      if (res.status === 401) throw new RazorpayError("Razorpay refused the Key ID / Key Secret", 401);
      throw new RazorpayError(`Razorpay: ${data?.error?.description ?? `HTTP ${res.status}`}`, res.status);
    }
    return data as T;
  }

  createOrder(amountPaise: number, receipt: string, notes: Record<string, string>) {
    return this.call<{ id: string; amount: number; currency: string; status: string }>("POST", "/orders", { amount: amountPaise, currency: "INR", receipt, notes });
  }

  payment(paymentId: string) {
    return this.call<RazorpayPayment>("GET", `/payments/${encodeURIComponent(paymentId)}`);
  }

  capture(paymentId: string, amountPaise: number) {
    return this.call<RazorpayPayment>("POST", `/payments/${encodeURIComponent(paymentId)}/capture`, { amount: amountPaise, currency: "INR" });
  }

  /** Checks the keys with a harmless read. */
  async test(): Promise<void> {
    await this.call("GET", "/orders?count=1");
  }
}

/** RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET from the environment, if set. */
export function razorpayFromEnv(env: Record<string, string | undefined>): RazorpayKeys | null {
  const keyId = env.RAZORPAY_KEY_ID?.trim();
  const keySecret = env.RAZORPAY_KEY_SECRET?.trim();
  return keyId && keySecret ? { keyId, keySecret, webhookSecret: env.RAZORPAY_WEBHOOK_SECRET?.trim() || null } : null;
}

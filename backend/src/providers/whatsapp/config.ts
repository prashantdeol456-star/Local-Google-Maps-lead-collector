import { z } from "zod";

const empty = (v: unknown) => (v === "" ? undefined : v);

const WhatsAppEnv = z.object({
  // gupshup / msg91 can be added as further providers behind the same interface.
  WHATSAPP_PROVIDER: z.enum(["log", "meta"]).default("log"),
  META_WA_ACCESS_TOKEN: z.preprocess(empty, z.string().trim().optional()),
  META_WA_PHONE_NUMBER_ID: z.preprocess(empty, z.string().trim().regex(/^\d+$/, "must be the numeric phone number ID").optional()),
  META_WA_APP_SECRET: z.preprocess(empty, z.string().trim().optional()),
  META_WA_VERIFY_TOKEN: z.preprocess(empty, z.string().trim().min(8, "use at least 8 characters").optional()),
  META_WA_API_VERSION: z.preprocess(empty, z.string().regex(/^v\d+\.\d+$/, 'must look like "v26.0"').default("v26.0")),
  META_WA_SEND_ENDPOINT: z.preprocess(empty, z.enum(["messages", "marketing_messages"]).default("messages")),
});

export type WhatsAppConfig =
  | { provider: "log" }
  | {
      provider: "meta";
      accessToken: string;
      phoneNumberId: string;
      appSecret?: string;
      verifyToken?: string;
      apiVersion: string;
      endpoint: "messages" | "marketing_messages";
    };

export function parseWhatsAppConfig(env: Record<string, string | undefined>): WhatsAppConfig {
  const parsed = WhatsAppEnv.safeParse(env);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new Error(`WhatsApp settings: ${issue.path.join(".")} ${issue.message}`);
  }
  const e = parsed.data;
  if (e.WHATSAPP_PROVIDER === "log") return { provider: "log" };
  const missing = ["META_WA_ACCESS_TOKEN", "META_WA_PHONE_NUMBER_ID"].filter((k) => !e[k as keyof typeof e]);
  if (missing.length) throw new Error(`WhatsApp settings: WHATSAPP_PROVIDER=meta needs ${missing.join(", ")} in backend/.env`);
  return {
    provider: "meta",
    accessToken: e.META_WA_ACCESS_TOKEN!,
    phoneNumberId: e.META_WA_PHONE_NUMBER_ID!,
    appSecret: e.META_WA_APP_SECRET,
    verifyToken: e.META_WA_VERIFY_TOKEN,
    apiVersion: e.META_WA_API_VERSION,
    endpoint: e.META_WA_SEND_ENDPOINT,
  };
}

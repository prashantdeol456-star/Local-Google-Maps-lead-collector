// Services a super admin can switch on or off for each customer (AdminUser.services). Super
// admins always have every service. The dashboard, templates, opt-outs, My sender and the
// account pages are always available to an approved customer.

export const SERVICES = [
  { id: "google_maps", label: "Google Maps leads", note: "Collections, Google Maps leads, export, Maps Data Collector extension" },
  { id: "linkedin", label: "LinkedIn leads", note: "LinkedIn leads, CSV import/export, LinkedIn Helper extension" },
  { id: "contacts", label: "Contacts (sheets)", note: "Upload contact sheets" },
  { id: "email", label: "Email campaigns", note: "Email campaigns with the user's own sender" },
  { id: "whatsapp", label: "WhatsApp campaigns", note: "WhatsApp templates and campaigns with the user's own sender" },
  { id: "ai_inbox", label: "AI Inbox", note: "Telegram, Facebook and Instagram chats with AI replies" },
  { id: "social", label: "Social accounts", note: "Connect Facebook Pages, Instagram and LinkedIn" },
] as const;

export type ServiceId = (typeof SERVICES)[number]["id"];

export const ALL_SERVICES: ServiceId[] = SERVICES.map((s) => s.id);

const IDS = new Set<string>(ALL_SERVICES);

export function isServiceId(value: string): value is ServiceId {
  return IDS.has(value);
}

/** The stored JSON array, keeping only known ids. */
export function parseServices(json: string | null | undefined): ServiceId[] {
  try {
    const parsed = JSON.parse(json ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is ServiceId => typeof v === "string" && isServiceId(v)) : [];
  } catch {
    return [];
  }
}

/** API route template → the service it belongs to (null: not tied to one service). */
const ROUTE_SERVICES: [RegExp, ServiceId][] = [
  [/^\/api\/(leads|jobs|export)(\/|$)/, "google_maps"],
  [/^\/api\/linkedin\//, "linkedin"],
  [/^\/api\/contacts(\/|$)/, "contacts"],
  [/^\/api\/email\//, "email"],
  [/^\/api\/whatsapp\//, "whatsapp"],
  [/^\/api\/inbox\//, "ai_inbox"],
  [/^\/api\/social\//, "social"],
];

export function serviceForRoute(url: string): ServiceId | null {
  return ROUTE_SERVICES.find(([pattern]) => pattern.test(url))?.[1] ?? null;
}

/** Extension zips (Extensions page) → the service they serve. */
export const EXTENSION_SERVICES: Record<string, ServiceId> = {
  "maps-data-collector": "google_maps",
  "linkedin-helper": "linkedin",
};

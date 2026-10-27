import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { normalizeFacebookUrl, normalizeInstagramUrl, parseCount } from "@platform/shared";
import { createTestApp } from "./helpers.js";

let t: Awaited<ReturnType<typeof createTestApp>>;
let auth: { authorization: string };
const call = (method: "GET" | "POST", url: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: auth, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });

beforeAll(async () => {
  t = await createTestApp();
  const res = await t.app.inject({ method: "POST", url: "/api/auth/token", payload: { email: t.credentials.email, password: t.credentials.password } });
  auth = { authorization: `Bearer ${res.json().token}` };
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.db.linkedInMessage.deleteMany();
  await t.db.linkedInCampaign.deleteMany();
  await t.db.outreachContact.deleteMany();
  await t.db.socialLead.deleteMany();
  await t.db.messageTemplate.deleteMany({ where: { channel: { in: ["linkedin", "instagram"] } } });
});

describe("Instagram and Facebook links", () => {
  it("normalizes profile links and usernames", () => {
    expect(normalizeInstagramUrl("https://instagram.com/Cakes_Makes?igsh=abc")).toBe("https://www.instagram.com/cakes_makes/");
    expect(normalizeInstagramUrl("@bliss.cakes")).toBe("https://www.instagram.com/bliss.cakes/");
    expect(normalizeInstagramUrl("https://www.instagram.com/p/DVyXsZzj5Sr/")).toBeNull();
    expect(normalizeInstagramUrl("https://example.com/x")).toBeNull();
    expect(normalizeFacebookUrl("https://m.facebook.com/AcmeBakery/?ref=x")).toBe("https://www.facebook.com/acmebakery");
    expect(normalizeFacebookUrl("https://www.facebook.com/groups/123456/posts/9")).toBe("https://www.facebook.com/groups/123456");
    expect(normalizeFacebookUrl("https://www.facebook.com/profile.php?id=1000&sk=about")).toBe("https://www.facebook.com/profile.php?id=1000");
    expect(normalizeFacebookUrl("https://www.facebook.com/search/pages/?q=x")).toBeNull();
    expect(parseCount("21.7K followers")).toBe(21700);
    expect(parseCount("1,234 members")).toBe(1234);
    expect(parseCount("2.5M")).toBe(2_500_000);
  });
});

describe("Instagram campaigns", () => {
  const CSV = [
    "Name,LinkedIn URL,Instagram URL,Contact Number,Email,Designation,Company",
    "Bliss Cakes,,@bliss_cakes_and_cookies,,,,Bliss",
    "Priya Sharma,https://www.linkedin.com/in/priya-sharma,https://instagram.com/Priya.Sharma/,,priya@example.com,HR,Acme",
    "Bad,,https://instagram.com/p/abc/,,,,",
  ].join("\n");

  async function setup() {
    const up = await call("POST", "/api/contacts/import", { fileName: "c.csv", data: Buffer.from(CSV).toString("base64"), listName: "IG test" });
    const ig = (await call("POST", "/api/channel-templates", { channel: "instagram", name: "IG hi", body: "Hi {{first_name}}! Love your work." })).json().template;
    const li = (await call("POST", "/api/channel-templates", { channel: "linkedin", name: "LI hi", body: "Hello {{first_name}}" })).json().template;
    return { up: up.json(), ig, li };
  }

  const campaign = (platform: "instagram" | "linkedin", templateId: string) =>
    call("POST", "/api/linkedin-outreach/campaigns", {
      platform,
      name: `${platform} test`,
      templateId,
      mode: "auto",
      recipients: { filters: { listName: "IG test" } },
      intervalSec: 60,
      dailyLimit: 15,
      windowStart: "00:00",
      windowEnd: "00:00",
    });

  it("imports the Instagram URL column and messages only contacts that have one", async () => {
    const { up, ig, li } = await setup();
    expect(up).toMatchObject({ created: 2 });
    expect(up.errors).toEqual([{ line: 4, reason: "Not an Instagram profile URL or username: https://instagram.com/p/abc/" }]);
    const facets = (await call("GET", "/api/contacts/facets")).json();
    expect(facets).toMatchObject({ withInstagram: 2, withLinkedIn: 1 });

    // A LinkedIn template cannot be used for Instagram.
    expect((await campaign("instagram", li.id)).json().error.message).toMatch(/Instagram message template/);

    const created = await campaign("instagram", ig.id);
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({ campaign: { platform: "instagram" }, queued: 2 });
    const liCampaign = (await campaign("linkedin", li.id)).json();
    expect(liCampaign.queued).toBe(1);
    await call("POST", `/api/linkedin-outreach/campaigns/${created.json().campaign.id}/start`);
    await call("POST", `/api/linkedin-outreach/campaigns/${liCampaign.campaign.id}/start`);

    // Each extension only gets its own platform's messages.
    const igNext = (await call("POST", "/api/linkedin-outreach/next?platform=instagram")).json();
    expect(igNext.message).toMatchObject({ profileUrl: "https://www.instagram.com/bliss_cakes_and_cookies/", body: "Hi Bliss! Love your work." });
    const liNext = (await call("POST", "/api/linkedin-outreach/next")).json();
    expect(liNext.message).toMatchObject({ profileUrl: "https://www.linkedin.com/in/priya-sharma" });
    // An Instagram message in flight does not block LinkedIn, and vice versa.
    expect((await call("POST", "/api/linkedin-outreach/next?platform=instagram")).json().wait.reason).toBe("in_flight");

    // A block on Instagram pauses only Instagram campaigns.
    await call("POST", `/api/linkedin-outreach/messages/${igNext.message.id}/result`, { status: "blocked", error: "Instagram: action blocked" });
    const camps = (await call("GET", "/api/campaign-logs/campaigns")).json().items;
    expect(camps.find((c: { channel: string }) => c.channel === "instagram")).toMatchObject({ status: "paused" });
    expect(camps.find((c: { channel: string }) => c.channel === "linkedin")).toMatchObject({ status: "running" });
    expect((await call("GET", "/api/linkedin-outreach/campaigns?platform=instagram")).json().total).toBe(1);
  });
});

describe("social leads from the Meta Helper", () => {
  const leads = [
    { platform: "instagram", kind: "profile", url: "https://www.instagram.com/Cakes_Makes/", handle: "cakes_makes", name: "CAKESMAKES | LUCKNOW BAKERY", followers: 21700, audienceText: "21.7K followers", keyword: "bakery lucknow" },
    { platform: "facebook", kind: "page", url: "https://www.facebook.com/AcmeBakery?ref=search", name: "Acme Bakery", category: "Bakery", phone: "+91 90000 00000", keyword: "bakery lucknow" },
    { platform: "facebook", kind: "group", url: "https://www.facebook.com/groups/lucknowfoodies/", name: "Lucknow Foodies", privacy: "public", audienceText: "45K members", followers: 45000, keyword: "lucknow food" },
    { platform: "instagram", kind: "profile", url: "https://www.instagram.com/p/xyz/", name: "a post" },
  ];

  it("saves with canonical links, merges repeats, filters, exports and turns Instagram profiles into contacts", async () => {
    const saved = (await call("POST", "/api/social-leads", { leads })).json();
    expect(saved).toMatchObject({ created: 3, updated: 0, skipped: [{ reason: "Not an Instagram profile link" }] });
    const again = (await call("POST", "/api/social-leads", { leads: [{ ...leads[0], bio: "Custom cakes in Lucknow", url: "instagram.com/cakes_makes" }] })).json();
    expect(again).toMatchObject({ created: 0, updated: 1 });

    const check = (await call("POST", "/api/social-leads/check", { platform: "instagram", urls: ["https://instagram.com/cakes_makes?x=1", "https://www.instagram.com/nobody/"] })).json();
    expect(Object.keys(check.saved)).toEqual(["https://www.instagram.com/cakes_makes/"]);

    const groups = (await call("GET", "/api/social-leads?platform=facebook&kind=group")).json();
    expect(groups.items).toEqual([expect.objectContaining({ name: "Lucknow Foodies", url: "https://www.facebook.com/groups/lucknowfoodies", privacy: "public", followers: 45000 })]);
    const ig = (await call("GET", "/api/social-leads?platform=instagram")).json().items[0];
    expect(ig).toMatchObject({ bio: "Custom cakes in Lucknow", url: "https://www.instagram.com/cakes_makes/" });

    const facets = (await call("GET", "/api/social-leads/facets")).json();
    expect(facets.total).toBe(3);
    expect(facets.keywords).toEqual(expect.arrayContaining([{ value: "bakery lucknow", count: 2 }]));

    const csv = await call("GET", "/api/social-leads/export.csv?platform=facebook");
    expect(csv.body).toContain("Acme Bakery");
    expect(csv.body).not.toContain("CAKESMAKES");

    const page = (await call("GET", "/api/social-leads?platform=facebook&kind=page")).json().items[0];
    expect((await call("POST", "/api/social-leads/to-contacts", { ids: [page.id] })).statusCode).toBe(400);
    const added = (await call("POST", "/api/social-leads/to-contacts", { ids: [ig.id], listName: "IG bakeries" })).json();
    expect(added).toEqual({ added: 1, alreadyContacts: 0 });
    const contacts = (await call("GET", "/api/contacts?hasInstagram=true")).json().items;
    expect(contacts[0]).toMatchObject({ name: "CAKESMAKES | LUCKNOW BAKERY", instagramUrl: "https://www.instagram.com/cakes_makes/", listName: "IG bakeries", source: "instagram" });
    expect((await call("POST", "/api/social-leads/to-contacts", { ids: [ig.id] })).json()).toEqual({ added: 0, alreadyContacts: 1 });
  });
});

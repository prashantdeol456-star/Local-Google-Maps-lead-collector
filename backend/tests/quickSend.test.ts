import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";

// Quick Send: typed / uploaded emails and numbers become leads for the normal campaigns.

let t: Awaited<ReturnType<typeof createTestApp>>;
let auth: { authorization: string };

beforeAll(async () => {
  t = await createTestApp({ loginRateLimitPerMinute: 1000 });
  const res = await t.app.inject({ method: "POST", url: "/api/auth/token", payload: { email: t.credentials.email, password: t.credentials.password } });
  auth = { authorization: `Bearer ${res.json().token}` };
});
afterAll(async () => {
  await t.close();
});

const call = (method: "GET" | "POST", url: string, payload?: unknown) => t.app.inject({ method, url, headers: auth, payload: payload as never });

describe("quick send", () => {
  it("saves valid rows as leads, merges repeats and reports what was skipped", async () => {
    const res = await call("POST", "/api/quick-send/contacts", {
      list: "Diwali offer",
      contacts: [
        { name: "Ravi Shop", email: "Ravi@Shop.in" },
        { phone: "98765 43210" },
        { email: "not-an-email" },
        { phone: "12" },
        { name: "Only a name" },
        { email: "ravi@shop.in", name: "Ravi again" },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.created).toBe(2);
    expect(body.existing).toBe(1);
    expect(body.leadIds).toHaveLength(2);
    expect(body.skipped.map((s: { row: number }) => s.row)).toEqual([3, 4, 5]);

    const lead = (await call("GET", `/api/leads/${body.leadIds[0]}`)).json().lead ?? (await call("GET", `/api/leads/${body.leadIds[0]}`)).json();
    expect(lead).toMatchObject({ name: "Ravi Shop", email: "ravi@shop.in", source: "quick_send", searchKeyword: "Diwali offer" });

    // Ready for an email campaign
    const summary = (await call("POST", "/api/email/campaigns/recipients", { recipients: { leadIds: body.leadIds } })).json();
    expect(summary).toMatchObject({ selected: 2, eligible: 1 });

    expect((await call("POST", "/api/quick-send/contacts", { list: "x", contacts: [] })).statusCode).toBe(400);
  });

  it("records WhatsApp consent only when confirmed, and never over an opt-out", async () => {
    await call("POST", "/api/opt-outs", { channel: "whatsapp", addresses: "+919800000003", reason: "Replied STOP" });
    const res = await call("POST", "/api/quick-send/contacts", {
      list: "Customers",
      contacts: [{ name: "Asha", phone: "+91 98000 00001" }, { name: "Bala", phone: "9800000003" }],
      whatsappConsent: true,
    });
    const body = res.json();
    expect(body.whatsapp).toEqual({ optedIn: 1, alreadyAllowed: 0, optedOut: 1 });
    const [asha, bala] = body.leadIds;
    const allowed = async (id: string) => (await call("GET", `/api/leads/${id}/preferences`)).json().preference?.whatsappAllowed === true;
    expect(await allowed(asha)).toBe(true);
    expect(await allowed(bala)).toBe(false);

    const again = (await call("POST", "/api/quick-send/contacts", { list: "Customers", contacts: [{ phone: "+919800000001" }], whatsappConsent: true })).json();
    expect(again.whatsapp.alreadyAllowed).toBe(1);

    const without = (await call("POST", "/api/quick-send/contacts", { list: "Cold", contacts: [{ phone: "9800000004" }] })).json();
    expect(await allowed(without.leadIds[0])).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { decideSend, inWindow, parseClock } from "../src/services/email/pacing.js";
import { renderEmail, substitute, unknownVariables, variablesIn } from "../src/services/email/render.js";
import { createUnsubscribeToken, isPublicUrl, unsubscribeUrl, verifyUnsubscribeToken } from "../src/services/email/unsubscribe.js";

describe("template rendering", () => {
  it("substitutes variables, with fallbacks for empty values", () => {
    expect(substitute("Hello {{name}} in {{ city | your city }}!", { name: "ERA University", city: null })).toBe("Hello ERA University in your city!");
    expect(substitute("{{phone}}|{{website}}", { phone: " ", website: undefined })).toBe("|");
  });

  it("lists and validates variables", () => {
    expect(variablesIn("{{name}} {{city|x}} {{name}}")).toEqual(["name", "city"]);
    expect(unknownVariables("{{name}} {{email}}", "{{ownerName}}")).toEqual(["email", "ownerName"]);
  });

  it("escapes lead data in HTML, keeps text readable, adds the unsubscribe footer", () => {
    const r = renderEmail(
      { subject: "Website for {{name}}", body: "Hi {{name}},\n\nSee https://acme.in/work.\nThanks" },
      { name: `<script>alert("x")</script> & Co` },
      { unsubscribeUrl: "https://leads.acme.in/u/abc.def" },
    );
    expect(r.subject).toBe(`Website for <script>alert("x")</script> & Co`);
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; Co");
    expect(r.html).toContain('<a href="https://acme.in/work">https://acme.in/work</a>.');
    expect(r.html).toContain('<a href="https://leads.acme.in/u/abc.def">unsubscribe here</a>');
    expect(r.text).toContain(`Hi <script>alert("x")</script> & Co,`);
    expect(r.text.endsWith("unsubscribe here: https://leads.acme.in/u/abc.def")).toBe(true);
  });

  it("strips line breaks from subjects (no header injection)", () => {
    const r = renderEmail({ subject: "Hi {{name}}", body: "x" }, { name: "A\r\nBcc: victim@example.com" }, { unsubscribeUrl: "https://x.in/u/1" });
    expect(r.subject).toBe("Hi A Bcc: victim@example.com");
    expect(r.subject).not.toMatch(/[\r\n]/);
  });
});

describe("unsubscribe tokens", () => {
  const secret = "s".repeat(40);

  it("round-trips and rejects tampering", () => {
    const token = createUnsubscribeToken(secret, "cmlead123");
    expect(verifyUnsubscribeToken(secret, token)).toBe("cmlead123");
    expect(verifyUnsubscribeToken("other".repeat(10), token)).toBeNull();
    const other = createUnsubscribeToken(secret, "cmlead999").split(".")[0];
    expect(verifyUnsubscribeToken(secret, `${other}.${token.split(".")[1]}`)).toBeNull();
    for (const bad of ["", "abc", "abc.", ".sig", "x".repeat(300)]) expect(verifyUnsubscribeToken(secret, bad)).toBeNull();
  });

  it("builds the link from the base URL", () => {
    expect(unsubscribeUrl("https://leads.acme.in/", secret, "cm1")).toMatch(/^https:\/\/leads\.acme\.in\/u\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("knows which base URLs recipients can reach", () => {
    expect(isPublicUrl("https://leads.acme.in")).toBe(true);
    for (const u of ["http://leads.acme.in", "https://localhost:3000", "https://127.0.0.1", "https://192.168.1.5", "https://app.test", "nope"]) {
      expect(isPublicUrl(u), u).toBe(false);
    }
  });
});

describe("pacing", () => {
  const base = {
    intervalSec: 180,
    dailyLimit: 50,
    windowStart: "10:00",
    windowEnd: "18:00",
    timeZone: "Asia/Kolkata",
    startAt: null,
    lastSentAt: null,
    sentToday: 0,
  };
  // 2026-10-06 11:00 IST = 05:30 UTC
  const at = (ist: string) => new Date(`2026-10-06T${ist}:00+05:30`);

  it("parses HH:MM", () => {
    expect(parseClock("09:30")).toBe(570);
    expect(parseClock("24:00")).toBeNull();
    expect(parseClock("9:30")).toBeNull();
  });

  it("respects the local sending window, including windows across midnight", () => {
    expect(inWindow(at("10:00"), "10:00", "18:00", "Asia/Kolkata")).toBe(true);
    expect(inWindow(at("17:59"), "10:00", "18:00", "Asia/Kolkata")).toBe(true);
    expect(inWindow(at("18:00"), "10:00", "18:00", "Asia/Kolkata")).toBe(false);
    expect(inWindow(at("23:30"), "22:00", "06:00", "Asia/Kolkata")).toBe(true);
    expect(inWindow(at("12:00"), "22:00", "06:00", "Asia/Kolkata")).toBe(false);
  });

  it("sends when allowed", () => {
    expect(decideSend(at("11:00"), base)).toEqual({ send: true });
  });

  it("waits for start time, window, interval and daily limit", () => {
    expect(decideSend(at("11:00"), { ...base, startAt: at("12:00") })).toEqual({ send: false, reason: "not_started", nextCheckAt: at("12:00") });

    const early = decideSend(at("08:15"), base);
    expect(early).toEqual({ send: false, reason: "outside_window", nextCheckAt: at("10:00") });

    expect(decideSend(at("11:00"), { ...base, lastSentAt: at("10:59") })).toEqual({
      send: false,
      reason: "interval",
      nextCheckAt: new Date(at("10:59").getTime() + 180_000),
    });

    expect(decideSend(at("11:00"), { ...base, sentToday: 50 })).toEqual({
      send: false,
      reason: "daily_limit",
      nextCheckAt: new Date("2026-10-07T10:00:00+05:30"),
    });
  });
});

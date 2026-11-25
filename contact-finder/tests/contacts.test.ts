// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { contactsToCsv, contactsToPlatformCsv, hasSomething, mergeSighting, trimContacts, type Sighting } from "../src/core/contacts";
import { findContactInfoDialog, parseContactInfo, parseTopCard } from "../src/content/linkedin";

const site = (over: Partial<Sighting> = {}): Sighting => ({
  id: "site:shop.in",
  kind: "website",
  url: "https://shop.in/",
  name: "Shop",
  website: "https://shop.in",
  findings: { emails: [{ value: "info@shop.in", how: "link" }], phones: [{ value: "+91 98100 12345", how: "text" }], socials: [] },
  ...over,
});

describe("saved contacts", () => {
  it("merges what several pages of a site showed, without duplicates", () => {
    const first = mergeSighting(undefined, site(), 1000);
    const again = mergeSighting(
      first,
      site({
        url: "https://shop.in/contact",
        how: "contact_page",
        findings: { emails: [{ value: "info@shop.in", how: "text" }, { value: "sales@shop.in", how: "text" }], phones: [{ value: "9810012345", how: "text" }, { value: "011 4501 2345", how: "text" }], socials: ["https://www.linkedin.com/company/shop"] },
      }),
      2000,
    );
    expect(again.emails.map((e) => `${e.value} (${e.how})`)).toEqual(["info@shop.in (link)", "sales@shop.in (contact_page)"]);
    expect(again.phones.map((p) => p.value)).toEqual(["+91 98100 12345", "011 4501 2345"]);
    expect(again.emails[1]!.source).toBe("https://shop.in/contact");
    expect(again).toMatchObject({ firstSeen: 1000, lastSeen: 2000, socials: ["https://www.linkedin.com/company/shop"] });
    expect(hasSomething(site({ findings: { emails: [], phones: [], socials: [] } }))).toBe(false);
  });

  it("keeps the newest contacts when there are too many", () => {
    const all = Object.fromEntries([1, 2, 3].map((i) => [`site:${i}`, mergeSighting(undefined, site({ id: `site:${i}` }), i)]));
    expect(Object.keys(trimContacts(all, 2)).sort()).toEqual(["site:2", "site:3"]);
  });

  it("exports CSV safely and builds the Lead Platform contact sheet", () => {
    const c = mergeSighting(undefined, site({ name: '=HYPERLINK("x")' }), 1000);
    const csv = contactsToCsv([c]);
    expect(csv.startsWith("﻿Name,Title,Company,Emails,Phones")).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    const profile = mergeSighting(undefined, { id: "li:in/asha", kind: "linkedin_profile", url: "https://www.linkedin.com/in/asha/", name: "Asha Verma", title: "HR Manager", company: "Acme", linkedinUrl: "https://www.linkedin.com/in/asha/", findings: { emails: [], phones: [], socials: [] } }, 1);
    const empty = mergeSighting(undefined, site({ id: "site:empty", findings: { emails: [], phones: [], socials: [] } }), 1);
    const sheet = contactsToPlatformCsv([c, profile, empty]);
    expect(sheet.rows).toBe(2);
    expect(sheet.csv.split("\r\n")[0]).toBe("Name,LinkedIn URL,Contact Number,Email,Designation,Company");
    expect(sheet.csv).toContain("Asha Verma,https://www.linkedin.com/in/asha/,,,HR Manager,Acme");
  });
});

describe("LinkedIn profile", () => {
  it("reads the name and the Contact info LinkedIn shows you", () => {
    document.body.innerHTML = `
      <main><section><h1>Asha Verma</h1><div class="text-body-medium">HR Manager at Acme Healthcare</div>
      <span class="text-body-small inline">Lucknow, Uttar Pradesh, India</span>
      <a href="/in/asha-verma/overlay/contact-info/">Contact info</a></section></main>
      <div role="dialog"><h2>Contact info</h2>
        <section><h3>Email</h3><a href="mailto:asha@acme.in">asha@acme.in</a></section>
        <section><h3>Phone</h3><span>98100 12345 (Mobile)</span></section>
      </div>`;
    document.querySelectorAll("h1, h2, h3, div, span, a, section").forEach((e) => e.insertAdjacentText("afterend", "\n"));
    const top = parseTopCard(document);
    expect(top).toMatchObject({ name: "Asha Verma", headline: "HR Manager at Acme Healthcare", company: "Acme Healthcare" });
    const info = parseContactInfo(findContactInfoDialog(document)!);
    expect(info.emails).toEqual(["asha@acme.in"]);
    expect(info.phones.length).toBe(1);
  });
});

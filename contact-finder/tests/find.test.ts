import { describe, expect, it } from "vitest";
import { contactPageLinks, deobfuscate, displayPhone, findContacts, htmlToParts, looksLikePhone, siteKey } from "../src/core/find";

describe("emails on a page", () => {
  it("reads email links and written addresses, including [at] / [dot] spellings", () => {
    const f = findContacts({
      text: "Write to Sales.Team@Shop-India.co.in or info [at] shop [dot] in. HR: hr(at)shop(dot)com. Support: care at shop dot in",
      hrefs: ["mailto:Owner%40shop.in?subject=Hello", "mailto:a@shop.in,b@shop.in"],
    });
    expect(f.emails.map((e) => e.value)).toEqual(["owner@shop.in", "a@shop.in", "b@shop.in", "sales.team@shop-india.co.in", "info@shop.in", "hr@shop.com", "care@shop.in"]);
    expect(f.emails[0]!.how).toBe("link");
    expect(f.emails[3]!.how).toBe("text");
  });

  it("skips file names, placeholders and no-reply addresses", () => {
    const f = findContacts({ text: "logo@2x.png you@example.com name@domain.com noreply@shop.in sprite@3x.webp real@shop.in", hrefs: [] });
    expect(f.emails.map((e) => e.value)).toEqual(["real@shop.in"]);
    expect(deobfuscate("x [at] y [dot] com")).toBe("x@y.com");
  });
});

describe("phones on a page", () => {
  it("reads tel: and WhatsApp links and Indian numbers written in the text", () => {
    const f = findContacts({
      text: "Call +91 98100 12345 or 011-4501-2345. Toll free 1800-123-4567. Mobile 9876501234.",
      hrefs: ["tel:+919810012345", "https://wa.me/919811122233?text=hi", "tel:%2B91-120-4567890"],
    });
    expect(f.phones.map((p) => p.value)).toEqual(["+91 98100 12345", "+91 98111 22233", "+91-120-4567890", "011-4501-2345", "1800-123-4567", "+91 98765 01234"]);
    expect(f.phones.map((p) => p.how)).toEqual(["link", "whatsapp", "link", "text", "text", "text"]);
  });

  it("does not take order numbers, dates, prices or years for phones", () => {
    expect(looksLikePhone("2023-2024")).toBe(false);
    expect(looksLikePhone("1234567890")).toBe(false);
    expect(looksLikePhone("5000000000")).toBe(false); // does not start like an Indian mobile
    expect(looksLikePhone("0000000000")).toBe(false);
    expect(looksLikePhone("+44 20 7946 0958")).toBe(true);
    const f = findContacts({ text: "Order 4521 7789 3321 · ₹ 1,25,000 · GSTIN 07AAACX0000A1Z5 · 2019 - 2026", hrefs: [] });
    expect(f.phones).toEqual([]);
    expect(displayPhone("919810012345")).toBe("+91 98100 12345");
  });
});

describe("site pages", () => {
  it("finds the same site's contact and about pages, nothing else", () => {
    const links = contactPageLinks(
      ["/contact-us", "https://shop.in/about#team", "https://other.com/contact", "/blog/post", "/files/contact.pdf", "mailto:x@shop.in", "/support", "/get-in-touch", "/our-team"],
      "https://shop.in/products",
    );
    expect(links).toEqual(["https://shop.in/contact-us", "https://shop.in/about", "https://shop.in/support", "https://shop.in/get-in-touch"]);
  });

  it("reads text and links from HTML without a browser", () => {
    const parts = htmlToParts(`<html><head><title>Contact – Shop</title><style>a{}</style><script>var e="x@y.com"</script></head><body><a href="mailto:info&#64;shop.in">Mail</a><p>Phone: <b>+91 98100 12345</b> · sales&#64;shop.in</p></body></html>`);
    expect(parts.title).toBe("Contact – Shop");
    expect(parts.hrefs).toEqual(["mailto:info&#64;shop.in"]);
    const f = findContacts(parts);
    expect(f.emails.map((e) => e.value)).toContain("sales@shop.in");
    expect(f.emails.map((e) => e.value)).not.toContain("x@y.com");
    expect(f.phones.map((p) => p.value)).toEqual(["+91 98100 12345"]);
    expect(siteKey("https://WWW.Shop.co.in/x")).toBe("shop.co.in");
    expect(siteKey("chrome://extensions")).toBeNull();
  });
});

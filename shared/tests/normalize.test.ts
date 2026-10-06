import { describe, expect, it } from "vitest";
import {
  isIdentifyingWebsite,
  isSharedPhone,
  normalizeAddress,
  normalizeName,
  normalizePhone,
  normalizeWebsite,
  normalizeWhitespace,
} from "../src/index.js";

describe("normalizeName", () => {
  it.each([
    ["  ABC   University ", "abc university"],
    ["St. Xavier's College", "st xaviers college"],
    ["A & B Institute", "a and b institute"],
    ["Café Délice", "cafe delice"],
    ["ERA University (Main Campus)", "era university main campus"],
    ["एरा युनिवर्सिटी", "एरा युनिवर्सिटी"],
    ["!!!", null],
    ["", null],
    [null, null],
  ])("%j → %j", (input, expected) => {
    expect(normalizeName(input)).toBe(expected);
  });

  it("does not drop distinguishing words", () => {
    expect(normalizeName("Lucknow University")).not.toBe(normalizeName("Lucknow Public School"));
  });
});

describe("normalizeAddress", () => {
  it("normalizes punctuation/case and drops a trailing India", () => {
    expect(normalizeAddress("Tondan Marg, Sarfarazganj, Lucknow, Uttar Pradesh 226003, India")).toBe(
      "tondan marg sarfarazganj lucknow uttar pradesh 226003",
    );
    expect(normalizeAddress("TONDAN MARG,SARFARAZGANJ, LUCKNOW, UTTAR PRADESH 226003")).toBe(
      "tondan marg sarfarazganj lucknow uttar pradesh 226003",
    );
  });
});

describe("normalizePhone (India default)", () => {
  it.each([
    ["08957926677", "+918957926677"],
    ["089579 26677", "+918957926677"],
    ["8957926677", "+918957926677"],
    ["+91 89579 26677", "+918957926677"],
    ["+91-8957926677", "+918957926677"],
    ["918957926677", "+918957926677"],
    ["0091 8957926677", "+918957926677"],
    ["0522 400 0000", "+915224000000"], // Lucknow landline with STD code
    ["(0522) 4000000", "+915224000000"],
    ["1800 123 4567", "+9118001234567"], // toll-free, 11 digits
    ["1800-180-123", "+911800180123"], // toll-free, 10 digits
    ["+91 1860 500 1234", "+9118605001234"],
    ["+1 (415) 555-0100", "+14155550100"],
    ["+44 20 7946 0000", "+442079460000"],
  ])("%j → %j", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(["", "abc", "12345", "0000", "+91 12345", "999999999999999999", "0987654320", "+91 0987654320", null])("rejects %j", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it("toll-free numbers are kept but flagged as shared (never used to merge)", () => {
    expect(isSharedPhone(normalizePhone("1800 123 4567")!)).toBe(true);
    expect(isSharedPhone(normalizePhone("+91 1860 500 1234")!)).toBe(true);
    expect(isSharedPhone("+918957926677")).toBe(false);
    expect(isSharedPhone("+18001234567")).toBe(false); // US 800 numbers are not Indian toll-free
  });
});

describe("normalizeWebsite", () => {
  it.each([
    ["http://www.erauniversity.in/", "erauniversity.in"],
    ["https://ERAUNIVERSITY.in", "erauniversity.in"],
    ["erauniversity.in", "erauniversity.in"],
    ["https://m.example.com/index.html", "example.com"],
    ["https://www.amity.edu/lucknow/?utm_source=google&utm_medium=local", "amity.edu/lucknow"],
    ["https://www.amity.edu/noida/", "amity.edu/noida"],
    ["https://example.com/About-Us/#team", "example.com/about-us"],
    ["https://www2.example.org/", "example.org"],
    ["https://facebook.com/abcuniversity", "facebook.com/abcuniversity"],
  ])("%j → %j", (input, expected) => {
    expect(normalizeWebsite(input)).toBe(expected);
  });

  it("keeps different campuses on the same domain apart", () => {
    expect(normalizeWebsite("https://www.amity.edu/lucknow/")).not.toBe(normalizeWebsite("https://www.amity.edu/noida/"));
  });

  it.each([
    "",
    "not a url",
    "mailto:a@b.com",
    "tel:+918957926677",
    "javascript:alert(1)",
    "http://localhost/",
    "https://%zz",
    "https://user:pass@example.com",
  ])("rejects %j", (input) => {
    expect(normalizeWebsite(input)).toBeNull();
  });

  it("flags links that cannot identify one business", () => {
    expect(isIdentifyingWebsite("erauniversity.in")).toBe(true);
    expect(isIdentifyingWebsite("facebook.com/abcuniversity")).toBe(true);
    for (const u of ["wa.me/919800000000", "api.whatsapp.com/send", "bit.ly/abc", "google.com/maps", "linktr.ee/abc"]) {
      expect(isIdentifyingWebsite(u), u).toBe(false);
    }
    expect(isIdentifyingWebsite("notgoogle.com")).toBe(true); // suffix match only on dot boundary
  });
});

describe("normalizeWhitespace", () => {
  it("collapses and trims", () => {
    expect(normalizeWhitespace("  a \n b  ")).toBe("a b");
    expect(normalizeWhitespace("   ")).toBeNull();
  });
});

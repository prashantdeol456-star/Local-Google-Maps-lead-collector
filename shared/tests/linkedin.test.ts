import { describe, expect, it } from "vitest";
import { normalizeLinkedInProfileUrl } from "../src/index.js";

describe("normalizeLinkedInProfileUrl", () => {
  it("returns one canonical URL for the forms LinkedIn uses", () => {
    const canonical = "https://www.linkedin.com/in/nikhil-sharda";
    for (const input of [
      "https://www.linkedin.com/in/nikhil-sharda",
      "https://www.linkedin.com/in/Nikhil-Sharda/",
      "linkedin.com/in/nikhil-sharda",
      "https://in.linkedin.com/in/nikhil-sharda?originalSubdomain=in",
      "https://www.linkedin.com/in/nikhil-sharda/overlay/contact-info/",
      "http://www.linkedin.com/in/nikhil-sharda#experience",
    ]) {
      expect(normalizeLinkedInProfileUrl(input), input).toBe(canonical);
    }
  });

  it("decodes and re-encodes non-ASCII slugs consistently", () => {
    const a = normalizeLinkedInProfileUrl("https://www.linkedin.com/in/%E0%A4%B0%E0%A4%BE%E0%A4%AE");
    expect(a).toBe(normalizeLinkedInProfileUrl("https://www.linkedin.com/in/राम"));
  });

  it("rejects anything that is not a member profile", () => {
    for (const input of [
      "",
      null,
      "https://www.linkedin.com/company/fixtra",
      "https://www.linkedin.com/search/results/people/?keywords=hr",
      "https://evil.com/in/someone",
      "https://linkedin.com.evil.com/in/someone",
      "javascript:alert(1)",
      "https://www.linkedin.com/in/",
    ]) {
      expect(normalizeLinkedInProfileUrl(input), String(input)).toBeNull();
    }
  });
});

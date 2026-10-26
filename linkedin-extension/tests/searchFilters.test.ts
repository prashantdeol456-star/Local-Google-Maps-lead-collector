import { describe, expect, it } from "vitest";
import { copyFiltersFromUrl, describeCopied, emptyFilters, hasAnyFilter, peopleSearchUrl } from "../src/sidepanel/services/searchFilters";

const params = (url: string) => Object.fromEntries(new URL(url).searchParams);

describe("people search filters", () => {
  it("builds the URL parameters LinkedIn accepts (checked on linkedin.com)", () => {
    const url = peopleSearchUrl("HR", {
      ...emptyFilters(),
      connections: ["F", "S"],
      title: "HR Manager",
      company: 'Gen"pact',
      school: "IIM Lucknow",
      firstName: "Deepa",
      language: "en",
      copied: { geoUrn: '["102713980"]', industry: '["96"]', evil: "x" },
    });
    expect(url.startsWith("https://www.linkedin.com/search/results/people/?")).toBe(true);
    expect(params(url)).toEqual({
      keywords: "HR",
      origin: "FACETED_SEARCH",
      network: '["F","S"]',
      firstName: '"Deepa"',
      title: '"HR Manager"',
      company: '"Genpact"',
      schoolFreetext: '"IIM Lucknow"',
      profileLanguage: '["en"]',
      geoUrn: '["102713980"]',
      industry: '["96"]',
    });
    expect(url).not.toContain("+");
  });

  it("works with filters only, no keyword", () => {
    expect(params(peopleSearchUrl("", { ...emptyFilters(), title: "CEO" }))).toEqual({ origin: "FACETED_SEARCH", title: '"CEO"' });
  });

  it("copies LinkedIn's id filters from a people-search URL only", () => {
    const copied = copyFiltersFromUrl(
      "https://www.linkedin.com/search/results/people/?keywords=HR&geoUrn=%5B%22102713980%22%2C%22104869687%22%5D&currentCompany=%5B%221035%22%5D&network=%5B%22S%22%5D",
    );
    expect(copied).toEqual({ geoUrn: '["102713980","104869687"]', currentCompany: '["1035"]' });
    expect(describeCopied(copied!)).toBe("Locations (2), Current companies (1)");
    expect(copyFiltersFromUrl("https://www.linkedin.com/in/someone/")).toBeNull();
    expect(copyFiltersFromUrl("https://evil.com/search/results/people/?geoUrn=1")).toBeNull();
  });

  it("knows when any filter is set", () => {
    expect(hasAnyFilter(emptyFilters())).toBe(false);
    expect(hasAnyFilter({ ...emptyFilters(), school: " x " })).toBe(true);
    expect(hasAnyFilter({ ...emptyFilters(), copied: { geoUrn: "[]" } })).toBe(true);
  });
});

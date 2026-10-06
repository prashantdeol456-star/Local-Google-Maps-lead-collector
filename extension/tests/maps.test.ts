import { describe, expect, it } from "vitest";
import { buildMapsSearchUrl, parseMapsPage } from "../src/utils/maps";

describe("parseMapsPage", () => {
  it("detects a search results page and decodes the query", () => {
    const p = parseMapsPage("https://www.google.com/maps/search/University+in+Lucknow/@26.84,80.94,12z?entry=ttu");
    expect(p).toMatchObject({ isMaps: true, isSearch: true, isPlace: false, query: "University in Lucknow" });
  });

  it("decodes percent-encoded queries", () => {
    expect(parseMapsPage("https://www.google.com/maps/search/Mobile%20shops%20in%20Delhi").query).toBe("Mobile shops in Delhi");
  });

  it("supports google.co.in", () => {
    expect(parseMapsPage("https://www.google.co.in/maps/search/College+in+Moradabad").isSearch).toBe(true);
  });

  it("detects a place page", () => {
    const p = parseMapsPage("https://www.google.com/maps/place/ABC+University/@26.8,80.9,17z");
    expect(p).toMatchObject({ isMaps: true, isSearch: false, isPlace: true, query: null });
  });

  it("Maps home is Maps but not a search", () => {
    expect(parseMapsPage("https://www.google.com/maps/@26.8,80.9,12z")).toMatchObject({ isMaps: true, isSearch: false });
  });

  it("rejects non-Maps pages and look-alike hosts", () => {
    expect(parseMapsPage("https://www.google.com/search?q=maps").isMaps).toBe(false);
    expect(parseMapsPage("https://www.google.com.evil.example/maps/search/x").isMaps).toBe(false);
    expect(parseMapsPage("not a url").isMaps).toBe(false);
  });

  it("does not throw on malformed percent-encoding", () => {
    expect(parseMapsPage("https://www.google.com/maps/search/100%25+%E0%A4").isSearch).toBe(true);
  });
});

describe("buildMapsSearchUrl", () => {
  it("builds a URL that parses back to the same query", () => {
    const url = buildMapsSearchUrl("Engineering College in Lucknow");
    expect(url).toBe("https://www.google.com/maps/search/Engineering+College+in+Lucknow");
    expect(parseMapsPage(url).query).toBe("Engineering College in Lucknow");
  });

  it("encodes special characters", () => {
    expect(parseMapsPage(buildMapsSearchUrl("Cafés & bars in Delhi/NCR")).query).toBe("Cafés & bars in Delhi/NCR");
  });
});

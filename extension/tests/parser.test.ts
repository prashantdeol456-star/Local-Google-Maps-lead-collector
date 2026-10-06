import { describe, expect, it } from "vitest";
import {
  canonicalMapsUrl,
  cleanText,
  parseAddress,
  parsePhoneItemId,
  parsePlaceUrl,
  parseRating,
  parseReviewCount,
  parseWebsite,
} from "../src/content/maps/parser";
import { PLACE_HREF_A, PLACE_HREF_C_NO_IDS } from "./fixtures/maps";

describe("parsePlaceUrl", () => {
  it("reads place id, feature id and coordinates", () => {
    expect(parsePlaceUrl(PLACE_HREF_A)).toEqual({
      placeId: "ChIJexampleAAAAAAAAAAAAAA",
      featureId: "0x399bfd99491cd3df:0xef84c13754ef7e48",
      latitude: 26.8635706,
      longitude: 80.9361191,
    });
  });

  it("returns nulls when ids are missing", () => {
    expect(parsePlaceUrl(PLACE_HREF_C_NO_IDS)).toEqual({ placeId: null, featureId: null, latitude: null, longitude: null });
  });

  it("rejects out-of-range coordinates", () => {
    const p = parsePlaceUrl("https://www.google.com/maps/place/X/data=!3d126.1!4d80.9");
    expect(p.latitude).toBeNull();
    expect(p.longitude).toBeNull();
  });

  it("handles negative coordinates", () => {
    const p = parsePlaceUrl("https://www.google.com/maps/place/X/data=!3d-33.86!4d-151.2");
    expect([p.latitude, p.longitude]).toEqual([-33.86, -151.2]);
  });
});

describe("canonicalMapsUrl", () => {
  it("drops query parameters", () => {
    expect(canonicalMapsUrl(PLACE_HREF_A)).toBe(PLACE_HREF_A.split("?")[0]);
  });
  it("rejects non-place URLs", () => {
    expect(canonicalMapsUrl("https://www.google.com/maps/search/x")).toBeNull();
    expect(canonicalMapsUrl("not a url")).toBeNull();
  });
});

describe("rating / reviews", () => {
  it.each([
    ["4.2 stars ", 4.2],
    ["5 stars", 5],
    ["4,5 étoiles", 4.5],
    [null, null],
    ["no rating", null],
    ["7.5 stars", null],
  ])("parseRating(%j) = %j", (input, expected) => {
    expect(parseRating(input)).toBe(expected);
  });

  it.each([
    ["1,262 reviews", 1262],
    ["(7,780)", 7780],
    ["(29)", 29],
    ["1 review", 1],
    [null, null],
    ["No reviews", null],
  ])("parseReviewCount(%j) = %j", (input, expected) => {
    expect(parseReviewCount(input)).toBe(expected);
  });
});

describe("parsePhoneItemId", () => {
  it.each([
    ["phone:tel:08957926677", "08957926677"],
    ["phone:tel:+915224000000", "+915224000000"],
    ["phone:tel:0522 400-0000", "05224000000"],
    ["address", null],
    ["phone:tel:", null],
    [null, null],
  ])("%j → %j", (input, expected) => {
    expect(parsePhoneItemId(input)).toBe(expected);
  });
});

describe("parseWebsite", () => {
  it("keeps normal http(s) links", () => {
    expect(parseWebsite("http://www.example.edu.in/")).toBe("http://www.example.edu.in/");
  });
  it("unwraps Google redirect links", () => {
    expect(parseWebsite("/url?q=https://example.com/page&sa=U")).toBe("https://example.com/page");
    expect(parseWebsite("https://www.google.co.in/url?q=https%3A%2F%2Fexample.in")).toBe("https://example.in/");
  });
  it("rejects other schemes and junk", () => {
    expect(parseWebsite("javascript:alert(1)")).toBeNull();
    expect(parseWebsite("mailto:a@b.com")).toBeNull();
    expect(parseWebsite(null)).toBeNull();
    expect(parseWebsite("/url?sa=U")).toBeNull();
  });
});

describe("parseAddress", () => {
  it("parses a full Indian address", () => {
    expect(parseAddress("Tondan Marg, Sarfarazganj, Lucknow, Uttar Pradesh 226003")).toEqual({
      city: "Lucknow",
      state: "Uttar Pradesh",
      postalCode: "226003",
      country: "India",
    });
  });

  it("handles a trailing ', India' and missing PIN", () => {
    expect(parseAddress("Civil Lines, Moradabad, Uttar Pradesh, India")).toEqual({
      city: "Moradabad",
      state: "Uttar Pradesh",
      postalCode: null,
      country: "India",
    });
  });

  it("recognises union territories, case-insensitively", () => {
    expect(parseAddress("Connaught Place, New Delhi, delhi 110001")).toMatchObject({ city: "New Delhi", state: "Delhi" });
  });

  it("does not guess for unknown formats", () => {
    const none = { city: null, state: null, postalCode: null, country: null };
    expect(parseAddress("221B Baker Street, London NW1 6XE")).toEqual(none);
    expect(parseAddress("Malhaur Railway Station Road")).toEqual(none);
    expect(parseAddress(null)).toEqual(none);
  });

  it("prefers the job location as city when it is one of the address parts", () => {
    const addr = "Malhaur Railway Station Road, Gomti Nagar, Lucknow, Nijampur Malhaur, Uttar Pradesh 226028";
    expect(parseAddress(addr).city).toBe("Nijampur Malhaur"); // no hint: part before the state
    expect(parseAddress(addr, "lucknow")).toMatchObject({ city: "Lucknow", state: "Uttar Pradesh", postalCode: "226028" });
    // A hint that is not an exact address part is ignored (no partial matching).
    expect(parseAddress(addr, "Luck").city).toBe("Nijampur Malhaur");
    expect(parseAddress(addr, "Delhi").city).toBe("Nijampur Malhaur");
  });

  it("does not use a plus code as the city", () => {
    expect(parseAddress("VVGC+H8, Uttar Pradesh 226003").city).toBeNull();
  });
});

describe("cleanText", () => {
  it("strips Maps icon glyphs and collapses whitespace", () => {
    expect(cleanText("\n  Tondan Marg,\n Lucknow ")).toBe("Tondan Marg, Lucknow");
    expect(cleanText("   ")).toBeNull();
    expect(cleanText(undefined)).toBeNull();
  });
});

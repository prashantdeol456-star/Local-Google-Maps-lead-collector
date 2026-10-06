// @vitest-environment happy-dom
import { defaultCollectorSettings } from "@platform/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { detectChallenge } from "../src/content/challengeDetector";
import { buildListing, findDetailPanel, readDetailFields, readResultCards } from "../src/content/maps/extractor";
import { DomMapsPage } from "../src/content/maps/page";
import { detailHtml, PLACE_HREF_A, resultsHtml } from "./fixtures/maps";

const allFields = defaultCollectorSettings().fields;

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("readResultCards", () => {
  it("reads cards, de-duplicating repeated results by feature id", () => {
    document.body.innerHTML = resultsHtml();
    const cards = readResultCards(document);
    expect(cards.map((c) => c.name)).toEqual(["Example University", "Sample College", "No Ids Institute"]);
    expect(cards[0]).toMatchObject({
      key: "0x399bfd99491cd3df:0xef84c13754ef7e48",
      placeId: "ChIJexampleAAAAAAAAAAAAAA",
      latitude: 26.8635706,
      longitude: 80.9361191,
    });
    // No feature id → falls back to the place path as key.
    expect(cards[2]!.key).toBe("https://www.google.com/maps/place/No+Ids+Institute/@26.8,80.9,17z");
  });

  it("returns nothing when there is no results list", () => {
    document.body.innerHTML = detailHtml({ name: "Example University" });
    expect(readResultCards(document)).toEqual([]);
  });
});

describe("detail panel", () => {
  it("reads all fields and builds the listing", () => {
    document.body.innerHTML = detailHtml({
      name: "Example University",
      address: "Tondan Marg, Sarfarazganj, Lucknow, Uttar Pradesh 226003",
    });
    const panel = findDetailPanel(document)!;
    const detail = readDetailFields(panel);
    expect(detail).toEqual({
      name: "Example University",
      category: "University",
      ratingLabel: "4.2 stars ",
      reviewsLabel: "1,262 reviews",
      reviewsText: "(1,262)",
      address: "Tondan Marg, Sarfarazganj, Lucknow, Uttar Pradesh 226003",
      phoneItemId: "phone:tel:08957926677",
      websiteHref: "http://www.example.edu.in/",
    });

    document.body.innerHTML = resultsHtml();
    const card = readResultCards(document)[0]!;
    expect(buildListing(card, detail, "University", allFields)).toEqual({
      name: "Example University",
      category: "University",
      phone: "08957926677",
      email: null,
      website: "http://www.example.edu.in/",
      address: "Tondan Marg, Sarfarazganj, Lucknow, Uttar Pradesh 226003",
      city: "Lucknow",
      state: "Uttar Pradesh",
      country: "India",
      postalCode: "226003",
      latitude: 26.8635706,
      longitude: 80.9361191,
      rating: 4.2,
      reviewCount: 1262,
      mapsUrl: PLACE_HREF_A.split("?")[0],
      placeId: "ChIJexampleAAAAAAAAAAAAAA",
      searchKeyword: "University",
      source: "google_maps",
      clientKey: "0x399bfd99491cd3df:0xef84c13754ef7e48",
    });
  });

  it("stores null for anything missing — never invents values", () => {
    document.body.innerHTML = detailHtml({
      name: "Sample College",
      category: null,
      rating: null,
      address: null,
      phoneId: null,
      website: null,
    });
    const detail = readDetailFields(findDetailPanel(document)!);
    document.body.innerHTML = resultsHtml();
    const listing = buildListing(readResultCards(document)[1]!, detail, "College", allFields);
    expect(listing).toMatchObject({
      name: "Sample College",
      category: null,
      phone: null,
      email: null,
      website: null,
      address: null,
      city: null,
      state: null,
      country: null,
      postalCode: null,
      rating: null,
      reviewCount: null,
    });
    // Coordinates and ids come from the card link, so they are still present.
    expect(listing.latitude).toBe(26.8519904);
  });

  it("does not take WhatsApp/booking links as the website", () => {
    document.body.innerHTML = detailHtml({ name: "X", website: null });
    expect(readDetailFields(findDetailPanel(document)!).websiteHref).toBeNull();
  });

  it("respects unchecked fields (name is always kept)", () => {
    document.body.innerHTML = detailHtml({ name: "Example University", address: "A, Lucknow, Uttar Pradesh 226003" });
    const detail = readDetailFields(findDetailPanel(document)!);
    document.body.innerHTML = resultsHtml();
    const fields = { ...allFields, phone: false, website: false, city: false, rating: false, mapsUrl: false };
    const listing = buildListing(readResultCards(document)[0]!, detail, "University", fields);
    expect(listing).toMatchObject({ name: "Example University", phone: null, website: null, city: null, rating: null, mapsUrl: null });
    expect(listing.state).toBe("Uttar Pradesh");
    expect(listing.reviewCount).toBe(1262);
  });
});

describe("DomMapsPage.listEnd", () => {
  it("detects end of list and the signed-out limited view", () => {
    document.body.innerHTML = resultsHtml();
    expect(new DomMapsPage(document).listEnd()).toBeNull();
    document.body.innerHTML = resultsHtml({ end: "end" });
    expect(new DomMapsPage(document).listEnd()).toBe("end_of_list");
    document.body.innerHTML = resultsHtml({ end: "limited" });
    expect(new DomMapsPage(document).listEnd()).toBe("limited_view");
  });
});

describe("detectChallenge", () => {
  const maps = { hostname: "www.google.com", pathname: "/maps/search/x" };

  it("is null on a normal Maps page", () => {
    document.body.innerHTML = resultsHtml();
    expect(detectChallenge(document, maps)).toBeNull();
  });

  it("detects reCAPTCHA, the /sorry page, unusual-traffic text and consent", () => {
    document.body.innerHTML = `<iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe>`;
    expect(detectChallenge(document, maps)).toBe("captcha");

    document.body.innerHTML = "";
    expect(detectChallenge(document, { hostname: "www.google.com", pathname: "/sorry/index" })).toBe("captcha");

    document.body.innerHTML = "<p>Our systems have detected unusual traffic from your computer network.</p>";
    expect(detectChallenge(document, maps)).toBe("unusual_traffic");

    document.body.innerHTML = `<form action="https://consent.google.com/save"></form>`;
    expect(detectChallenge(document, maps)).toBe("consent");
  });
});

// @vitest-environment happy-dom
import { defaultCollectorSettings, validateCollectorSettings } from "@platform/shared";
import { describe, expect, it } from "vitest";
import { addGrListings, composeGrotalLead, type GrStoredList } from "../src/background/grotalRunner";
import {
  detectBlock,
  findCity,
  grotalSearchUrl,
  hasNextPage,
  isGrotalListUrl,
  nextPageUrl,
  parseCities,
  phoneOf,
  readListings,
  readProfile,
  searchOfUrl,
} from "../src/content/grotal/listing";
import type { SearchPlace } from "../src/content/maps/searchData";

// Shaped like grotal.com's result cards (2026-11-28): a name that opens the business page,
// area, address, phone and categories; advertisement rows have no header.
const card = (id: number, name: string, phone = "09313410164") => `
  <div class="result-row">
    <div class="title" id="divTitle${id}"><div class="glListingHeader">
      <div class="cursor" onclick='javascript:Navigate("Website-of-${name.replace(/ /g, "-")}-in-Delhi-${id}/");'>${name}</div>
    </div></div>
    <div class="starRatings"><span class="starRatingsNon"></span></div>
    <div class="area gl-listing-new-list"><i class="fa fa-map-marker"></i> Karol Bagh</div>
    <div class="address gl-listing-new-list"><i class="fa fa-map-marker"></i> Shop No 12, Bawa Plaza, Karol Bagh, Delhi</div>
    <div class="ph-no" id="divPhone${id}"><i class="fa fa-phone"></i>${phone}</div>
    <div class="desc gl-listing-new-list"><i class="fa fa-file"></i> <b>Mobile Phone Dealers</b>,
      <a class="blackA lnkcol" href="/Delhi/x-C44A0P1A0/">${name}</a>, <a class="blackA lnkcol" href="/Delhi/Cell-Phones-C44A0P1A0/">Cell Phones</a></div>
  </div>`;
const ad = `<div class="result-row"><div class="MidAdvertisementSponsoredCSS">Sponsored Links</div><iframe></iframe></div>`;
const pager = (pages: number[]) => pages.map((p) => `<a href="https://www.grotal.com/Delhi/Mobile-Phone-Dealers-C44A267P${p}A0/">${p}</a>`).join(" ");
const page = (body: string) => new DOMParser().parseFromString(`<html><head><title>Mobile Phone Dealers in Karol Bagh Delhi</title></head><body>${body}</body></html>`, "text/html");
const LIST_URL = "https://www.grotal.com/Delhi/Mobile-Phone-Dealers-C44A267P1A0/";

describe("Grotal result page", () => {
  it("reads every business card and skips advertisement rows", () => {
    const doc = page(card(338137, "Sri Sai Telecom") + ad + card(285613, "Hot Spot Mobile Store", "undefined") + pager([2, 3]));
    const [first, second, ...rest] = readListings(doc);
    expect(rest).toEqual([]);
    expect(first).toEqual({
      id: "338137",
      name: "Sri Sai Telecom",
      area: "Karol Bagh",
      address: "Shop No 12, Bawa Plaza, Karol Bagh, Delhi",
      phone: "09313410164",
      categories: "Mobile Phone Dealers, Cell Phones",
      profileUrl: "https://www.grotal.com/Website-of-Sri-Sai-Telecom-in-Delhi-338137/",
    });
    // "undefined" on the card means Grotal shows no number.
    expect(second!.phone).toBeNull();
    expect(hasNextPage(doc, LIST_URL)).toBe(true);
    expect(hasNextPage(page(card(1, "A") + pager([1])), "https://www.grotal.com/Delhi/Mobile-Phone-Dealers-C44A267P2A0/")).toBe(false);
  });

  it("builds Grotal's addresses: search, next page, a pasted link", () => {
    expect(grotalSearchUrl("Mobile phone dealers", { name: "Mumbai", id: "45" })).toBe("https://www.grotal.com/Mumbai/mobile-phone-dealers-C45A0P1A0/");
    expect(grotalSearchUrl("Study Visa Consultants", { name: "Navi Mumbai", id: "120" })).toBe("https://www.grotal.com/Navi-Mumbai/study-visa-consultants-C120A0P1A0/");
    expect(nextPageUrl(LIST_URL)).toBe("https://www.grotal.com/Delhi/Mobile-Phone-Dealers-C44A267P2A0/");
    expect(nextPageUrl("https://www.grotal.com/Delhi/x-C44A0P9A0")).toBe("https://www.grotal.com/Delhi/x-C44A0P10A0");
    expect(nextPageUrl("https://www.grotal.com/")).toBeNull();
    expect(isGrotalListUrl(LIST_URL)).toBe(true);
    expect(isGrotalListUrl("https://www.justdial.com/Delhi/Mobile-Phone-Dealers")).toBe(false);
    expect(searchOfUrl(LIST_URL)).toEqual({ keyword: "Mobile Phone Dealers", city: "Delhi" });
  });

  it("finds the city in Grotal's own list", () => {
    const cities = parseCities('<result><City name="Bangalore" id="67" /><City name="Delhi" id="44" /><City name="Mumbai" id="45" /><City name="Mysore" id="90" /></result>');
    expect(cities).toHaveLength(4);
    expect(findCity(cities, "delhi")).toEqual({ name: "Delhi", id: "44" });
    expect(findCity(cities, "New Delhi")?.id).toBe("44");
    expect(findCity(cities, "Bengaluru")?.id).toBe("67");
    expect(findCity(cities, "Mum")?.id).toBe("45");
    expect(findCity(cities, "Atlantis")).toBeNull();
  });

  it("reads one phone number", () => {
    expect(phoneOf("09313410164, 011-2345-6789")).toBe("09313410164");
    expect(phoneOf("+91 98110 12345")).toBe("+919811012345");
    expect(phoneOf("NA")).toBeNull();
  });
});

describe("Grotal business page", () => {
  it("reads address, phone, contact person, email and website; NA means none", () => {
    const doc = page(`<h1>Sri Sai Telecom</h1><div>Address :</div><div>Shop No 12, Basement, Bawa Plaza, Karol Bagh, Delhi</div>
      <div>Phone No:</div><div>01125805214</div><div>Contact Person:</div><div>Ramesh Kumar</div>
      <div>Email Id:</div><div>info@srisaitelecom.in</div><div>Website:</div><div>www.srisaitelecom.in</div>
      <div>Enter Image Text:</div><a href="https://www.facebook.com/grotal">Website</a>`);
    expect(readProfile(doc)).toEqual({
      address: "Shop No 12, Basement, Bawa Plaza, Karol Bagh, Delhi",
      phone: "01125805214",
      contactPerson: "Ramesh Kumar",
      email: "info@srisaitelecom.in",
      website: "http://www.srisaitelecom.in/",
    });
    const empty = readProfile(page(`<div>Phone No:</div><div>01125805214</div><div>Contact Person:</div><div>NA</div><div>Email Id:</div><div>NA</div>`));
    expect(empty).toMatchObject({ contactPerson: null, email: null, website: null });
    // A review form's picture code is not a block; a block page is.
    expect(detectBlock(doc)).toBeNull();
    expect(detectBlock(page("<h1>Access Denied</h1>"))).toBe("access_denied");
    // Grotal's invisible reCAPTCHA on a normal list page is not a block; a check page without content is.
    const recaptcha = `<iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe>`;
    expect(detectBlock(page(card(1, "A One") + recaptcha))).toBeNull();
    expect(detectBlock(page(`<p>One more step</p>${recaptcha}`))).toBe("captcha");
  });
});

describe("one lead from Grotal", () => {
  const ctx = { keyword: "Mobile Phone Dealers", location: "Delhi", fields: defaultCollectorSettings().fields };
  const listing = readListings(page(card(338137, "Sri Sai Telecom")))[0]!;
  const maps = { name: "Sri Sai Telecom", phone: "+91 11 2580 5214", website: "https://srisai.example", rating: 4.2, reviewCount: 31, latitude: 28.65, longitude: 77.19, placeId: "ChIJ1", address: null, category: "Mobile phone shop" } as unknown as SearchPlace;

  it("keeps Grotal's number, adds the Maps website and rating", () => {
    const lead = composeGrotalLead(listing, null, maps, ctx);
    expect(lead).toMatchObject({ name: "Sri Sai Telecom", phone: "09313410164", website: "https://srisai.example", rating: 4.2, reviewCount: 31, source: "grotal", clientKey: "gr:338137", category: "Mobile Phone Dealers", searchKeyword: "Mobile Phone Dealers", placeId: "ChIJ1" });
    expect(lead.mapsUrl).toContain("ChIJ1");
  });

  it("works without Maps, and respects unticked fields", () => {
    const lead = composeGrotalLead(listing, { address: null, phone: null, contactPerson: null, email: "info@srisai.in", website: null }, null, { ...ctx, fields: { ...ctx.fields, phone: false } });
    expect(lead).toMatchObject({ phone: null, email: "info@srisai.in", website: null, rating: null, address: "Shop No 12, Bawa Plaza, Karol Bagh, Delhi", mapsUrl: null });
  });

  it("adds only businesses not read yet", () => {
    const list: GrStoredList = { listings: [], nextUrl: null, pages: 0, done: false };
    const known = new Set<string>();
    const all = readListings(page(card(1, "A One") + card(2, "B Two")));
    expect(addGrListings(list, all, known)).toBe(2);
    expect(addGrListings(list, all, known)).toBe(0);
    expect(list.listings.map((l) => l.id)).toEqual(["1", "2"]);
  });
});

describe("Grotal settings", () => {
  it("needs a city, unless the keyword is a Grotal list link", () => {
    const base = { ...defaultCollectorSettings(), source: "grotal" as const, keyword: "Mobile Phone Dealers" };
    expect(validateCollectorSettings(base).location).toMatch(/city/);
    expect(validateCollectorSettings({ ...base, location: "Delhi" }).location).toBeUndefined();
    expect(validateCollectorSettings({ ...base, keyword: LIST_URL }).location).toBeUndefined();
  });
});

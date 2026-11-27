// @vitest-environment happy-dom
import { defaultCollectorSettings, validateCollectorSettings } from "@platform/shared";
import { describe, expect, it } from "vitest";
import { addSuListings, composeSulekhaLead, landedOnPage, type SuStoredList } from "../src/background/sulekhaRunner";
import {
  chooseCategory,
  detectBlock,
  isSulekhaListUrl,
  keywordWords,
  listBase,
  pageNumberOf,
  pageUrl,
  readListings,
  readProfile,
  relatedCategories,
  sameWords,
  searchOfUrl,
  suggestUrl,
  sulekhaCity,
} from "../src/content/sulekha/listing";
import type { SearchPlace } from "../src/content/maps/searchData";

// Shaped like sulekha.com on 2026-11-28: lists carry a schema.org ItemList, business pages a
// LocalBusiness with telephone, address, geo and rating.
const ld = (o: unknown) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
const item = (i: number, name: string, area: string) => ({
  "@type": "ListItem",
  position: i,
  item: {
    "@type": "LocalBusiness",
    name,
    description: `${name} in Delhi`,
    address: { "@type": "PostalAddress", addressLocality: area, addressRegion: "Delhi", postalCode: "110018", addressCountry: "IN" },
    url: `https://www.sulekha.com/${name.toLowerCase().replace(/ /g, "-")}-${area.toLowerCase().replace(/ /g, "-")}-delhi-contact-address`,
  },
});
const listPage = (items: unknown[]) =>
  page(
    ld({ "@context": "https://schema.org", "@graph": [{ "@type": "Organization", name: "Sulekha.com" }, { "@type": "ItemList", name: "Used Mobile Phone Dealers in Delhi", numberOfItems: items.length, itemListElement: items }] }) +
      "<h1>Used Mobile Phone Dealers in Delhi</h1>",
  );
const profilePage = (extra: Record<string, unknown> = {}, body = "") =>
  page(
    ld({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "Organization", name: "Sulekha.com", telephone: "08069868480" },
        {
          "@type": "LocalBusiness",
          url: "https://www.sulekha.com/infotech-gallery-vikaspuri-delhi-contact-address",
          name: "Infotech Gallery",
          address: { "@type": "PostalAddress", streetAddress: "DDA Commercial Complex, Plot No. 39, Near Syndicate Bank, Vikaspuri, Delhi - 110018", addressLocality: "Delhi", postalCode: "110018", addressCountry: "IN" },
          telephone: "+919811607608",
          contactPoint: { "@type": "ContactPoint", telephone: "+919811607608" },
          geo: { "@type": "GeoCoordinates", latitude: 28.6111824, longitude: 77.1091522 },
          aggregateRating: { "@type": "AggregateRating", ratingValue: 4, reviewCount: 1 },
          sameAs: ["https://www.facebook.com/infotech", "https://www.infotechgallery.example.in/"],
          ...extra,
        },
      ],
    }) + (body || "<h1>Infotech Gallery Vikaspuri, Delhi</h1><div>Contact Information</div><div>Contact Person</div><div>Ravideep Singh</div><div>Address</div><div>DDA Commercial Complex</div>"),
  );
const page = (body: string, title = "Sulekha") => new DOMParser().parseFromString(`<html><head><title>${title}</title></head><body>${body}</body></html>`, "text/html");

describe("Sulekha list page", () => {
  it("reads the businesses from the page's ItemList", () => {
    const [first, ...rest] = readListings(listPage([item(1, "Jain Electronics", "Green Park"), item(2, "Infotech Gallery", "Vikaspuri"), item(3, "Jain Electronics", "Green Park")]));
    expect(first).toEqual({
      id: "jain-electronics-green-park-delhi",
      name: "Jain Electronics",
      area: "Green Park",
      pincode: "110018",
      profileUrl: "https://www.sulekha.com/jain-electronics-green-park-delhi-contact-address",
    });
    // The same business twice is read once.
    expect(rest.map((l) => l.name)).toEqual(["Infotech Gallery"]);
    expect(readListings(page("<h1>Nothing</h1>"))).toEqual([]);
  });

  it("knows Sulekha's list addresses and their pages", () => {
    const base = "https://www.sulekha.com/used-mobile-phone-dealers/delhi";
    expect(pageNumberOf(base)).toBe(1);
    expect(pageNumberOf(`${base}/page-3`)).toBe(3);
    expect(pageNumberOf("https://www.sulekha.com/infotech-gallery-vikaspuri-delhi-contact-address")).toBeNull();
    expect(pageUrl(base, 1)).toBe(base);
    expect(pageUrl(`${base}/page-4`, 2)).toBe(`${base}/page-2`);
    expect(listBase(`${base}/page-7`)).toBe(base);
    expect(isSulekhaListUrl(base)).toBe(true);
    expect(isSulekhaListUrl("Used mobile phone dealers")).toBe(false);
    expect(searchOfUrl("https://www.sulekha.com/student-visa-consultants/greater-noida/page-2")).toEqual({ keyword: "Student Visa Consultants", city: "Greater Noida" });
    // Past the end Sulekha shows page 1 again: that is not page 10.
    expect(landedOnPage(base, 10)).toBe(false);
    expect(landedOnPage(`${base}/page-10`, 10)).toBe(true);
  });
});

describe("Sulekha business page", () => {
  it("reads phone, address, position, rating, contact person and website", () => {
    expect(readProfile(profilePage())).toEqual({
      name: "Infotech Gallery",
      address: "DDA Commercial Complex, Plot No. 39, Near Syndicate Bank, Vikaspuri, Delhi - 110018",
      phone: "+919811607608",
      latitude: 28.6111824,
      longitude: 77.1091522,
      rating: 4,
      reviewCount: 1,
      contactPerson: "Ravideep Singh",
      website: "https://www.infotechgallery.example.in/",
    });
    // Only social links: no website. Sulekha's own number is never taken.
    const p = readProfile(profilePage({ sameAs: ["https://www.instagram.com/x"], telephone: undefined, contactPoint: undefined, aggregateRating: undefined }, "<h1>x</h1>"));
    expect(p).toMatchObject({ phone: null, website: null, rating: null, contactPerson: null });
    expect(readProfile(page("<h1>Not a business</h1>"))).toBeNull();
  });

  it("recognises block pages, not normal pages", () => {
    expect(detectBlock(profilePage())).toBeNull();
    expect(detectBlock(page("<p>Checking your browser before accessing</p>", "Just a moment..."))).toBe("captcha");
    expect(detectBlock(page("<h1>Access Denied</h1>", "Access Denied"))).toBe("access_denied");
  });
});

describe("finding the Sulekha category for a keyword", () => {
  // Shaped like azsearch.sulekha.com/api/search/home-common-search-v2 answers.
  const answer = (rows: [string, string, string][]) => JSON.stringify({ result: rows.map(([title, url, docType]) => ({ title: [title], url, docType })) });

  it("takes the category with the keyword's words, skipping businesses and other Sulekha sites", () => {
    const body = answer([
      ["Mobile Rack Compactor Dealers", "https://www.sulekha.com/mobile-rack-compactor-dealers/delhi", "4"],
      ["CDMA Mobile Phone Dealers", "https://www.sulekha.com/cdma-mobile-phone-dealers/delhi", "4"],
      ["Mobile Phone Dealers/Services", "https://www.sulekha.com/mobile-phones-for-sale/delhi", "2"],
      ["Ravi Mobile Phone Dealers", "/ravi-mobile-karol-bagh-delhi-contact-address", "5"],
    ]);
    const { best, others } = chooseCategory(body, "Mobile Phone Dealers", "New Delhi");
    expect(best).toEqual({ title: "Mobile Phone Dealers/Services", url: "https://www.sulekha.com/mobile-phones-for-sale/delhi" });
    expect(others).toContain("CDMA Mobile Phone Dealers");
    expect(others).not.toContain("Ravi Mobile Phone Dealers");

    const movers = answer([
      ["House Shifting", "https://packersandmovers.sulekha.com/house-shifting-service-in-noida", "4"],
      ["Packers and Movers", "/packers-and-movers/noida", "2"],
    ]);
    expect(chooseCategory(movers, "packers movers", "Noida").best?.url).toBe("https://www.sulekha.com/packers-and-movers/noida");
    expect(chooseCategory("not json", "x", "Delhi").best).toBeNull();
    expect(chooseCategory(answer([["Yoga Classes", "/yoga-classes/delhi", "4"]]), "visa consultants", "Delhi").best).toBeNull();
  });

  it("knows when the choice is the keyword itself, and finds the main category in the breadcrumb", () => {
    const body = answer([["CDMA Mobile Phone Dealers", "https://www.sulekha.com/cdma-mobile-phone-dealers/delhi", "4"]]);
    expect(chooseCategory(body, "Mobile Phone Dealers", "Delhi").exact).toBe(false);
    expect(chooseCategory(answer([["Visa Consultants", "/visa-consultants/gurgaon", "4"]]), "visa consultant", "Gurugram").exact).toBe(true);
    expect(sameWords("Mobile Phone Dealers/Services", "mobile phone dealer")).toBe(true);
    expect(sameWords("CDMA Mobile Phone Dealers", "Mobile Phone Dealers")).toBe(false);
    expect(keywordWords("Mobile")).toBe(1);
    expect(keywordWords("Packers and Movers")).toBe(2);

    const doc = page(`<a href="https://www.sulekha.com/">Home</a> <a href="https://www.sulekha.com/mobile-phones-for-sale/delhi">Mobile Phone Dealers</a>
      <a href="https://www.sulekha.com/acer-cdma-mobile-phone-dealers/delhi">Acer Cdma Mobile Phone Dealers</a> <a href="/mobile-phones-for-sale/mumbai">Mobile Phone Dealers</a>
      <a href="https://www.sulekha.com/user/signin?next=x">Sign in</a> <a href="/jain-electronics-green-park-delhi-contact-address">Jain</a>`);
    const related = relatedCategories(doc, "https://www.sulekha.com/cdma-mobile-phone-dealers/delhi");
    expect(related).toEqual([
      { title: "Mobile Phone Dealers", url: "https://www.sulekha.com/mobile-phones-for-sale/delhi" },
      { title: "Acer Cdma Mobile Phone Dealers", url: "https://www.sulekha.com/acer-cdma-mobile-phone-dealers/delhi" },
    ]);
    expect(related.find((c) => sameWords(c.title, "Mobile Phone Dealers"))?.url).toBe("https://www.sulekha.com/mobile-phones-for-sale/delhi");
  });

  it("uses Sulekha's city names", () => {
    expect(sulekhaCity("Bengaluru")).toBe("bangalore");
    expect(sulekhaCity(" New  Delhi ")).toBe("delhi");
    expect(sulekhaCity("Gurugram")).toBe("gurgaon");
    expect(suggestUrl("visa consultants", "Gurugram")).toBe("https://azsearch.sulekha.com/api/search/home-common-search-v2?cityName=gurgaon&query=visa%20consultants&wt=json");
    expect(chooseCategory(JSON.stringify({ result: [{ title: ["Interior Designers"], url: "/interior-designers-decorators/greater noida", docType: "2" }] }), "interior designers", "Greater Noida").best?.url).toBe(
      "https://www.sulekha.com/interior-designers-decorators/greater-noida",
    );
  });
});

describe("one lead from Sulekha", () => {
  const ctx = { keyword: "Used Mobile Phone Dealers", location: "Delhi", category: "Used Mobile Phone Dealers", fields: defaultCollectorSettings().fields };
  const listing = readListings(listPage([item(1, "Infotech Gallery", "Vikaspuri")]))[0]!;
  const profile = readProfile(profilePage())!;
  const maps = { name: "Infotech Gallery", phone: "+91 11 4000 0000", website: "https://maps-site.example", rating: 4.4, reviewCount: 80, latitude: 28.61, longitude: 77.1, placeId: "ChIJ2", address: null, category: "Mobile phone shop" } as unknown as SearchPlace;

  it("keeps Sulekha's phone, position and rating; Maps adds what Sulekha lacks", () => {
    const lead = composeSulekhaLead(listing, profile, maps, ctx);
    expect(lead).toMatchObject({
      name: "Infotech Gallery",
      phone: "+919811607608",
      website: "https://www.infotechgallery.example.in/",
      latitude: 28.6111824,
      rating: 4,
      reviewCount: 1,
      category: "Used Mobile Phone Dealers",
      source: "sulekha",
      clientKey: `su:${listing.id}`,
      placeId: "ChIJ2",
    });
    expect(lead.address).toContain("Vikaspuri");
    const noSite = composeSulekhaLead(listing, { ...profile, website: null }, maps, ctx);
    expect(noSite.website).toBe("https://maps-site.example");
  });

  it("works with the list details only, and respects unticked fields", () => {
    const lead = composeSulekhaLead(listing, null, null, { ...ctx, fields: { ...ctx.fields, rating: false } });
    expect(lead).toMatchObject({ phone: null, rating: null, address: "Vikaspuri, Delhi, 110018", postalCode: "110018", mapsUrl: null });
  });

  it("adds only businesses not read yet", () => {
    const list: SuStoredList = { listings: [], base: null, category: null, nextPage: 1, pages: 0, done: false };
    const known = new Set<string>();
    const all = readListings(listPage([item(1, "A One", "Saket"), item(2, "B Two", "Saket")]));
    expect(addSuListings(list, all, known)).toBe(2);
    expect(addSuListings(list, all, known)).toBe(0);
  });
});

describe("Sulekha settings", () => {
  it("needs a city, unless the keyword is a Sulekha list link", () => {
    const base = { ...defaultCollectorSettings(), source: "sulekha" as const, keyword: "Visa Consultants" };
    expect(validateCollectorSettings(base).location).toMatch(/city/);
    expect(validateCollectorSettings({ ...base, location: "Ghaziabad" }).location).toBeUndefined();
    expect(validateCollectorSettings({ ...base, keyword: "https://www.sulekha.com/student-visa-consultants/ghaziabad" }).location).toBeUndefined();
  });
});

// @vitest-environment happy-dom
import { defaultCollectorSettings } from "@platform/shared";
import { describe, expect, it } from "vitest";
import { bestMapsMatch, distanceM, nameSimilarity } from "../src/background/jdMatch";
import { composeLead } from "../src/background/justdialRunner";
import { justdialSearchUrl, parseListingResponse } from "../src/content/justdial/listing";
import { detectBlock, digitsOf, readProfile } from "../src/content/justdial/profile";
import type { SearchPlace } from "../src/content/maps/searchData";

// Shaped like justdial.com's /api/resultsPageListing answer (columns + rows), 2026-11-20.
const COLUMNS = ["docid", "name", "NewAddress", "lat", "lon", "compRating", "area", "type", "VNumber", "totalReviews", "city", "thumbnail", "totJdReviews", "weburl", "pincode"];
const row = (i: number, extra: Partial<Record<string, unknown>> = {}) => {
  const v: Record<string, unknown> = {
    docid: `011PXX11.XX11.17052${i}.U7L2`,
    name: i === 1 ? "The Global Exposure" : `Visa Desk ${i}`,
    NewAddress: " Punjabi Bagh Extension",
    lat: "28.6667",
    lon: "77.1220",
    compRating: "4.5",
    area: "Punjabi Bagh Extension",
    type: "Visa Assistance, Immigration Consultants",
    VNumber: "",
    totalReviews: "209 Ratings",
    city: "delhi",
    thumbnail: "https://content.jdmagicbox.com/comp/def_content/visa.jpg",
    totJdReviews: "209",
    weburl: `Delhi/The-Global-Exposure/011PXX11-XX11-13051712461${i}-T2P4_BZDET`,
    pincode: "110026",
    ...extra,
  };
  return COLUMNS.map((c) => v[c]);
};
const answer = (rows: unknown[][]) => JSON.stringify({ results: { columns: COLUMNS, data: rows, rvs: [] } });

describe("Justdial result list", () => {
  it("reads each business from Justdial's own list data", () => {
    const [first, second] = parseListingResponse(answer([row(1), row(2, { VNumber: ["07947 124 983"], compRating: "0", lat: "0" })]));
    expect(first).toEqual({
      docid: "011PXX11.XX11.170521.U7L2",
      name: "The Global Exposure",
      area: "Punjabi Bagh Extension",
      address: "Punjabi Bagh Extension",
      pincode: "110026",
      city: "delhi",
      latitude: 28.6667,
      longitude: 77.122,
      rating: 4.5,
      reviewCount: 209,
      categories: "Visa Assistance, Immigration Consultants",
      profileUrl: "https://www.justdial.com/Delhi/The-Global-Exposure/011PXX11-XX11-130517124611-T2P4_BZDET",
      thumbnail: "https://content.jdmagicbox.com/comp/def_content/visa.jpg",
      phone: null,
    });
    expect(second).toMatchObject({ phone: "07947124983", rating: null, latitude: null });
  });

  it("ignores anything that is not a result list, and rows without a name", () => {
    expect(parseListingResponse("not json")).toEqual([]);
    expect(parseListingResponse(JSON.stringify({ results: {} }))).toEqual([]);
    expect(parseListingResponse(answer([row(3, { name: "" })]))).toEqual([]);
  });

  it("builds the search address Justdial uses", () => {
    expect(justdialSearchUrl("study visa consultants", "new delhi")).toBe("https://www.justdial.com/New-Delhi/Study-Visa-Consultants");
  });
});

const PROFILE = `
  <h1>The Global Exposure</h1>
  <div>Tutorials</div><div>4.5</div><div>209 Ratings</div>
  <div>Open until 7:00 pm</div>
  <div id="header_shownumber">Show Number</div>
  <img src="https://content.jdmagicbox.com/v2/comp/delhi/p4/011pxx11.xx11.130517124611.t2p4/catalogue/a.jpg">
  <img src="https://content.jdmagicbox.com/v2/comp/delhi/p4/011pxx11.xx11.130517124611.t2p4/catalogue/b.jpg">
  <img src="https://content.jdmagicbox.com/images/icontent/newwap/web2022/call.svg">
  <section><div>Contact</div><div>Show Number</div></section>
  <section><div>Address</div><div>19 NWA, Club Road, Punjabi Bagh Extension, Delhi-110026</div><div>Get Directions</div></section>
  <section><div>Website</div><a href="https://www.theglobalexposure.com/">Visit our Website</a></section>
  <section><div>Follow us</div><a href="https://www.facebook.com/globalexposure">Facebook</a></section>
  <section><div>Year of Establishment</div><div>1999</div></section>
  <aside><div>People also viewed</div><a href="tel:09999911111">09999911111</a> WhatsApp</aside>
  <iframe src="https://www.google.com/recaptcha/api2/aframe" style="display:none"></iframe>`;

describe("Justdial business page", () => {
  it("reads address, website, year, timings and photo links", () => {
    document.body.innerHTML = PROFILE.replace(/\n\s*/g, "\n");
    // happy-dom has no layout, so innerText = textContent; give each block its own line.
    document.querySelectorAll("div, section, h1").forEach((e) => e.insertAdjacentText("afterend", "\n"));
    expect(readProfile(document)).toEqual({
      name: "The Global Exposure",
      address: "19 NWA, Club Road, Punjabi Bagh Extension, Delhi-110026",
      website: "https://www.theglobalexposure.com/",
      established: "1999",
      hours: "Open until 7:00 pm",
      photos: [
        "https://content.jdmagicbox.com/v2/comp/delhi/p4/011pxx11.xx11.130517124611.t2p4/catalogue/a.jpg",
        "https://content.jdmagicbox.com/v2/comp/delhi/p4/011pxx11.xx11.130517124611.t2p4/catalogue/b.jpg",
      ],
      phone: null,
    });
  });

  it("reads a number once it is shown, and recognises blocks", () => {
    expect(digitsOf("07947124983")).toBe("07947124983");
    expect(digitsOf("+91 98100 00001")).toBe("+919810000001");
    expect(digitsOf("Show Number")).toBeNull();
    // The hidden reCAPTCHA frame every Justdial page has is not a security check.
    document.body.innerHTML = PROFILE;
    expect(detectBlock(document)).toBeNull();
    document.getElementById("header_shownumber")!.textContent = "07947124983";
    expect(readProfile(document).phone).toBe("07947124983");
    document.body.innerHTML = `<h1>Access Denied</h1><p>You don't have permission to access this server.</p>`;
    expect(detectBlock(document)).toBe("access_denied");
  });
});

const place = (over: Partial<SearchPlace>): SearchPlace => ({
  featureId: "0x1:0x2",
  placeId: "ChIJglobal",
  name: "THE GLOBAL EXPOSURE",
  category: "Education consultant",
  phone: "01145012345",
  website: "https://theglobalexposure.com/",
  address: "19, Club Rd, Punjabi Bagh Extension, Punjabi Bagh, New Delhi, Delhi 110026",
  latitude: 28.66675,
  longitude: 77.12202,
  rating: 4.6,
  reviewCount: 980,
  ...over,
});

describe("matching a Justdial business on Google Maps", () => {
  const jd = { name: "The Global Exposure", latitude: 28.6667, longitude: 77.122 };

  it("takes the same name close by", () => {
    expect(nameSimilarity("The Global Exposure", "THE GLOBAL EXPOSURE")).toBe(1);
    expect(distanceM(28.6667, 77.122, 28.67, 77.122)).toBeGreaterThan(300);
    const near = place({});
    const other = place({ featureId: "0x9:0x9", name: "Global Visa Point", latitude: 28.6668, longitude: 77.1221 });
    expect(bestMapsMatch(jd, [other, near])).toBe(near);
  });

  it("refuses a same-named business far away, or a different name", () => {
    expect(bestMapsMatch(jd, [place({ latitude: 28.5, longitude: 77.3 })])).toBeNull();
    expect(bestMapsMatch(jd, [place({ name: "Exposure Studio Photography" })])).toBeNull();
    expect(bestMapsMatch({ ...jd, latitude: null, longitude: null }, [place({})])).not.toBeNull();
  });
});

describe("one lead from Justdial + Google Maps", () => {
  it("prefers the Maps phone and keeps Justdial's own details", () => {
    const [l] = parseListingResponse(answer([row(1, { VNumber: "07947124983" })]));
    const profile = { name: "The Global Exposure", address: "19 NWA, Club Road, Punjabi Bagh Extension, Delhi-110026", website: null, established: "1999", hours: "Open until 7:00 pm", photos: ["https://content.jdmagicbox.com/v2/comp/a.jpg"], phone: null };
    const { lead, justdial } = composeLead(l!, profile, place({}), { keyword: "Study Visa Consultants", location: "Delhi", fields: defaultCollectorSettings().fields });
    expect(lead).toMatchObject({
      name: "The Global Exposure",
      category: "Visa Assistance",
      phone: "01145012345",
      website: "https://theglobalexposure.com/",
      address: "19 NWA, Club Road, Punjabi Bagh Extension, Delhi-110026",
      city: "New Delhi", // from the Maps address
      state: "Delhi",
      postalCode: "110026",
      rating: 4.5,
      reviewCount: 209,
      placeId: "ChIJglobal",
      source: "justdial",
      clientKey: "jd:011PXX11.XX11.170521.U7L2",
      searchKeyword: "Study Visa Consultants",
    });
    expect(justdial).toMatchObject({ jdPhone: "07947124983", established: "1999", mapsMatched: true, mapsRating: 4.6, mapsPhone: "01145012345", photos: ["https://content.jdmagicbox.com/v2/comp/a.jpg"] });
  });

  it("works without Maps or a profile, and respects unticked fields", () => {
    const [l] = parseListingResponse(answer([row(2)]));
    const fields = { ...defaultCollectorSettings().fields, phone: false };
    const { lead, justdial } = composeLead({ ...l!, phone: "07947000000" }, null, null, { keyword: "k", location: "Delhi", fields });
    expect(lead).toMatchObject({ phone: null, address: "Punjabi Bagh Extension", city: "Delhi", postalCode: "110026", mapsUrl: null, placeId: null });
    expect(justdial).toMatchObject({ mapsMatched: false, jdPhone: "07947000000", photos: ["https://content.jdmagicbox.com/comp/def_content/visa.jpg"] });
  });
});

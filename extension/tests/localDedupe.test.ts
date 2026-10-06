import { describe, expect, it } from "vitest";
import { checkLocalDuplicate, type SeenIndex } from "../src/background/localDedupe";
import type { ExtractedListing } from "../src/content/maps/types";

const listing = (name: string, extra: Partial<ExtractedListing> = {}): ExtractedListing => ({
  name, category: null, phone: null, email: null, website: null, address: null, city: null, state: null,
  country: null, postalCode: null, latitude: null, longitude: null, rating: null, reviewCount: null,
  mapsUrl: null, placeId: null, searchKeyword: "University", source: "google_maps", clientKey: name, ...extra,
});

describe("checkLocalDuplicate", () => {
  it("flags a listing sharing a phone with an earlier one in the run", async () => {
    let index: SeenIndex = {};
    const a = await checkLocalDuplicate(index, listing("ERA University", { phone: "08957926677" }));
    expect(a.duplicateOf).toBeNull();
    index = a.index;

    const b = await checkLocalDuplicate(index, listing("Era Univ", { phone: "+91 89579 26677" }));
    expect(b.duplicateOf).toEqual({ name: "ERA University", by: "phone" });
  });

  it("follows the backend rule: different placeIds are not duplicates", async () => {
    const a = await checkLocalDuplicate({}, listing("ERA University", { placeId: "P1", phone: "08957926677" }));
    const b = await checkLocalDuplicate(a.index, listing("ERA Medical", { placeId: "P2", phone: "08957926677" }));
    expect(b.duplicateOf).toBeNull();
  });

  it("does not flag by name alone", async () => {
    const a = await checkLocalDuplicate({}, listing("City College"));
    expect((await checkLocalDuplicate(a.index, listing("City College"))).duplicateOf).toBeNull();
  });
});

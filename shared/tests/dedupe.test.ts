import { describe, expect, it } from "vitest";
import { confirmsMatch, dedupeKeys, findDuplicate, primaryDedupeKey, type DedupeInput, type MatchedBy } from "../src/index.js";

const era: DedupeInput = {
  placeId: "ChIJera",
  name: "ERA University",
  phone: "089579 26677",
  website: "http://www.erauniversity.in/",
  address: "Tondan Marg, Sarfarazganj, Lucknow, Uttar Pradesh 226003",
};

describe("dedupeKeys / primaryDedupeKey", () => {
  it("builds every key from normalized values", () => {
    expect(dedupeKeys(era)).toEqual({
      placeId: "ChIJera",
      phone: "+918957926677",
      website: "erauniversity.in",
      nameAddress: "era university|tondan marg sarfarazganj lucknow uttar pradesh 226003",
    });
    expect(primaryDedupeKey(dedupeKeys(era))).toBe("pid:ChIJera");
  });

  it("falls back down the priority list", () => {
    expect(primaryDedupeKey(dedupeKeys({ ...era, placeId: null }))).toBe("ph:+918957926677");
    expect(primaryDedupeKey(dedupeKeys({ ...era, placeId: null, phone: null }))).toBe("web:erauniversity.in");
    expect(primaryDedupeKey(dedupeKeys({ ...era, placeId: null, phone: null, website: null }))).toMatch(/^na:era university\|/);
  });

  it("has no key for a name alone — similar names are never merged", () => {
    const keys = dedupeKeys({ name: "ERA University" });
    expect(keys).toEqual({ placeId: null, phone: null, website: null, nameAddress: null });
    expect(primaryDedupeKey(keys)).toBeNull();
  });

  it("ignores toll-free phones and non-identifying links as keys", () => {
    const keys = dedupeKeys({ name: "X", phone: "1800 123 4567", website: "https://wa.me/919800000000" });
    expect(keys.phone).toBeNull();
    expect(keys.website).toBeNull();
  });
});

describe("confirmsMatch", () => {
  it("different placeIds are never the same business, except via placeId itself", () => {
    expect(confirmsMatch("A", "B", "phone")).toBe(false);
    expect(confirmsMatch("A", "B", "website")).toBe(false);
    expect(confirmsMatch("A", "B", "nameAddress")).toBe(false);
    expect(confirmsMatch("A", "A", "placeId")).toBe(true);
  });

  it("a missing placeId on either side does not block a match", () => {
    expect(confirmsMatch(null, "B", "phone")).toBe(true);
    expect(confirmsMatch("A", null, "website")).toBe(true);
    expect(confirmsMatch(null, null, "nameAddress")).toBe(true);
  });
});

describe("findDuplicate", () => {
  type Rec = { id: string; placeId: string | null; keys: Record<MatchedBy, string | null> };
  const store: Rec[] = [];
  const add = (id: string, input: DedupeInput) => store.push({ id, placeId: input.placeId ?? null, keys: dedupeKeys(input) });
  const lookup = (by: MatchedBy, value: string) => store.filter((r) => r.keys[by] === value);

  add("era", era);
  add("amity-lko", { placeId: "ChIJamityL", name: "Amity University Lucknow", website: "https://www.amity.edu/lucknow/" });
  add("noplace", { placeId: null, name: "City College", phone: "0522 400 0000", address: "Hazratganj, Lucknow" });

  it("matches by placeId first", async () => {
    const r = await findDuplicate(dedupeKeys({ ...era, phone: null }), lookup);
    expect(r).toMatchObject({ record: { id: "era" }, matchedBy: "placeId" });
  });

  it("matches the same listing seen again without placeId by phone", async () => {
    const r = await findDuplicate(dedupeKeys({ name: "Era Univ.", phone: "+91 89579 26677" }), lookup);
    expect(r).toMatchObject({ record: { id: "era" }, matchedBy: "phone" });
  });

  it("does not merge another branch with a different placeId sharing the phone", async () => {
    const r = await findDuplicate(dedupeKeys({ placeId: "ChIJeraMedical", name: "ERA Medical College", phone: "08957926677" }), lookup);
    expect(r).toBeNull();
  });

  it("keeps campuses on the same domain apart", async () => {
    const noida = await findDuplicate(dedupeKeys({ name: "Amity Noida", website: "https://www.amity.edu/noida/" }), lookup);
    expect(noida).toBeNull();
    const lko = await findDuplicate(dedupeKeys({ name: "Amity", website: "amity.edu/lucknow?utm=x" }), lookup);
    expect(lko).toMatchObject({ record: { id: "amity-lko" }, matchedBy: "website" });
  });

  it("matches by normalized name + address", async () => {
    const r = await findDuplicate(
      dedupeKeys({ name: "CITY  COLLEGE", address: "Hazratganj,  Lucknow, India" }),
      lookup,
    );
    expect(r).toMatchObject({ record: { id: "noplace" }, matchedBy: "nameAddress" });
  });

  it("same name at a different address is a different business", async () => {
    expect(await findDuplicate(dedupeKeys({ name: "City College", address: "Gomti Nagar, Lucknow" }), lookup)).toBeNull();
  });
});

// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { readSearchResults, searchKind, searchUrl } from "../src/content/facebook";

// Facebook search results: a feed of result blocks, each with the entity link (name) and a
// "·"-separated details line. Class names are generated, so the fixture has none.
const feed = (items: string) => `<div role="main"><div role="feed">${items}</div></div>`;

describe("Facebook search results", () => {
  it("builds search links and recognises the search type", () => {
    expect(searchUrl("group", "lucknow foodies")).toBe("https://www.facebook.com/search/groups/?q=lucknow%20foodies");
    expect(searchKind("https://www.facebook.com/search/pages/?q=x")).toBe("page");
    expect(searchKind("https://www.facebook.com/AcmeBakery")).toBeNull();
  });

  it("reads Pages with category and followers", () => {
    document.body.innerHTML = feed(`
      <div><a href="https://www.facebook.com/AcmeBakery?__tn__=x"><span>Acme Bakery</span></a><span>Page · Bakery · 1.2K followers</span><span>Fresh cakes daily in Gomti Nagar</span><div role="button">Like</div></div>
      <div><a href="https://www.facebook.com/profile.php?id=100064&amp;ref=x">Sweet Tooth Lucknow</a><span>Page · Dessert shop · 830 followers</span></div>`);
    const r = readSearchResults(document, "https://www.facebook.com/search/pages/?q=bakery%20lucknow");
    expect(r).toEqual([
      expect.objectContaining({ kind: "page", url: "https://www.facebook.com/acmebakery", handle: "acmebakery", name: "Acme Bakery", category: "Bakery", followers: 1200, audienceText: "1.2K followers" }),
      expect.objectContaining({ kind: "page", url: "https://www.facebook.com/profile.php?id=100064", name: "Sweet Tooth Lucknow", category: "Dessert shop", followers: 830 }),
    ]);
  });

  it("reads groups (privacy and members) without any member list", () => {
    document.body.innerHTML = feed(`
      <div><a href="https://www.facebook.com/groups/lucknowfoodies/?ref=search">Lucknow Foodies</a><span>Public · 45K members · 10+ posts a day</span><div role="button">Join</div></div>
      <div><a href="https://www.facebook.com/groups/123456789/">Home Bakers India</a><span>Private · 2.3K members</span></div>`);
    const r = readSearchResults(document, "https://www.facebook.com/search/groups/?q=bakers");
    expect(r.map((g) => [g.url, g.name, g.privacy, g.followers])).toEqual([
      ["https://www.facebook.com/groups/lucknowfoodies", "Lucknow Foodies", "public", 45000],
      ["https://www.facebook.com/groups/123456789", "Home Bakers India", "private", 2300],
    ]);
  });

  it("reads people results with the location shown", () => {
    document.body.innerHTML = feed(`
      <div><a href="https://www.facebook.com/rohan.mehta.77">Rohan Mehta</a><span>Lives in Lucknow, Uttar Pradesh</span><div role="button">Add friend</div></div>
      <div><a href="https://www.facebook.com/groups/abc/">A group link inside a people result</a></div>`);
    const r = readSearchResults(document, "https://www.facebook.com/search/people/?q=rohan");
    expect(r).toEqual([expect.objectContaining({ kind: "profile", url: "https://www.facebook.com/rohan.mehta.77", name: "Rohan Mehta", location: "Lucknow, Uttar Pradesh" })]);
  });
});

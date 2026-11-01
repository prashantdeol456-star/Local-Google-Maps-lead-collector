import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NAV } from "../src/components/nav";
import { GUIDE, guideSectionFor, PAGES_WITHOUT_GUIDE } from "../src/guide/content";

// Keeps the guide in step with the app: a new menu page without a guide section, or a section
// pointing to a screenshot that was never taken, fails here (and so fails the build checks).

const publicDir = fileURLToPath(new URL("../public", import.meta.url));

describe("user guide", () => {
  it("has a section for every menu page (its Guide button opens it)", () => {
    const missing = NAV.map((item) => item.to).filter((to) => !PAGES_WITHOUT_GUIDE.includes(to) && !guideSectionFor(to));
    expect(missing, "Add a section with these paths in `pages` to admin/src/guide/content.ts").toEqual([]);
  });

  it("only lists pages that exist", () => {
    const paths = new Set(NAV.map((item) => item.to));
    const unknown = [...GUIDE.flatMap((s) => s.pages ?? []), ...PAGES_WITHOUT_GUIDE].filter((p) => !paths.has(p));
    expect(unknown).toEqual([]);
  });

  it("uses unique ids and existing screenshots", () => {
    const ids = GUIDE.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const missing = GUIDE.filter((s) => s.image && !existsSync(`${publicDir}${s.image.src.replace(/^\/admin/, "")}`)).map((s) => s.image!.src);
    expect(missing, "Run `npm run guide:build` to take these screenshots").toEqual([]);
  });
});

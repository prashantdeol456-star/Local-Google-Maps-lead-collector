import { describe, expect, it } from "vitest";
import { qs } from "../src/lib/api";
import { formatRelative, hostOf, safeHref } from "../src/lib/format";
import { matchPath } from "../src/lib/router";

describe("matchPath", () => {
  it("matches static and parameter segments", () => {
    expect(matchPath("/leads", "/leads")).toEqual({});
    expect(matchPath("/leads/:id", "/leads/abc%20123")).toEqual({ id: "abc 123" });
    expect(matchPath("/leads/:id", "/leads")).toBeNull();
    expect(matchPath("/leads/:id", "/collections/1")).toBeNull();
  });
});

describe("qs", () => {
  it("drops empty values", () => {
    expect(qs({ q: "", city: "Lucknow", page: 2, x: null, y: undefined })).toBe("?city=Lucknow&page=2");
    expect(qs({ q: "" })).toBe("");
  });
});

describe("links from collected data", () => {
  it("only http(s) URLs become clickable", () => {
    expect(safeHref("https://example.com/a")).toBe("https://example.com/a");
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref("data:text/html,x")).toBeUndefined();
    expect(safeHref("not a url")).toBeUndefined();
    expect(safeHref(null)).toBeUndefined();
  });

  it("shows a short host", () => {
    expect(hostOf("http://www.erauniversity.in/")).toBe("erauniversity.in");
  });
});

describe("formatRelative", () => {
  it("formats recent times", () => {
    const now = Date.parse("2026-10-05T12:00:00Z");
    expect(formatRelative("2026-10-05T11:59:50Z", now)).toBe("just now");
    expect(formatRelative("2026-10-05T11:50:00Z", now)).toBe("10 min ago");
    expect(formatRelative("2026-10-05T09:00:00Z", now)).toBe("3 h ago");
    expect(formatRelative(null, now)).toBe("—");
  });
});

import { describe, expect, it } from "vitest";
import { isLocalBackend, normalizeBackendUrl } from "../src/storage/auth";

describe("normalizeBackendUrl", () => {
  it.each([
    ["http://127.0.0.1:3000", "http://127.0.0.1:3000"],
    ["http://127.0.0.1:3000/", "http://127.0.0.1:3000"],
    ["localhost:3000", "http://localhost:3000"],
    ["  http://localhost:3000/api/  ", "http://localhost:3000"],
    ["https://leads.example.com", "https://leads.example.com"],
    ["HTTPS://Leads.Example.com:8443/x", "https://leads.example.com:8443"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeBackendUrl(input)).toEqual({ ok: true, url: expected });
  });

  it.each([
    ["", "required"],
    ["http://leads.example.com", "https"],
    ["ftp://127.0.0.1", "http"],
    ["https://user:pass@leads.example.com", "username"],
    ["http://", "not valid"],
  ])("rejects %j", (input, message) => {
    const res = normalizeBackendUrl(input);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain(message);
  });
});

describe("isLocalBackend", () => {
  it("recognises local hosts only", () => {
    expect(isLocalBackend("http://127.0.0.1:3000")).toBe(true);
    expect(isLocalBackend("http://localhost:3000")).toBe(true);
    expect(isLocalBackend("https://leads.example.com")).toBe(false);
    expect(isLocalBackend("https://127.0.0.1.example.com")).toBe(false);
  });
});

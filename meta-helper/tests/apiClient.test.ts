import { describe, expect, it, vi } from "vitest";
import { apiRequest } from "../src/background/apiClient";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const base = "http://127.0.0.1:3000";

describe("apiRequest", () => {
  it("sends bearer token, JSON body and omits cookies", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true }));
    const res = await apiRequest({ baseUrl: base, token: "mlp_abc", fetchImpl }, "/api/x", { method: "POST", body: { a: 1 } });
    expect(res).toEqual({ ok: true, data: { ok: true } });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${base}/api/x`);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("omit");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer mlp_abc");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(init.body).toBe('{"a":1}');
  });

  it("does not send an Authorization header without a token", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {}));
    await apiRequest({ baseUrl: base, fetchImpl }, "/api/health");
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("maps network failure to unreachable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const res = await apiRequest({ baseUrl: base, fetchImpl }, "/api/health");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("unreachable");
  });

  it("times out slow responses", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const res = await apiRequest({ baseUrl: base, fetchImpl: fetchImpl as typeof fetch, timeoutMs: 20 }, "/api/health");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("timeout");
  });

  it("maps 401 to unauthorized and keeps the API error code/message", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(401, { error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" } }),
    );
    const res = await apiRequest({ baseUrl: base, fetchImpl }, "/api/auth/token", { method: "POST", body: {} });
    expect(res).toEqual({
      ok: false,
      error: { kind: "unauthorized", status: 401, code: "INVALID_CREDENTIALS", message: "Invalid email or password" },
    });
  });

  it("handles non-JSON error bodies", async () => {
    const fetchImpl = vi.fn(async () => new Response("Bad gateway", { status: 502 }));
    const res = await apiRequest({ baseUrl: base, fetchImpl }, "/api/health");
    expect(res).toEqual({ ok: false, error: { kind: "http", status: 502, code: undefined, message: "Backend returned HTTP 502" } });
  });

  it("flags a 200 with an invalid body", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>", { status: 200 }));
    const res = await apiRequest({ baseUrl: base, fetchImpl }, "/api/health");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("invalid_response");
  });
});

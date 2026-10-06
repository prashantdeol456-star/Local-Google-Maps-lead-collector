// Minimal REST client for the backend. No chrome APIs here, so it is unit-testable
// with an injected fetch.

export type ApiErrorKind = "unreachable" | "timeout" | "unauthorized" | "http" | "invalid_response";

export interface ApiError {
  kind: ApiErrorKind;
  status?: number;
  code?: string;
  message: string;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export interface ApiClientOptions {
  baseUrl: string;
  token?: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 8000;

export async function apiRequest<T>(
  opts: ApiClientOptions,
  path: string,
  init: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  let res: Response;
  try {
    res = await fetchImpl(`${opts.baseUrl}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
      credentials: "omit", // never send cookies; the extension authenticates with its bearer token
    });
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === "AbortError";
    return {
      ok: false,
      error: aborted
        ? { kind: "timeout", message: `Backend did not respond in time (${opts.baseUrl})` }
        : { kind: "unreachable", message: `Backend is not reachable at ${opts.baseUrl}` },
    };
  } finally {
    clearTimeout(timer);
  }

  let body: unknown = null;
  try {
    body = res.status === 204 ? null : await res.json();
  } catch {
    if (res.ok) return { ok: false, error: { kind: "invalid_response", status: res.status, message: "Backend sent an invalid response" } };
  }

  if (res.ok) return { ok: true, data: body as T };

  const apiErr = (body as { error?: { code?: string; message?: string } } | null)?.error;
  return {
    ok: false,
    error: {
      kind: res.status === 401 ? "unauthorized" : "http",
      status: res.status,
      code: apiErr?.code,
      message: apiErr?.message ?? `Backend returned HTTP ${res.status}`,
    },
  };
}

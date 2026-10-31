// Same-origin API client. Authentication is the httpOnly session cookie set by /api/auth/login.

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// Super admins can look at one user's data at a time (backend: x-view-owner header).
const VIEW_OWNER_KEY = "viewOwner";

export function getViewOwner(): string | null {
  try {
    return localStorage.getItem(VIEW_OWNER_KEY);
  } catch {
    return null;
  }
}

export function setViewOwner(id: string | null) {
  try {
    if (id) localStorage.setItem(VIEW_OWNER_KEY, id);
    else localStorage.removeItem(VIEW_OWNER_KEY);
  } catch {
    // storage blocked: the choice lasts for this page only
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      headers: {
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(getViewOwner() ? { "X-View-Owner": getViewOwner()! } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Cannot reach the backend. Is it running?");
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? "HTTP_ERROR", err?.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export function qs(params: Record<string, string | number | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Plain download links cannot send headers: the super admin's user choice goes in the URL. */
export function withViewOwner(url: string): string {
  const owner = getViewOwner();
  if (!owner) return url;
  return `${url}${url.includes("?") ? "&" : "?"}viewOwner=${encodeURIComponent(owner)}`;
}

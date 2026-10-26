// Backend connection + login state. Lives in chrome.storage.local, which only this
// extension can read. The bearer token never leaves the background service worker:
// the side panel only ever sees BackendStatus (no token).

export const DEFAULT_BACKEND_URL = "http://127.0.0.1:3000";

export interface AdminInfo {
  id: string;
  email: string;
  name: string | null;
}

export interface AuthState {
  backendUrl: string;
  token: string | null;
  admin: AdminInfo | null;
  tokenExpiresAt: string | null;
}

export interface BackendStatus {
  backendUrl: string;
  /** null = not checked yet */
  reachable: boolean | null;
  database: "ok" | "unreachable" | null;
  loggedIn: boolean;
  admin: AdminInfo | null;
  checkedAt: number | null;
  error: string | null;
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Validates and normalizes a backend URL to its origin, e.g. "localhost:3000/" → "http://localhost:3000".
 * Plain http is only accepted for local hosts; remote backends must use https.
 */
export function normalizeBackendUrl(input: string): { ok: true; url: string } | { ok: false; error: string } {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Backend URL is required" };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
  } catch {
    return { ok: false, error: "Backend URL is not valid" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, error: "Backend URL must start with http:// or https://" };
  if (url.username || url.password) return { ok: false, error: "Backend URL must not contain a username or password" };
  if (url.protocol === "http:" && !LOCAL_HOSTS.has(url.hostname)) {
    return { ok: false, error: "Remote backends must use https://" };
  }
  return { ok: true, url: url.origin };
}

export function isLocalBackend(backendUrl: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(backendUrl).hostname);
  } catch {
    return false;
  }
}

const AUTH_KEY = "auth";

export async function loadAuthState(): Promise<AuthState> {
  const stored = (await chrome.storage.local.get(AUTH_KEY))[AUTH_KEY] as Partial<AuthState> | undefined;
  return {
    backendUrl: stored?.backendUrl ?? DEFAULT_BACKEND_URL,
    token: stored?.token ?? null,
    admin: stored?.admin ?? null,
    tokenExpiresAt: stored?.tokenExpiresAt ?? null,
  };
}

export function saveAuthState(state: AuthState): Promise<void> {
  return chrome.storage.local.set({ [AUTH_KEY]: state });
}

import {
  loadAuthState,
  normalizeBackendUrl,
  saveAuthState,
  type AdminInfo,
  type AuthState,
  type BackendStatus,
} from "../storage/auth";
import { apiRequest } from "./apiClient";

// Login, logout and status checks against the backend. The token stays in this module
// and chrome.storage; nothing returned from here contains it.

const TOKEN_NAME = "LinkedIn Helper";

interface HealthResponse {
  status: string;
  database: "ok" | "unreachable";
}

interface TokenResponse {
  token: string;
  expiresAt: string | null;
  admin: AdminInfo;
}

function status(auth: AuthState, partial: Partial<BackendStatus>): BackendStatus {
  return {
    backendUrl: auth.backendUrl,
    reachable: null,
    database: null,
    loggedIn: !!auth.token,
    admin: auth.token ? auth.admin : null,
    checkedAt: Date.now(),
    error: null,
    ...partial,
  };
}

export async function checkBackend(): Promise<BackendStatus> {
  let auth = await loadAuthState();

  const health = await apiRequest<HealthResponse>({ baseUrl: auth.backendUrl, timeoutMs: 4000 }, "/api/health");
  if (!health.ok) {
    // 503 = server is up but its database is not.
    if (health.error.status === 503) {
      return status(auth, { reachable: true, database: "unreachable", error: "Backend database is unreachable" });
    }
    return status(auth, { reachable: false, error: health.error.message });
  }

  if (!auth.token) return status(auth, { reachable: true, database: health.data.database });

  const me = await apiRequest<{ admin: AdminInfo }>({ baseUrl: auth.backendUrl, token: auth.token }, "/api/auth/me");
  if (!me.ok && me.error.kind === "unauthorized") {
    // Token was revoked or expired: forget it so the panel shows the login screen.
    auth = { ...auth, token: null, admin: null, tokenExpiresAt: null };
    await saveAuthState(auth);
    return status(auth, { reachable: true, database: health.data.database, error: "Session expired. Please log in again." });
  }
  if (!me.ok) return status(auth, { reachable: true, database: health.data.database, error: me.error.message });

  if (me.data.admin.email !== auth.admin?.email || me.data.admin.name !== auth.admin?.name) {
    auth = { ...auth, admin: me.data.admin };
    await saveAuthState(auth);
  }
  return status(auth, { reachable: true, database: health.data.database });
}

export async function login(backendUrlInput: string, email: string, password: string): Promise<BackendStatus> {
  const normalized = normalizeBackendUrl(backendUrlInput);
  if (!normalized.ok) throw new Error(normalized.error);
  if (!email.trim() || !password) throw new Error("Email and password are required");

  const res = await apiRequest<TokenResponse>({ baseUrl: normalized.url }, "/api/auth/token", {
    method: "POST",
    body: { email: email.trim(), password, name: TOKEN_NAME },
  });
  if (!res.ok) {
    if (res.error.code === "INVALID_CREDENTIALS") throw new Error("Invalid email or password");
    throw new Error(res.error.message);
  }

  // Replacing an older login: revoke its token so it does not linger on the backend.
  const previous = await loadAuthState();
  if (previous.token) {
    await apiRequest({ baseUrl: previous.backendUrl, token: previous.token, timeoutMs: 4000 }, "/api/auth/logout", {
      method: "POST",
    });
  }

  await saveAuthState({
    backendUrl: normalized.url,
    token: res.data.token,
    admin: res.data.admin,
    tokenExpiresAt: res.data.expiresAt,
  });
  return checkBackend();
}

/** Revokes the token on the backend (best effort) and always forgets it locally. */
export async function logout(): Promise<BackendStatus> {
  const auth = await loadAuthState();
  if (auth.token) {
    await apiRequest({ baseUrl: auth.backendUrl, token: auth.token, timeoutMs: 4000 }, "/api/auth/logout", { method: "POST" });
  }
  await saveAuthState({ ...auth, token: null, admin: null, tokenExpiresAt: null });
  return checkBackend();
}

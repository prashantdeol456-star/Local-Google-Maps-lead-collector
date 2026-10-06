import { useCallback, useEffect, useState } from "react";
import { isLocalBackend, normalizeBackendUrl, type BackendStatus } from "../../storage/auth";
import { send } from "./collectorClient";

const STATUS_POLL_MS = 5000;

/**
 * Remote (non-localhost) backends need host permission, which Chrome only grants
 * from a user gesture — so this must be called directly from a click handler.
 */
async function ensureHostPermission(backendUrl: string): Promise<void> {
  if (isLocalBackend(backendUrl)) return;
  const origins = [`${backendUrl}/*`];
  if (await chrome.permissions.contains({ origins })) return;
  if (!(await chrome.permissions.request({ origins }))) throw new Error("Permission to reach this backend was denied");
}

export const backendClient = {
  status: () => send<BackendStatus>({ type: "GET_BACKEND_STATUS" }),

  async login(backendUrl: string, email: string, password: string) {
    const normalized = normalizeBackendUrl(backendUrl);
    if (!normalized.ok) return { ok: false as const, error: normalized.error };
    try {
      await ensureHostPermission(normalized.url);
    } catch (err) {
      return { ok: false as const, error: (err as Error).message };
    }
    return send<BackendStatus>({ type: "LOGIN", backendUrl: normalized.url, email, password });
  },

  logout: () => send<BackendStatus>({ type: "LOGOUT" }),
};

/** Backend status, polled every few seconds. `setStatus` lets login/logout apply results immediately. */
export function useBackendStatus() {
  const [status, setStatus] = useState<BackendStatus | null>(null);

  const refresh = useCallback(async () => {
    const res = await backendClient.status();
    if (res.ok) setStatus(res.data);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, STATUS_POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { status, setStatus, refresh };
}

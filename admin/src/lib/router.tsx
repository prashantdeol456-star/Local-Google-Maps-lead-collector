// Minimal client-side router for the handful of admin pages (no dependency needed).
import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

export const BASE = "/admin";

function subscribe(cb: () => void) {
  window.addEventListener("popstate", cb);
  return () => window.removeEventListener("popstate", cb);
}

const currentPath = () => window.location.pathname.slice(BASE.length).replace(/\/+$/, "") || "/";

/** Path inside the admin app, e.g. "/leads/abc". */
export function usePath(): string {
  return useSyncExternalStore(subscribe, currentPath);
}

/** Current query string as URLSearchParams (re-renders on navigation). */
export function useSearchParams(): URLSearchParams {
  const search = useSyncExternalStore(subscribe, () => window.location.search);
  return new URLSearchParams(search);
}

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const url = BASE + (to.startsWith("/") ? to : `/${to}`);
  if (opts.replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
  if (!opts.replace) window.scrollTo(0, 0);
}

/** Updates query parameters on the current page (empty values are removed). */
export function setSearchParams(update: Record<string, string | number | null | undefined>, opts = { replace: true }) {
  const params = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(update)) {
    if (v === null || v === undefined || v === "") params.delete(k);
    else params.set(k, String(v));
  }
  const qs = params.toString();
  navigate(`${currentPath()}${qs ? `?${qs}` : ""}`, opts);
}

/** Matches "/leads/:id" against a path; returns params or null. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split("/").filter(Boolean);
  const s = path.split("/").filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i]!.startsWith(":")) params[p[i]!.slice(1)] = decodeURIComponent(s[i]!);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { to: string };

export function Link({ to, onClick, ...rest }: LinkProps) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    // Let the browser handle new-tab/window clicks.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={BASE + to} onClick={handle} {...rest} />;
}

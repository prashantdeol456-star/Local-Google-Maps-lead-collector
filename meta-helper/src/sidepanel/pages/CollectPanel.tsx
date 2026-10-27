import { useCallback, useState } from "react";
import type { CollectResult, ContentRequest, SocialLead } from "../../messages";
import { searchUrl } from "../../content/facebook";
import { backendClient } from "../services/backendClient";

// Keyword search → "Add all on this page" → save to the lead platform (Admin → Social Leads).

type Target = "instagram" | "facebook_page" | "facebook_group" | "facebook_profile";

const TARGETS: { id: Target; label: string }[] = [
  { id: "instagram", label: "Instagram accounts" },
  { id: "facebook_page", label: "Facebook Pages" },
  { id: "facebook_group", label: "Facebook groups" },
  { id: "facebook_profile", label: "Facebook people" },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function ask<T>(tabId: number, request: ContentRequest): Promise<T | null> {
  for (let i = 0; i < 3; i++) {
    try {
      const res = (await chrome.tabs.sendMessage(tabId, request)) as { ok: boolean; data?: T } | undefined;
      if (res?.ok) return (res.data ?? (null as T)) as T;
      return null;
    } catch {
      await sleep(1000);
    }
  }
  return null;
}

export function CollectPanel() {
  const [target, setTarget] = useState<Target>("instagram");
  const [keyword, setKeyword] = useState("");
  const [tag, setTag] = useState("");
  const [found, setFound] = useState<SocialLead[]>([]);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ text: string; kind: "ok" | "warn" | "error" } | null>(null);
  const [busy, setBusy] = useState(false);

  async function search() {
    if (!keyword.trim()) return;
    setMsg(null);
    const tab = await activeTab();
    if (target === "instagram") {
      const url = "https://www.instagram.com/explore/";
      const t = tab?.url?.startsWith("https://www.instagram.com/") && tab.id ? await chrome.tabs.update(tab.id, { url }) : await chrome.tabs.create({ url });
      await sleep(3500);
      const ok = t?.id ? await ask<null>(t.id, { type: "MH_IG_SEARCH", keyword: keyword.trim() }) : null;
      setMsg({ text: ok === null ? "Type the keyword in Instagram's search box, then press Add all on this page." : "Results are open. Press Add all on this page.", kind: "ok" });
      return;
    }
    const kind = target === "facebook_page" ? "page" : target === "facebook_group" ? "group" : "profile";
    const url = searchUrl(kind, keyword.trim());
    if (tab?.id && tab.url?.startsWith("https://www.facebook.com/")) await chrome.tabs.update(tab.id, { url });
    else await chrome.tabs.create({ url });
    setMsg({ text: "Scroll the results as far as you like, then press Add all on this page.", kind: "ok" });
  }

  const collect = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      const tab = await activeTab();
      if (!tab?.id) throw new Error("Open an Instagram or Facebook tab first");
      const result = await ask<CollectResult>(tab.id, { type: "MH_COLLECT" });
      if (!result) throw new Error("This tab is not Instagram or Facebook (or the page is still loading)");
      if (result.page === "other") throw new Error("Open a Facebook search (Pages, groups or people), or Instagram's search or a profile");
      const leads = result.leads.map((l) => ({ ...l, keyword: keyword.trim() || null, tag: tag.trim() || null }));
      setFound(leads);
      setSelected(new Set(leads.map((l) => l.url)));
      const platform = leads[0]?.platform;
      if (platform) {
        const check = await backendClient.checkLeads(platform, leads.map((l) => l.url));
        if (check.ok) setSaved(check.data);
      }
      setMsg({ text: leads.length ? `${leads.length} found on this page.` : "Nothing found on this page yet. Wait for results to load, or scroll.", kind: leads.length ? "ok" : "warn" });
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : String(err), kind: "error" });
    } finally {
      setBusy(false);
    }
  }, [keyword, tag]);

  async function save() {
    const leads = found.filter((l) => selected.has(l.url));
    if (!leads.length) return;
    setBusy(true);
    const res = await backendClient.saveLeads(leads);
    setBusy(false);
    if (!res.ok) return setMsg({ text: res.error, kind: "error" });
    setMsg({ text: `Saved: ${res.data.created} new, ${res.data.updated} updated${res.data.skipped.length ? `, ${res.data.skipped.length} skipped` : ""}.`, kind: "ok" });
    const check = await backendClient.checkLeads(leads[0]!.platform, found.map((l) => l.url));
    if (check.ok) setSaved(check.data);
  }

  function toggle(url: string) {
    const next = new Set(selected);
    if (next.has(url)) next.delete(url);
    else next.add(url);
    setSelected(next);
  }

  return (
    <>
      <section className="card">
        <p className="form__title">Find people and Pages</p>
        <div className="form">
          <label className="field">
            <span>Search</span>
            <select value={target} onChange={(e) => setTarget(e.target.value as Target)}>
              {TARGETS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Keyword</span>
            <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="e.g. bakery lucknow" onKeyDown={(e) => e.key === "Enter" && search()} />
          </label>
          <label className="field">
            <span>Tag (optional)</span>
            <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. Bakeries Oct" />
          </label>
          <div className="controls">
            <button className="btn btn--primary" disabled={!keyword.trim()} onClick={search}>
              Search
            </button>
            <button className="btn" disabled={busy} onClick={collect}>
              Add all on this page
            </button>
          </div>
          <p className="hint">Works on the page open in this window: Instagram search or a profile, or a Facebook search. Only what the page shows is saved. Group member lists are not read.</p>
        </div>
        {msg && <p className={`msg msg--${msg.kind === "ok" ? "ok" : msg.kind === "warn" ? "warn" : "error"}`}>{msg.text}</p>}
      </section>

      {found.length > 0 && (
        <section className="card">
          <div className="row row--between">
            <p className="form__title">
              {selected.size} of {found.length} selected
            </p>
            <button className="btn btn--primary" disabled={busy || selected.size === 0} onClick={save}>
              Save selected
            </button>
          </div>
          <ul className="list">
            {found.map((l) => (
              <li key={l.url} className={`list__item ${saved[l.url] ? "list__item--saved" : ""}`}>
                <label className="check">
                  <input type="checkbox" checked={selected.has(l.url)} onChange={() => toggle(l.url)} />
                  <span className="list__text">
                    <strong>{l.name}</strong>
                    {l.handle ? ` @${l.handle}` : ""}
                    {l.audienceText ? ` · ${l.audienceText}` : ""}
                    {"privacy" in l && l.privacy ? ` · ${l.privacy}` : ""}
                    {saved[l.url] ? " · saved" : ""}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

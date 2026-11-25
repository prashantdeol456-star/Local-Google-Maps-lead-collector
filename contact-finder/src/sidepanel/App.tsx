import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { Contact, ValueSource } from "../core/contacts";
import { contactsToCsv } from "../core/contacts";
import type { EnrichResult, EnrichStatus, PanelRequest, Response, SendResult, TabInfo } from "../messages";
import type { Sighting } from "../core/contacts";
import type { BackendStatus } from "../storage/auth";
import type { Settings } from "../storage/contacts";

// Contact Finder side panel: what the open page shows, the saved contacts, and settings.

function send<T>(req: PanelRequest): Promise<Response<T>> {
  return chrome.runtime.sendMessage(req).then(
    (r: Response<T> | undefined) => r ?? { ok: false, error: "No answer from the extension" },
    (err: unknown) => ({ ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
}

const HOW: Record<ValueSource, string> = {
  link: "link on page",
  text: "written on page",
  whatsapp: "WhatsApp link",
  contact_page: "Contact/About page",
  contact_info: "LinkedIn Contact info",
  hunter: "Hunter (email finder)",
};

const ALL_SITES = ["https://*/*", "http://*/*"];

function Copy({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn btn--ghost"
      style={{ flex: "none", padding: "2px 8px" }}
      onClick={() =>
        void navigator.clipboard.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        })
      }
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

type Shown = { value: string; how: string; score?: number | null; verified?: string | null };

function Values({ title, items, onCheck }: { title: string; items: Shown[]; onCheck?: (value: string) => Promise<void> }) {
  const [checking, setChecking] = useState<string | null>(null);
  return (
    <div className="field">
      <span>
        {title} ({items.length})
      </span>
      {items.length === 0 ? (
        <p className="hint">None on this page.</p>
      ) : (
        <ul className="values">
          {items.map((v) => (
            <li key={v.value} className="value">
              <span className="value__text">{v.value}</span>
              <span className="value__how">
                {HOW[v.how as ValueSource] ?? v.how}
                {v.score != null && ` · ${v.score}%`}
                {v.verified && ` · ${v.verified}`}
              </span>
              {onCheck && !v.verified && (
                <button
                  className="btn btn--ghost"
                  style={{ flex: "none", padding: "2px 8px" }}
                  disabled={checking === v.value}
                  title="Check with Hunter if this email works (0.5 credit)"
                  onClick={() => {
                    setChecking(v.value);
                    void onCheck(v.value).finally(() => setChecking(null));
                  }}
                >
                  {checking === v.value ? "…" : "Check"}
                </button>
              )}
              <Copy value={v.value} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- This page ----

/** Hunter through the platform: a person's work email, or emails at the site's domain. */
function HunterBox({ s, saved, loggedIn, onDone }: { s: Sighting; saved: Contact | null; loggedIn: boolean; onDone: () => void }) {
  const [status, setStatus] = useState<EnrichStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [domain, setDomain] = useState(() => (s.website ? s.website.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "") : ""));
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!loggedIn) return;
    void send<EnrichStatus>({ type: "CF_ENRICH_STATUS" }).then((r) => (r.ok ? setStatus(r.data) : setStatusError(r.error)));
  }, [loggedIn, s.id]);

  if (!loggedIn) return <p className="hint">Email finder (Hunter): log in to your Lead Platform under Settings to find work emails that pages do not show.</p>;
  if (statusError) return <p className="msg msg--error">{statusError}</p>;
  if (!status) return null;
  if (!status.configured) return <p className="hint">Email finder: add your free Hunter API key on the platform's “Email finder” page (My account), then come back.</p>;
  if (status.status === "disabled") return <p className="msg msg--warn">Email finder is switched off: {status.statusReason}</p>;

  const left = status.credits?.left ?? 0;
  const isPerson = s.kind === "linkedin_profile";
  const hasEmail = (saved?.emails.length ?? 0) + s.findings.emails.length > 0;

  async function run(kind: "person" | "domain") {
    setBusy(kind);
    setMsg(null);
    const res =
      kind === "person"
        ? await send<EnrichResult>({ type: "CF_FIND_EMAIL", sighting: s, domain: domain.trim() || null })
        : await send<EnrichResult>({ type: "CF_DOMAIN_EMAILS", sighting: s, domain: domain.trim() });
    setBusy(null);
    if (!res.ok) setMsg({ ok: false, text: res.error });
    else
      setMsg({
        ok: true,
        text: res.data.emails.length
          ? `Found: ${res.data.emails.join(", ")}${res.data.status === "cached" ? " (earlier lookup, no credit)" : ""}`
          : "Hunter found nothing (no credit used)",
      });
    void send<EnrichStatus>({ type: "CF_ENRICH_STATUS" }).then((r) => r.ok && setStatus(r.data));
    onDone();
  }

  return (
    <div className="field">
      <span>Email finder (Hunter) · {left} credits left{status.exhaustedUntil ? `, renew ${status.exhaustedUntil.slice(0, 10)}` : ""}</span>
      <input
        style={{ padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg)", color: "var(--text)", font: "inherit" }}
        placeholder={isPerson ? "Company website (optional), e.g. acme.in" : "Website, e.g. acme.in"}
        value={domain}
        onChange={(e) => setDomain(e.target.value)}
        aria-label="Company website"
      />
      <div className="row">
        {isPerson && s.name && (
          <button className="btn btn--primary" disabled={!!busy || !!status.exhaustedUntil} onClick={() => void run("person")} title="1 credit only when an email is found">
            {busy === "person" ? "Finding…" : hasEmail ? "Find work email too" : "Find work email"}
          </button>
        )}
        {!isPerson && (
          <button className="btn" disabled={!!busy || !domain.trim() || !!status.exhaustedUntil} onClick={() => void run("domain")} title="1 credit per email found, at most 5">
            {busy === "domain" ? "Searching…" : "Emails at this website (≤ 5 credits)"}
          </button>
        )}
      </div>
      <small className="hint">{isPerson ? "Uses the name, company and LinkedIn profile: 1 credit only if an email is found." : "1 credit for each email Hunter knows at this website, at most 5."} Hunter's emails are a best guess: check the confidence.</small>
      {msg && <p className={`msg ${msg.ok ? "msg--ok" : "msg--error"}`}>{msg.text}</p>}
    </div>
  );
}

function ThisPage({ settings, loggedIn }: { settings: Settings | null; loggedIn: boolean }) {
  const [info, setInfo] = useState<TabInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const res = await send<TabInfo>({ type: "CF_TAB" });
    if (res.ok) setInfo(res.data);
  }, []);

  useEffect(() => {
    void refresh();
    const onTab = () => {
      setMsg(null);
      void refresh();
    };
    const onUpdated = (_id: number, change: { status?: string }) => change.status === "complete" && setTimeout(onTab, 800);
    chrome.tabs.onActivated.addListener(onTab);
    chrome.tabs.onUpdated.addListener(onUpdated);
    const timer = setInterval(() => void refresh(), 4000);
    return () => {
      chrome.tabs.onActivated.removeListener(onTab);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearInterval(timer);
    };
  }, [refresh]);

  if (!info) return <p className="loading">Reading this page…</p>;
  const s = info.reading?.sighting ?? null;

  async function allowSite() {
    if (!info?.needsAccess) return;
    const granted = await chrome.permissions.request({ origins: [info.needsAccess] });
    if (granted) await refresh();
  }

  async function save() {
    if (!s) return;
    setBusy("save");
    const res = await send<Contact>({ type: "CF_SAVE", sighting: s });
    setBusy(null);
    setMsg(res.ok ? { ok: true, text: "Saved" } : { ok: false, text: res.error });
    void refresh();
  }

  async function crawl() {
    if (!s) return;
    // Reading the site's other pages needs access to the site (asked once per site).
    const origin = `${new URL(s.url).origin}/*`;
    if (!(await chrome.permissions.contains({ origins: [origin] })) && !(await chrome.permissions.request({ origins: [origin] }))) return;
    setBusy("crawl");
    const res = await send<number>({ type: "CF_CRAWL" });
    setBusy(null);
    setMsg(res.ok ? { ok: true, text: res.data ? `${res.data} more found on the Contact/About pages` : "Nothing more on the Contact/About pages" } : { ok: false, text: res.error });
    void refresh();
  }

  if (!info.readable) {
    return (
      <div className="card form">
        <p className="hint">{info.url && /^https?:/.test(info.url) ? "Contact Finder cannot read this page yet." : "Open a website or a LinkedIn profile."}</p>
        {info.needsAccess && (
          <button className="btn btn--primary" onClick={() => void allowSite()}>
            Allow reading this site
          </button>
        )}
      </div>
    );
  }
  if (!s) return <div className="card form"><p className="hint">On LinkedIn, open a profile or a company page.</p></div>;

  const isProfile = s.kind === "linkedin_profile";
  const savedHere = !!info.saved;
  // What the page shows, plus what was found for it before (Hunter, Contact/About pages, checks).
  const emails = [...s.findings.emails.map((e) => ({ ...e, ...(info.saved?.emails.find((x) => x.value === e.value) ?? {}) })), ...(info.saved?.emails ?? []).filter((e) => !s.findings.emails.some((x) => x.value === e.value))];

  async function check(email: string) {
    const res = await send<string>({ type: "CF_VERIFY", sighting: s!, email });
    setMsg(res.ok ? { ok: res.data === "valid", text: `${email}: ${res.data}` } : { ok: false, text: res.error });
    void refresh();
  }
  return (
    <div className="card form">
      <div className="who">
        <span className="who__name">{s.name ?? s.website ?? "This page"}</span>
        {s.title && <span className="who__line">{s.title}</span>}
        {(s.company || s.location) && <span className="who__line">{[isProfile ? s.company : null, s.location].filter(Boolean).join(" · ")}</span>}
        {s.website && <span className="who__line">{s.website}</span>}
      </div>

      <Values title="Emails" items={emails} onCheck={loggedIn ? check : undefined} />
      <Values title="Phones" items={s.findings.phones} />
      <HunterBox key={s.id} s={s} saved={info.saved} loggedIn={loggedIn} onDone={() => void refresh()} />

      {isProfile && info.reading?.contactInfoUrl && (
        <div className="msg msg--warn">
          LinkedIn shows email and phone only in “Contact info”, and only when this person shares them with you.{" "}
          <button className="btn btn--ghost" style={{ padding: "2px 6px" }} onClick={() => void chrome.tabs.update(info.tabId!, { url: info.reading!.contactInfoUrl! })}>
            Open Contact info
          </button>
        </div>
      )}
      {isProfile && !info.reading?.contactInfoUrl && !s.findings.emails.length && !s.findings.phones.length && (
        <p className="hint">This person shares no email or phone with you on LinkedIn.</p>
      )}

      <div className="row">
        {!savedHere || !settings?.autoSave ? (
          <button className="btn btn--primary" disabled={busy === "save"} onClick={() => void save()}>
            {savedHere ? "Save again" : "Save"}
          </button>
        ) : (
          <span className="chip">Saved by itself ✓</span>
        )}
        {s.kind === "website" && (
          <button className="btn" disabled={busy === "crawl"} onClick={() => void crawl()}>
            {busy === "crawl" ? "Reading…" : "Check Contact/About pages"}
          </button>
        )}
      </div>
      {msg && <p className={`msg ${msg.ok ? "msg--ok" : "msg--error"}`}>{msg.text}</p>}
    </div>
  );
}

// ---- Saved ----

function Saved({ loggedIn }: { loggedIn: boolean }) {
  const [items, setItems] = useState<Contact[] | null>(null);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [listName, setListName] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);

  const load = useCallback(async () => {
    const res = await send<Contact[]>({ type: "CF_LIST" });
    if (res.ok) setItems(res.data);
  }, []);
  useEffect(() => {
    void load();
    const onChange = (changes: Record<string, unknown>, area: string) => area === "local" && "cf-contacts" in changes && void load();
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, [load]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!items) return [];
    if (!t) return items;
    return items.filter((c) => [c.name, c.company, c.title, c.website, ...c.emails.map((e) => e.value), ...c.phones.map((p) => p.value)].some((v) => v?.toLowerCase().includes(t)));
  }, [items, q]);

  if (!items) return <p className="loading">Loading…</p>;
  const chosen = picked.size ? shown.filter((c) => picked.has(c.id)) : shown;

  function exportCsv() {
    const blob = new Blob([contactsToCsv(chosen)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `contact-finder-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async function sendChosen(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await send<SendResult>({ type: "CF_SEND", ids: chosen.map((c) => c.id), listName: listName || null });
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: `Sent ${res.data.sent}: ${res.data.created} new and ${res.data.updated} updated in Contacts` } : { ok: false, text: res.error });
  }

  async function remove(ids: string[] | "all") {
    const res = await send<number>({ type: "CF_DELETE", ids });
    setPicked(new Set());
    setConfirmAll(false);
    setMsg(res.ok ? { ok: true, text: `Deleted ${res.data}` } : { ok: false, text: res.error });
  }

  return (
    <div className="card form">
      <input className="field" style={{ padding: "7px 9px", border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg)", color: "var(--text)", font: "inherit" }} placeholder="Search name, email, phone, site…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search saved contacts" />
      <p className="hint">
        {items.length} saved in this browser{picked.size ? ` · ${picked.size} selected` : ""}. Actions below use {picked.size ? "the selected ones" : `all ${shown.length} shown`}.
      </p>
      <div className="row">
        <button className="btn" disabled={!chosen.length} onClick={exportCsv}>
          ⬇ Export CSV
        </button>
        {picked.size > 0 && (
          <button className="btn btn--danger" onClick={() => void remove([...picked])}>
            Delete selected
          </button>
        )}
      </div>
      <form className="row" onSubmit={(e) => void sendChosen(e)}>
        <input style={{ flex: 1, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg)", color: "var(--text)", font: "inherit" }} placeholder="List name (Contact Finder)" value={listName} maxLength={100} onChange={(e) => setListName(e.target.value)} />
        <button className="btn btn--primary" disabled={busy || !chosen.length || !loggedIn} title={loggedIn ? "" : "Log in under Settings"}>
          {busy ? "Sending…" : "Send to Lead Platform"}
        </button>
      </form>
      {!loggedIn && <p className="hint">To send contacts to the Lead Platform, log in under Settings.</p>}
      {msg && <p className={`msg ${msg.ok ? "msg--ok" : "msg--error"}`}>{msg.text}</p>}

      {shown.length === 0 ? (
        <p className="empty">{items.length ? "Nothing matches." : "Nothing saved yet. Open a website or a LinkedIn profile."}</p>
      ) : (
        <div>
          {shown.slice(0, 300).map((c) => (
            <label key={c.id} className="saved-item">
              <input
                type="checkbox"
                checked={picked.has(c.id)}
                onChange={(e) => {
                  const next = new Set(picked);
                  if (e.target.checked) next.add(c.id);
                  else next.delete(c.id);
                  setPicked(next);
                }}
              />
              <span className="saved-item__body">
                <span className="saved-item__name">
                  {c.name ?? c.website ?? c.id} <span className="chip">{c.kind === "website" ? "Website" : c.kind === "linkedin_profile" ? "LinkedIn" : "LinkedIn company"}</span>
                  {c.sentAt && <span className="chip"> sent</span>}
                </span>
                {c.title && <span className="hint">{c.title}</span>}
                {c.emails.length > 0 && <span>✉ {c.emails.map((e) => e.value).join(", ")}</span>}
                {c.phones.length > 0 && <span>☎ {c.phones.map((p) => p.value).join(", ")}</span>}
                <span className="hint">{c.website ?? c.linkedinUrl}</span>
              </span>
            </label>
          ))}
          {shown.length > 300 && <p className="hint">Showing 300 of {shown.length}; search to narrow, or export all.</p>}
        </div>
      )}

      {items.length > 0 &&
        (confirmAll ? (
          <div className="row">
            <button className="btn btn--danger" onClick={() => void remove("all")}>
              Yes, delete all {items.length}
            </button>
            <button className="btn" onClick={() => setConfirmAll(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button className="btn btn--ghost" onClick={() => setConfirmAll(true)}>
            Delete everything saved
          </button>
        ))}
    </div>
  );
}

// ---- Settings ----

function SettingsTab({ settings, onSettings, status, onStatus }: { settings: Settings; onSettings: (s: Settings) => void; status: BackendStatus | null; onStatus: (s: BackendStatus) => void }) {
  const [skip, setSkip] = useState(settings.skipSites.join("\n"));
  const [backendUrl, setBackendUrl] = useState(status?.backendUrl ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status && !backendUrl) setBackendUrl(status.backendUrl);
  }, [status, backendUrl]);

  async function patch(p: Partial<Settings>) {
    const res = await send<Settings>({ type: "CF_SET_SETTINGS", patch: p });
    if (res.ok) onSettings(res.data);
  }

  async function toggleAllSites(on: boolean) {
    if (on) {
      const granted = await chrome.permissions.request({ origins: ALL_SITES });
      if (!granted) return;
    } else {
      await chrome.permissions.remove({ origins: ALL_SITES }).catch(() => false);
    }
    await patch({ allSites: on });
  }

  async function doLogin(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await send<BackendStatus>({ type: "CF_LOGIN", backendUrl, email, password });
    setBusy(false);
    setPassword("");
    if (res.ok) onStatus(res.data);
    else setError(res.error);
  }

  async function doLogout() {
    const res = await send<BackendStatus>({ type: "CF_LOGOUT" });
    if (res.ok) onStatus(res.data);
  }

  return (
    <>
      <div className="card form">
        <h2 className="form__title">Reading pages</h2>
        <label className="check">
          <input type="checkbox" checked={settings.autoSave} onChange={(e) => void patch({ autoSave: e.target.checked })} />
          Save what a page shows by itself
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.allSites} onChange={(e) => void toggleAllSites(e.target.checked)} />
          Read every website I open (not only LinkedIn)
        </label>
        <p className="hint">Chrome asks once to allow reading all sites. Without it, open the panel on a site and press “Allow reading this site”.</p>
        <label className="check">
          <input type="checkbox" checked={settings.contactPages} onChange={(e) => void patch({ contactPages: e.target.checked })} />
          When a site shows no email, also read its Contact/About pages (up to 4, once a day)
        </label>
        <label className="field">
          <span>Never read these sites (one per line)</span>
          <textarea rows={3} value={skip} onChange={(e) => setSkip(e.target.value)} onBlur={() => void patch({ skipSites: skip.split(/\s+/).map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "")).filter(Boolean) })} placeholder="mybank.com" />
        </label>
        <p className="hint">Only what a page shows is read: on LinkedIn, an email or phone appears only in “Contact info” when the person shares it with you. Nothing is guessed, and personal numbers are never looked up elsewhere.</p>
      </div>

      <div className="card form">
        <h2 className="form__title">Lead Platform</h2>
        {status?.loggedIn ? (
          <>
            <p className="hint">
              Logged in as {status.admin?.email} at {status.backendUrl}
            </p>
            <button className="btn" onClick={() => void doLogout()}>
              Log out
            </button>
          </>
        ) : (
          <form className="form" onSubmit={(e) => void doLogin(e)}>
            <p className="form__hint">Only needed to send contacts to the platform's Contacts page. Use your admin panel login.</p>
            <label className="field">
              <span>Platform address</span>
              <input value={backendUrl} onChange={(e) => setBackendUrl(e.target.value)} placeholder="https://lead.the360tech.com" />
            </label>
            <label className="field">
              <span>Email or username</span>
              <input autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="field">
              <span>Password</span>
              <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            {error && <p className="msg msg--error">{error}</p>}
            <button className="btn btn--primary" disabled={busy}>
              {busy ? "Logging in…" : "Log in"}
            </button>
          </form>
        )}
      </div>
    </>
  );
}

export function App() {
  const [tab, setTab] = useState<"page" | "saved" | "settings">("page");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<BackendStatus | null>(null);

  useEffect(() => {
    void send<Settings>({ type: "CF_SETTINGS" }).then((r) => r.ok && setSettings(r.data));
    void send<BackendStatus>({ type: "CF_STATUS" }).then((r) => r.ok && setStatus(r.data));
  }, []);

  return (
    <main className="panel">
      <header className="panel__header">
        <h1>Contact Finder</h1>
      </header>
      <nav className="tabs" role="tablist">
        {(
          [
            ["page", "This page"],
            ["saved", "Saved"],
            ["settings", "Settings"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>
      {tab === "page" && <ThisPage settings={settings} loggedIn={!!status?.loggedIn} />}
      {tab === "saved" && <Saved loggedIn={!!status?.loggedIn} />}
      {tab === "settings" && settings && <SettingsTab settings={settings} onSettings={setSettings} status={status} onStatus={setStatus} />}
    </main>
  );
}

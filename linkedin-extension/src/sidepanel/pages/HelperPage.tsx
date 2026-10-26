import { normalizeLinkedInProfileUrl, type LinkedInEducation, type LinkedInExperience, type LinkedInLeadInput } from "@platform/shared";
import { useEffect, useRef, useState } from "react";
import type { ProfileLink, ProfileReading } from "../../content/parse";
import type { BackendStatus } from "../../storage/auth";
import {
  addToQueue,
  BREAK_EVERY,
  clampDailyLimit,
  countTowardsTarget,
  DEFAULT_DAILY_LIMIT,
  isSecurityCheckUrl,
  localDay,
  MAX_DAILY_LIMIT,
  recordProfile,
  usedToday,
  loadHelperState, markSaved, nextPending, parsePastedLinks, roomForTarget, saveHelperState, setStatus, type HelperState, type QueueItem } from "../../storage/queue";
import { BackendStatusBar } from "../components/BackendStatusBar";
import { SearchFiltersForm } from "../components/SearchFiltersForm";
import { hasAnyFilter } from "../services/searchFilters";
import { backendClient } from "../services/backendClient";
import { askTab, contactInfoUrl, isContactInfoUrl, isPeopleSearchUrl, openInTab, peopleSearchUrl, useActiveTab } from "../services/tabs";

interface Props {
  backendStatus: BackendStatus;
  onLogout: () => void;
  onRetry: () => void;
}

/** Editable form values: lists as one entry per line. */
interface Draft {
  profileUrl: string;
  name: string;
  headline: string;
  company: string;
  location: string;
  emails: string;
  phones: string;
  websites: string;
  ims: string;
  /** One position per line: "Title | Company | Type | Dates | Location" */
  experience: string;
  /** One entry per line: "School | Degree | Dates" */
  education: string;
  birthday: string;
  address: string;
  connectedSince: string;
  notes: string;
}

const lines = (v: string) =>
  v
    .split(/\n+/)
    .map((x) => x.trim())
    .filter(Boolean);

const joinParts = (parts: (string | null)[]) => parts.map((p) => p ?? "").join(" | ").replace(/( \| )+$/, "");
const splitParts = (line: string) => line.split("|").map((p) => p.trim() || null);

export function experienceToLines(list: LinkedInExperience[] = []): string {
  return list.map((e) => joinParts([e.title, e.company, e.employmentType, e.dates, e.location])).join("\n");
}

export function linesToExperience(text: string): LinkedInExperience[] {
  return lines(text)
    .map(splitParts)
    .map(([title, company, employmentType, dates, location]) => ({
      title: title ?? "",
      company: company ?? null,
      employmentType: employmentType ?? null,
      dates: dates ?? null,
      location: location ?? null,
    }))
    .filter((e) => e.title);
}

export function educationToLines(list: LinkedInEducation[] = []): string {
  return list.map((e) => joinParts([e.school, e.degree, e.dates])).join("\n");
}

export function linesToEducation(text: string): LinkedInEducation[] {
  return lines(text)
    .map(splitParts)
    .map(([school, degree, dates]) => ({ school: school ?? "", degree: degree ?? null, dates: dates ?? null }))
    .filter((e) => e.school);
}

export function toDraft(profileUrl: string, r: ProfileReading["lead"]): Draft {
  return {
    profileUrl,
    name: r.name,
    headline: r.headline ?? "",
    company: r.company ?? "",
    location: r.location ?? "",
    emails: (r.emails ?? []).join("\n"),
    phones: (r.phones ?? []).join("\n"),
    websites: (r.websites ?? []).map((w) => (w.label ? `${w.url} (${w.label})` : w.url)).join("\n"),
    ims: (r.ims ?? []).join("\n"),
    experience: experienceToLines(r.experience),
    education: educationToLines(r.education),
    birthday: r.birthday ?? "",
    address: r.address ?? "",
    connectedSince: r.connectedSince ?? "",
    notes: "",
  };
}

export function fromDraft(d: Draft, tag: string): LinkedInLeadInput {
  const opt = (v: string) => v.trim() || null;
  return {
    profileUrl: d.profileUrl,
    name: d.name.trim(),
    headline: opt(d.headline),
    company: opt(d.company),
    location: opt(d.location),
    emails: lines(d.emails),
    phones: lines(d.phones),
    websites: lines(d.websites).map((l) => {
      const m = /^(.*?)\s*\(([^()]+)\)$/.exec(l);
      return m ? { url: m[1]!, label: m[2]! } : { url: l, label: null };
    }),
    ims: lines(d.ims),
    experience: linesToExperience(d.experience),
    education: linesToEducation(d.education),
    birthday: opt(d.birthday),
    address: opt(d.address),
    connectedSince: opt(d.connectedSince),
    notes: opt(d.notes),
    tag: opt(tag),
  };
}

/** Which of these profile URLs are already saved in the admin panel (empty if the backend is unreachable). */
async function savedSet(urls: string[]): Promise<Set<string>> {
  const saved = new Set<string>();
  for (let i = 0; i < urls.length; i += 500) {
    const res = await backendClient.checkSaved(urls.slice(i, i + 500));
    if (res.ok) for (const url of Object.keys(res.data.saved)) saved.add(normalizeLinkedInProfileUrl(url) ?? url);
  }
  return saved;
}

const STATUS_LABEL: Record<QueueItem["status"], string> = { pending: "To do", opened: "Opened", saved: "Saved", skipped: "Skipped" };

export function HelperPage({ backendStatus, onLogout, onRetry }: Props) {
  const tab = useActiveTab();
  const [state, setState] = useState<HelperState | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [contactInfoRead, setContactInfoRead] = useState(false);
  /** The profile in the form is already in the admin panel */
  const [alreadySaved, setAlreadySaved] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    loadHelperState().then(async (loaded) => {
      setState(loaded);
      // Profiles in the list that were saved since: mark them, so they are not opened again.
      const open = loaded.queue.filter((q) => q.status !== "saved").map((q) => q.profileUrl);
      const saved = await savedSet(open);
      if (saved.size) update((s) => ({ ...s, queue: markSaved(s.queue, saved) }));
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Updates and stores the state; pass a function when the change depends on the latest state. */
  function update(next: HelperState | ((prev: HelperState) => HelperState)) {
    setState((prev) => {
      const value = typeof next === "function" ? (prev ? next(prev) : prev) : next;
      if (value) {
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => saveHelperState(value).catch(console.error), 200);
      }
      return value;
    });
  }

  // LinkedIn showed a security check or sign-in wall: stop for today.
  useEffect(() => {
    if (state && isSecurityCheckUrl(tab?.url) && state.pausedOn !== localDay()) {
      update((s) => ({ ...s, pausedOn: localDay() }));
    }
  }, [tab?.url, state?.pausedOn]); // eslint-disable-line react-hooks/exhaustive-deps

  // A different profile in the tab: the form belongs to the old one. With "Read automatically",
  // a profile is reopened once with its Contact info dialog (/overlay/contact-info/) and read.
  const handled = useRef<string | null>(null); // "<profileUrl>|<dialog url?>" last handled
  const overlayOpened = useRef<string | null>(null); // profile whose Contact info we opened
  useEffect(() => {
    if (draft && tab?.profileUrl !== draft.profileUrl) {
      setDraft(null);
      setMessage(null);
    }
    if (tab?.kind !== "profile" || !state?.autoRead) return;
    const onDialog = isContactInfoUrl(tab.url);
    const key = `${tab.profileUrl}|${onDialog}`;
    if (handled.current === key) return;
    handled.current = key;
    if (onDialog) {
      overlayOpened.current = tab.profileUrl;
      void readProfile(true);
    } else if (overlayOpened.current !== tab.profileUrl && state.pausedOn !== localDay() && usedToday(state.usage) < state.dailyLimit) {
      void openContactInfo(); // the dialog URL then triggers the reading above
    }
    // else: the user closed the dialog; keep the form as it is
  }, [tab?.url, state?.autoRead]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Reopens the current profile with its Contact info dialog (same as clicking "Contact info"). */
  async function openContactInfo() {
    if (!tab?.profileUrl) return;
    overlayOpened.current = tab.profileUrl;
    handled.current = `${tab.profileUrl}|true`;
    setMessage({ tone: "ok", text: "Opening Contact info…" });
    await openInTab(tab.id, contactInfoUrl(tab.profileUrl));
  }

  /** Reads the open profile. With `waitForContactInfo`, waits a few seconds for the dialog to load. */
  async function readProfile(waitForContactInfo = false) {
    if (!tab || tab.kind !== "profile") return;
    const expected = tab.profileUrl;
    setBusy("read");
    setMessage(null);
    let res = await askTab<ProfileReading>(tab.id, { type: "LI_READ_PROFILE" });
    // The page and the dialog load after the URL changes: try again for a few seconds.
    for (let i = 0; i < 8 && (!res.ok || !res.data.lead.name || (waitForContactInfo && !res.data.contactInfoOpen)); i++) {
      await new Promise((r) => setTimeout(r, 1000));
      res = await askTab<ProfileReading>(tab.id, { type: "LI_READ_PROFILE" });
    }
    setBusy(null);
    if (!res.ok) return setMessage({ tone: "error", text: res.error });
    const url = res.data.profileUrl ?? expected!;
    if (url !== expected) return; // the user moved on meanwhile
    setDraft(toDraft(url, res.data.lead));
    setAlreadySaved(false);
    void savedSet([url]).then((saved) => setAlreadySaved(saved.has(url)));
    // Count the profile for today's pace; suggest a break every BREAK_EVERY profiles.
    // Only reading updates usage, so the state of this render is current enough for the count.
    const readToday = state ? usedToday(recordProfile(state.usage, url)) : 0;
    update((s) => ({ ...s, usage: recordProfile(s.usage, url) }));
    if (readToday > 0 && readToday % BREAK_EVERY === 0 && res.data.contactInfoOpen) {
      setMessage({ tone: "warn", text: `${readToday} profiles today. Take a 10–15 minute break before the next one.` });
    }
    setContactInfoRead(res.data.contactInfoOpen);
    if (!res.data.contactInfoOpen) {
      setMessage({ tone: "warn", text: "Contact info did not open. Click “Read with Contact info” to try again." });
    }
  }

  /** "Read" button: opens Contact info first when it is not open, then reads. */
  async function readWithContactInfo() {
    if (!tab || tab.kind !== "profile") return;
    if (isContactInfoUrl(tab.url)) return readProfile(true);
    await openContactInfo();
    if (!state?.autoRead) await readProfile(true); // with auto-read, the URL change triggers it
  }

  // "Add results automatically": each people-search results page the user opens (Next, 2, 3…)
  // is added to the list, up to the profile count.
  const autoAdd = useRef<() => void>(() => {});
  const searchHandled = useRef<string | null>(null);
  useEffect(() => {
    if (!state?.autoAdd || !tab?.url || !isPeopleSearchUrl(tab.url) || searchHandled.current === tab.url) return;
    searchHandled.current = tab.url;
    autoAdd.current();
  }, [tab?.url, state?.autoAdd]);

  // Keyboard shortcut (chrome://extensions/shortcuts, default Alt+N): the background forwards it here.
  const shortcut = useRef<() => void>(() => {});
  useEffect(() => {
    const listener = (message: { type?: string }) => {
      if (message?.type === "SHORTCUT_SAVE_AND_NEXT") shortcut.current();
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  if (!state) return <div className="loading">Loading…</div>;
  const queue = state.queue;
  const next = nextPending(queue);
  const counts = { total: queue.length, saved: queue.filter((q) => q.status === "saved").length, pending: queue.filter((q) => q.status === "pending").length };
  const room = roomForTarget(queue, state.target);
  const targetDone = !!state.target && counts.saved >= state.target;
  const today = usedToday(state.usage);
  const paused = state.pausedOn === localDay();
  const limitReached = today >= state.dailyLimit;
  /** Why no further profile may be opened today, or null. */
  const stopReason = paused
    ? "LinkedIn showed a security check today. Stop for today and continue tomorrow."
    : limitReached
      ? `Daily limit reached (${state.dailyLimit} profiles). Continue tomorrow.`
      : null;

  /** Saves the form; returns the updated list, or null when saving failed. */
  async function save(): Promise<QueueItem[] | null> {
    if (!draft || !state) return null;
    if (!draft.name.trim()) {
      setMessage({ tone: "error", text: "Name is required" });
      return null;
    }
    setBusy("save");
    const res = await backendClient.saveProfile(fromDraft(draft, state.tag));
    setBusy(null);
    if (!res.ok) {
      setMessage({ tone: "error", text: res.error });
      return null;
    }
    setMessage({ tone: "ok", text: res.data.result === "new" ? "Saved to LinkedIn Leads." : "Updated the saved profile." });
    setAlreadySaved(false);
    const updated = setStatus(queue, draft.profileUrl, "saved");
    update({ ...state, queue: updated });
    return updated;
  }

  function searchPeople() {
    if (!tab || !state) return;
    const keyword = state.keyword.trim();
    if (!keyword && !hasAnyFilter(state.filters)) return setMessage({ tone: "error", text: "Type what to search for, or set a filter" });
    void openInTab(tab.id, peopleSearchUrl(keyword, state.filters));
    update({ ...state, tag: state.tag || keyword });
    setMessage({ tone: "ok", text: "Search opened. When the results show, click “Add profiles on this page”. Go to the next results page on LinkedIn and add again." });
  }

  /**
   * Adds the profiles of the open results page. `afterNavigation`: the user just opened this
   * page, so wait until its results (not the previous page's) have loaded.
   */
  async function addFromPage(afterNavigation = false) {
    if (!tab || tab.kind === "other" || !state) return;
    if (room === 0) return setMessage({ tone: "ok", text: `Target of ${state.target} reached.` });
    setBusy("links");
    setMessage(null);
    const known = new Set(queue.map((q) => q.profileUrl));
    const isNew = (links: ProfileLink[]) => links.some((l) => !known.has(l.profileUrl));
    if (afterNavigation) await new Promise((r) => setTimeout(r, 1500));
    let res = await askTab<ProfileLink[]>(tab.id, { type: "LI_READ_LINKS" });
    for (let i = 0; afterNavigation && i < 5 && (!res.ok || !isNew(res.data)); i++) {
      await new Promise((r) => setTimeout(r, 1000));
      res = await askTab<ProfileLink[]>(tab.id, { type: "LI_READ_LINKS" });
    }
    if (!res.ok) {
      setBusy(null);
      return setMessage({ tone: "error", text: res.error });
    }
    await addLinks(res.data, "on this page");
  }
  autoAdd.current = () => void addFromPage(true);

  async function addLinks(links: { profileUrl: string; name?: string | null }[], where: string) {
    if (!state) return;
    // Profiles already saved in the admin panel are not added at all.
    const saved = await savedSet(links.map((l) => l.profileUrl));
    const fresh = links.filter((l) => !saved.has(l.profileUrl));
    let { queue: nextQueue, added } = addToQueue(queue, fresh, room);
    nextQueue = markSaved(nextQueue, saved);
    setBusy(null);
    update((s) => ({ ...s, queue: nextQueue }));
    const left = roomForTarget(nextQueue, state.target);
    const full = !state.target ? "" : left === 0 ? ` Target of ${state.target} reached.` : ` ${left} more to reach ${state.target}: open the next results page on LinkedIn.`;
    const skipped = links.length - fresh.length ? ` ${links.length - fresh.length} already saved in admin, skipped.` : "";
    setMessage({
      tone: added ? "ok" : "warn",
      text: links.length ? `${added} new profile${added === 1 ? "" : "s"} added (${links.length} found ${where}).${skipped}${full}` : `No profile links found ${where}.`,
    });
  }

  /** Opens the next profile with its Contact info dialog, in the current tab. One click, one profile. */
  async function openNext(list = queue) {
    if (!tab || !state) return;
    if (stopReason) return setMessage({ tone: "warn", text: stopReason });
    // Skip profiles that were saved meanwhile (e.g. opened by hand or on another computer).
    const pending = list.filter((q) => q.status === "pending").slice(0, 25);
    const saved = await savedSet(pending.map((q) => q.profileUrl));
    if (saved.size) list = markSaved(list, saved);
    const item = nextPending(list);
    if (!item) {
      update((s) => ({ ...s, queue: list }));
      return setMessage({ tone: "ok", text: "No unsaved profiles left in the list." });
    }
    await openInTab(tab.id, contactInfoUrl(item.profileUrl));
    update((s) => ({ ...s, queue: setStatus(list, item.profileUrl, "opened") }));
    setDraft(null);
    setMessage(null);
  }

  async function saveAndNext() {
    const updated = await save();
    if (!updated || !state) return;
    if (state.target && updated.filter((q) => q.status === "saved").length >= state.target) {
      setMessage({ tone: "ok", text: `Saved. Target of ${state.target} profiles reached.` });
      return;
    }
    if (stopReason) return setMessage({ tone: "warn", text: `Saved. ${stopReason}` });
    await openNext(updated);
  }
  shortcut.current = () => {
    if (busy) return;
    if (draft) void saveAndNext();
    else if (next) void openNext();
  };

  const field = (key: keyof Draft, label: string, multi = false) =>
    draft && (
      <label className="field">
        <span>{label}</span>
        {multi ? (
          <textarea rows={Math.max(1, draft[key].split("\n").length)} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
        ) : (
          <input value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
        )}
      </label>
    );

  return (
    <main className="panel">
      <header className="panel__header">
        <h1>LinkedIn Helper</h1>
      </header>

      <BackendStatusBar status={backendStatus} onLogout={onLogout} onRetry={onRetry} />

      <div className={`page-status page-status--${tab?.kind === "other" || !tab ? "off" : "on"}`}>
        <span className="dot" />
        <div>
          <strong>{tab?.kind === "profile" ? "Profile open" : tab?.kind === "linkedin" ? "LinkedIn open" : "Open LinkedIn in this tab"}</strong>
          <p>
            {tab?.kind === "profile"
              ? tab.profileUrl!.replace("https://www.", "")
              : tab?.kind === "linkedin"
                ? "On a results page, add the profiles to your list."
                : "This helper only reads pages you open on linkedin.com."}
          </p>
        </div>
      </div>

      <section className="card form">
        <h2 className="form__title">1. Search people</h2>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            searchPeople();
          }}
        >
          <input className="input" value={state.keyword} maxLength={200} onChange={(e) => update({ ...state, keyword: e.target.value })} placeholder="e.g. HR manager Lucknow" aria-label="Search keyword" />
          <button type="submit" className="btn btn--primary" disabled={!tab}>
            Search
          </button>
        </form>
        <SearchFiltersForm filters={state.filters} onChange={(filters) => update({ ...state, filters })} tabUrl={tab?.url ?? null} />
        <p className="hint">Opens LinkedIn people search (People filter) in this tab. Shortcut for “Save & open next”: Alt+N.</p>
      </section>

      <section className={`card form pace${stopReason ? " pace--stop" : ""}`}>
        <div className="row row--between">
          <h2 className="form__title">Today</h2>
          <span className="hint">
            {today}/{state.dailyLimit} profiles
          </span>
        </div>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={state.dailyLimit} aria-valuenow={Math.min(today, state.dailyLimit)}>
          <div className={`progress__bar${today >= state.dailyLimit * 0.8 ? " progress__bar--warn" : ""}`} style={{ width: `${Math.min(100, (today / state.dailyLimit) * 100)}%` }} />
        </div>
        {stopReason && <p className="msg msg--error">{stopReason}</p>}
        {paused && (
          <button type="button" className="link link--left" onClick={() => update((s) => ({ ...s, pausedOn: null }))}>
            I solved the check and want to continue
          </button>
        )}
        <label className="field">
          <span>Daily limit (profiles per day, max {MAX_DAILY_LIMIT})</span>
          <input
            type="number"
            min={1}
            max={MAX_DAILY_LIMIT}
            value={state.dailyLimit}
            onChange={(e) => update((s) => ({ ...s, dailyLimit: clampDailyLimit(Number(e.target.value)) }))}
          />
        </label>
        <p className="hint">
          LinkedIn publishes no number. About {DEFAULT_DAILY_LIMIT} a day is usual for a free account, up to {MAX_DAILY_LIMIT} with Premium. A break is suggested every {BREAK_EVERY} profiles.
        </p>
      </section>

      <label className="field">
        <span>Profile count (target for this round)</span>
        <input
          type="number"
          min={1}
          max={1000}
          value={state.target ?? ""}
          onChange={(e) => {
            const n = Math.floor(Number(e.target.value));
            update({ ...state, target: n > 0 ? Math.min(n, 1000) : null });
          }}
          placeholder="e.g. 50 (empty = no limit)"
        />
        {state.target && state.target - counts.saved > state.dailyLimit - today && (
          <span className="hint">Only {Math.max(0, state.dailyLimit - today)} more profiles fit in today’s limit; the rest can wait for tomorrow.</span>
        )}
      </label>

      <label className="field">
        <span>Tag for saved profiles</span>
        <input value={state.tag} maxLength={100} onChange={(e) => update({ ...state, tag: e.target.value })} placeholder="e.g. HR Lucknow" />
      </label>

      <section className="card form">
        <div className="row row--between">
          <h2 className="form__title">3. This profile</h2>
          <label className="check hint">
            <input type="checkbox" checked={state.autoRead} onChange={(e) => update({ ...state, autoRead: e.target.checked })} />
            Read automatically
          </label>
        </div>
        {!draft ? (
          <>
            <p className="form__hint">{busy === "read" ? "Reading the profile…" : "Open any profile: Contact info opens and is read automatically."}</p>
            <button type="button" className="btn btn--primary" disabled={tab?.kind !== "profile" || busy === "read"} onClick={readWithContactInfo}>
              {busy === "read" ? "Reading…" : "Read with Contact info"}
            </button>
          </>
        ) : (
          <>
            {alreadySaved && <p className="msg msg--warn">Already saved in admin. Save will update it (no duplicate).</p>}
            {!contactInfoRead && <p className="hint">Contact info was not open: only the top card was read.</p>}
            {field("name", "Name")}
            {field("headline", "Headline / designation")}
            {field("company", "Company")}
            {field("location", "Location")}
            {field("emails", "Emails (one per line)", true)}
            {field("phones", "Phones (one per line)", true)}
            {field("websites", "Websites (one per line)", true)}
            {field("ims", "IM", true)}
            {field("experience", "Experience (Title | Company | Type | Dates | Location)", true)}
            {field("education", "Education (School | Degree | Dates)", true)}
            {field("birthday", "Birthday")}
            {field("connectedSince", "Connected since")}
            {field("address", "Address")}
            {field("notes", "Notes", true)}
            <div className="row">
              <button type="button" className="btn btn--primary" disabled={!!busy || !next || !!stopReason} onClick={saveAndNext} title={stopReason ?? (next ? `Then opens ${next.name ?? next.profileUrl}` : undefined)}>
                {busy === "save" ? "Saving…" : "Save & open next"}
              </button>
              <button type="button" className="btn" disabled={!!busy} onClick={() => save()}>
                Save
              </button>
              <button type="button" className="btn" disabled={!!busy} onClick={readWithContactInfo}>
                Read again
              </button>
            </div>
          </>
        )}
        {message && (
          <p className={`msg msg--${message.tone}`} role="status">
            {message.text}
          </p>
        )}
      </section>

      <section className="card form">
        <div className="row row--between">
          <h2 className="form__title">2. My list</h2>
          <span className="hint">
            {state.target ? `${counts.saved}/${state.target} saved` : `${counts.saved}/${counts.total} saved`} · {counts.pending} to do
          </span>
        </div>
        <label className="check hint">
          <input type="checkbox" checked={state.autoAdd} onChange={(e) => update({ ...state, autoAdd: e.target.checked })} />
          Add results automatically when I open a results page (Next, 2, 3…)
          {state.target ? ` · in list: ${countTowardsTarget(queue)}/${state.target}` : ""}
        </label>
        {state.target && (
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={state.target} aria-valuenow={Math.min(counts.saved, state.target)}>
            <div className="progress__bar" style={{ width: `${Math.min(100, (counts.saved / state.target) * 100)}%` }} />
          </div>
        )}
        {targetDone && <p className="msg msg--ok">Target reached: {state.target} profiles saved. Raise the count or clear the list to start a new round.</p>}
        <button type="button" className="btn btn--primary" disabled={!next || !tab || tab.kind === "other" || !!stopReason} onClick={() => openNext()} title={stopReason ?? (next ? next.profileUrl : undefined)}>
          {next ? `Open next profile${next.name ? `: ${next.name}` : ""}` : "No profiles to do"}
        </button>
        <div className="row">
          <button type="button" className="btn" disabled={!tab || tab.kind === "other" || busy === "links" || room === 0} onClick={() => addFromPage()} title={room === 0 ? "Target reached" : undefined}>
            {busy === "links" ? "Reading…" : room === 0 ? "Target reached" : "Add profiles on this page"}
          </button>
          <button type="button" className="btn" onClick={() => setPasting(!pasting)}>
            Paste links
          </button>
        </div>
        {pasting && (
          <>
            <label className="field">
              <span>Profile links, one per line</span>
              <textarea rows={4} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="https://www.linkedin.com/in/…" />
            </label>
            <button
              type="button"
              className="btn"
              onClick={async () => {
                await addLinks(parsePastedLinks(pasted), "in the pasted text");
                setPasted("");
                setPasting(false);
              }}
            >
              Add to list
            </button>
          </>
        )}
        {queue.length > 0 && (
          <ul className="list">
            {queue.map((q) => (
              <li key={q.profileUrl} className={`list__item list__item--${q.status}`}>
                <div className="list__text">
                  <strong>{q.name ?? q.profileUrl.replace("https://www.linkedin.com/in/", "")}</strong>
                  <span>{STATUS_LABEL[q.status]}</span>
                </div>
                {q.status !== "saved" && (
                  <button type="button" className="link" onClick={() => update({ ...state, queue: setStatus(queue, q.profileUrl, q.status === "skipped" ? "pending" : "skipped") })}>
                    {q.status === "skipped" ? "Undo" : "Skip"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {queue.length > 0 && (
          <div className="row">
            <button type="button" className="link" onClick={() => update({ ...state, queue: queue.filter((q) => q.status === "pending" || q.status === "opened") })}>
              Remove saved and skipped
            </button>
            <button type="button" className="link btn--danger" onClick={() => update({ ...state, queue: [] })}>
              Clear list
            </button>
          </div>
        )}
      </section>

      <p className="hint">The helper never searches, clicks or opens profiles by itself: every step is your click. Respect LinkedIn’s limits and people’s privacy.</p>
    </main>
  );
}

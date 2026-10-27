// Works through the backend's Instagram queue one message at a time while the user has
// pressed Start. The backend decides when the next message is due (gap, daily cap, hours);
// this only asks, opens the profile in one Instagram tab, hands the message to the page and
// reports the outcome. Chrome APIs are behind RunnerDeps so the logic is unit-testable.

import type { SendOutcome } from "../content/instagram";
import type { ContentRequest, LogEntry, NextResponse, RunnerState } from "../messages";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; unauthorized?: boolean };

export interface RunnerDeps {
  api: {
    next(): Promise<ApiResult<NextResponse>>;
    report(messageId: string, status: SendOutcome["status"], error: string | null): Promise<ApiResult<unknown>>;
  };
  tabs: {
    /** Opens the URL in the work tab (reusing it if it still exists); returns its id. */
    open(url: string, active: boolean, reuseTabId: number | null): Promise<number>;
    waitLoaded(tabId: number, timeoutMs: number): Promise<boolean>;
    exists(tabId: number): Promise<boolean>;
    /** Delivers a request to the page; false if the content script did not answer. */
    send(tabId: number, request: ContentRequest): Promise<boolean>;
  };
  store: {
    load(): Promise<StoredRunner>;
    save(state: StoredRunner): Promise<void>;
  };
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface PendingReport {
  messageId: string;
  status: SendOutcome["status"];
  error: string | null;
}

export interface StoredRunner extends RunnerState {
  workTabId: number | null;
  pendingReports: PendingReport[];
}

export const EMPTY_RUNNER: StoredRunner = { running: false, current: null, waiting: null, lastError: null, log: [], workTabId: null, pendingReports: [] };

const MAX_LOG = 40;
/** Assisted mode waits up to 10 minutes for the user; give the page a little longer to report. */
export const CURRENT_TIMEOUT_MS = 12 * 60_000;

const OUTCOME_TEXT: Record<SendOutcome["status"], string> = { sent: "Sent to", skipped: "Skipped", failed: "Failed for", blocked: "Stopped at" };

export class Runner {
  private busy: Promise<void> | null = null;

  constructor(private readonly deps: RunnerDeps) {}

  private log(s: StoredRunner, level: LogEntry["level"], text: string) {
    s.log = [{ at: this.deps.now(), level, text }, ...s.log].slice(0, MAX_LOG);
  }

  /** Serializes everything that changes the stored state. */
  private exclusive(fn: () => Promise<void>): Promise<void> {
    const run = (this.busy ?? Promise.resolve()).then(fn, fn);
    this.busy = run.finally(() => {
      if (this.busy === run) this.busy = null;
    });
    return run;
  }

  state(): Promise<StoredRunner> {
    return this.deps.store.load();
  }

  start() {
    return this.exclusive(async () => {
      const s = await this.deps.store.load();
      s.running = true;
      s.lastError = null;
      this.log(s, "info", "Started");
      await this.deps.store.save(s);
    }).then(() => this.tick());
  }

  stop() {
    return this.exclusive(async () => {
      const s = await this.deps.store.load();
      s.running = false;
      s.waiting = null;
      this.log(s, "info", s.current ? "Stopping after the current message" : "Stopped");
      await this.deps.store.save(s);
    });
  }

  /** Gives up on the current message (assisted mode: the user does not want to send it). */
  skipCurrent() {
    return this.exclusive(async () => {
      const s = await this.deps.store.load();
      if (!s.current) return;
      const answered = await this.deps.tabs.send(s.current.tabId, { type: "LM_ABORT", messageId: s.current.id });
      // The page reports "Skipped by you" itself; if it is gone, record it here.
      if (!answered) await this.finish(s, s.current.id, { status: "skipped", reason: "Skipped by you" });
      await this.deps.store.save(s);
    });
  }

  /** The page finished a message. */
  onResult(messageId: string, outcome: SendOutcome) {
    return this.exclusive(async () => {
      const s = await this.deps.store.load();
      if (s.current?.id !== messageId) return; // late or repeated
      await this.finish(s, messageId, outcome);
      await this.deps.store.save(s);
    });
  }

  private async finish(s: StoredRunner, messageId: string, outcome: SendOutcome) {
    const name = s.current?.id === messageId ? s.current.contactName : "a contact";
    const error = outcome.status === "sent" ? null : outcome.reason;
    this.log(s, outcome.status === "sent" ? "ok" : outcome.status === "skipped" ? "warn" : "error", `${OUTCOME_TEXT[outcome.status]} ${name}${error ? `: ${error}` : ""}`);
    if (s.current?.id === messageId) s.current = null;
    if (outcome.status === "blocked") {
      s.running = false;
      s.lastError = outcome.reason;
    }
    const res = await this.deps.api.report(messageId, outcome.status, error);
    if (!res.ok) {
      s.pendingReports.push({ messageId, status: outcome.status, error });
      this.log(s, "warn", `Could not record the result yet (${res.error}); will retry`);
    }
  }

  /** One step: flush reports, watch the current message, or fetch and start the next one. */
  tick() {
    return this.exclusive(async () => {
      const s = await this.deps.store.load();

      if (s.pendingReports.length) {
        const left: PendingReport[] = [];
        for (const r of s.pendingReports) {
          const res = await this.deps.api.report(r.messageId, r.status, r.error);
          // 409 = already recorded (or timed out on the backend): nothing more to do.
          if (!res.ok && !/already|409/i.test(res.error)) left.push(r);
        }
        s.pendingReports = left;
      }

      if (s.current) {
        const gone = !(await this.deps.tabs.exists(s.current.tabId));
        if (gone) await this.finish(s, s.current.id, { status: "skipped", reason: "The Instagram tab was closed" });
        else if (this.deps.now() - s.current.startedAt > CURRENT_TIMEOUT_MS) {
          await this.finish(s, s.current.id, { status: "failed", reason: "The Instagram tab stopped responding; check the conversation" });
        }
        await this.deps.store.save(s);
        return;
      }
      if (!s.running) return this.deps.store.save(s);

      const next = await this.deps.api.next();
      if (!next.ok) {
        s.lastError = next.error;
        if (next.unauthorized) {
          s.running = false;
          this.log(s, "error", "Logged out of the backend; log in again");
        }
        return this.deps.store.save(s);
      }
      s.lastError = null;
      if ("wait" in next.data) {
        s.waiting = next.data.wait;
        return this.deps.store.save(s);
      }

      const m = next.data.message;
      s.waiting = null;
      this.log(s, "info", `Opening ${m.contactName} (${m.campaignName}, ${m.mode})`);
      const tabId = await this.deps.tabs.open(m.profileUrl, m.mode === "assisted", s.workTabId);
      s.workTabId = tabId;
      s.current = { id: m.id, campaignName: m.campaignName, contactName: m.contactName, profileUrl: m.profileUrl, mode: m.mode, body: m.body, tabId, startedAt: this.deps.now() };
      await this.deps.store.save(s);

      await this.deps.tabs.waitLoaded(tabId, 30_000);
      let delivered = false;
      for (let i = 0; i < 4 && !delivered; i++) {
        if (i) await this.deps.sleep(1500);
        delivered = await this.deps.tabs.send(tabId, { type: "LM_SEND", messageId: m.id, job: { body: m.body, mode: m.mode, contactName: m.contactName, profileUrl: m.profileUrl } });
      }
      if (!delivered) {
        await this.finish(s, m.id, { status: "failed", reason: "Could not reach the Instagram tab (is the extension allowed on instagram.com?)" });
        await this.deps.store.save(s);
      }
    });
  }
}

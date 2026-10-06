import type { AiAction } from "@platform/shared";
import { parseMapsPage } from "../utils/maps";
import type { ContentCommand, ContentEvent, MessageResponse } from "../utils/messages";
import { DomMapsPage } from "./maps/page";
import { runCollection } from "./maps/runner";

// 1) Reports which Maps page is open (Maps is a single-page app, so the URL is re-checked).
// 2) Runs the collector when the background asks for it.

let lastUrl = "";
let alive = true;

async function send(event: ContentEvent): Promise<void> {
  await chrome.runtime.sendMessage(event).catch(() => {
    // Extension was reloaded; this orphaned script can no longer talk to it.
    alive = false;
    clearInterval(pageTimer);
  });
}

/** Like send(), but waits for the background's answer. */
async function request<T>(event: ContentEvent): Promise<MessageResponse<T>> {
  try {
    return ((await chrome.runtime.sendMessage(event)) as MessageResponse<T> | undefined) ?? { ok: false, error: "No answer from the extension" };
  } catch {
    return { ok: false, error: "The extension is not reachable" };
  }
}

function reportPage() {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  send({ type: "PAGE_STATE", page: parseMapsPage(location.href) });
}

const pageTimer = setInterval(reportPage, 1000);
reportPage();

// ---- Collector ----

const HEARTBEAT_MS = 10_000;
let current: { runId: string; control: "run" | "pause" | "stop" } | null = null;

async function startRun(cmd: Extract<ContentCommand, { type: "RUN_JOB" }>) {
  if (current) current.control = "stop"; // never two loops at once
  const run = { runId: cmd.runId, control: "run" as "run" | "pause" | "stop" };
  current = run;

  const heartbeat = setInterval(() => send({ type: "JOB_HEARTBEAT", runId: run.runId }), HEARTBEAT_MS);
  try {
    const outcome = await runCollection(
      new DomMapsPage(document),
      {
        searchKeyword: cmd.searchKeyword,
        location: cmd.location,
        fields: cmd.fields,
        maxRecords: cmd.maxRecords,
        processedKeys: cmd.processedKeys,
        delayMs: cmd.delayMs,
      },
      {
        control: () => (alive ? run.control : "stop"),
        onProcessed: (clientKey) => send({ type: "JOB_PROCESSED", runId: run.runId, clientKey }),
        onListing: (listing) => send({ type: "JOB_LISTING", runId: run.runId, listing }),
        onError: (clientKey, name, message) => send({ type: "JOB_ITEM_ERROR", runId: run.runId, clientKey, name, message }),
        // Only when the user turned AI assist on for this job.
        assist: cmd.aiAssist
          ? async (snapshot, history) => {
              const res = await request<AiAction>({ type: "JOB_AI_ASSIST", runId: run.runId, snapshot, history });
              return res.ok ? { ok: true, action: res.data } : { ok: false, error: res.error };
            }
          : undefined,
      },
    );
    await send({ type: "JOB_FINISHED", runId: run.runId, outcome });
  } catch (err) {
    console.error("[maps-collector] run crashed", err);
    const message = err instanceof Error ? err.message : String(err);
    await send({ type: "JOB_FINISHED", runId: run.runId, outcome: { reason: "crashed", message } });
  } finally {
    clearInterval(heartbeat);
    if (current === run) current = null;
  }
}

chrome.runtime.onMessage.addListener((message: ContentCommand, sender, sendResponse) => {
  // Only accept commands from our own extension (background), never from page scripts.
  if (sender.id !== chrome.runtime.id || sender.tab) return false;

  if (message.type === "RUN_JOB") {
    startRun(message);
    sendResponse({ ok: true });
  } else if (message.type === "CONTROL") {
    if (current?.runId === message.runId) current.control = message.control;
    sendResponse({ ok: true });
  }
  return false;
});

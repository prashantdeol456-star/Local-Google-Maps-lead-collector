import { describe, expect, it } from "vitest";
import { AI_ACTION_JSON_SCHEMA, AI_ACTIONS, checkAiAction } from "../src/aiNavigation.js";

const snapshot = {
  hasSearchBox: true,
  candidates: [
    { i: 0, role: "button" as const, label: "Back" },
    { i: 3, role: "link" as const, label: "ERA University" },
  ],
};

describe("checkAiAction", () => {
  it("accepts a click on a listed element, ignoring enum casing", () => {
    expect(checkAiAction({ action: "Click", target: 3, seconds: 0, stopReason: "None", note: "Open the  results\n list" }, snapshot)).toEqual({
      ok: true,
      action: { action: "click", target: 3, seconds: 0, stopReason: "none", note: "Open the results list" },
    });
  });

  it("rejects clicks on elements the extension did not list, and unknown actions", () => {
    expect(checkAiAction({ action: "click", target: 7 }, snapshot)).toMatchObject({ ok: false, error: expect.stringContaining("not one of the listed") });
    expect(checkAiAction({ action: "click", target: "#login" }, snapshot)).toMatchObject({ ok: false });
    expect(checkAiAction({ action: "navigate", url: "https://evil.example" }, snapshot)).toMatchObject({ ok: false, error: expect.stringContaining("Unknown action") });
    expect(checkAiAction({ action: "type", text: "anything" }, snapshot)).toMatchObject({ ok: false });
    expect(checkAiAction("click 3", snapshot)).toMatchObject({ ok: false });
    expect(checkAiAction({ action: "search" }, { ...snapshot, hasSearchBox: false })).toMatchObject({ ok: false });
  });

  it("ignores targets for non-click actions, clamps waits, and always gives stop a reason", () => {
    expect(checkAiAction({ action: "scroll_results", target: 3 }, snapshot)).toMatchObject({ ok: true, action: { target: -1 } });
    expect(checkAiAction({ action: "wait", seconds: 60 }, snapshot)).toMatchObject({ ok: true, action: { seconds: 5 } });
    expect(checkAiAction({ action: "wait", seconds: 0 }, snapshot)).toMatchObject({ ok: true, action: { seconds: 1 } });
    expect(checkAiAction({ action: "stop", stopReason: "none" }, snapshot)).toMatchObject({ ok: true, action: { stopReason: "unknown_layout" } });
    expect(checkAiAction({ action: "stop", stopReason: "NEEDS_USER" }, snapshot)).toMatchObject({ ok: true, action: { stopReason: "needs_user" } });
    expect(checkAiAction({ action: "done", stopReason: "no_results" }, snapshot)).toMatchObject({ ok: true, action: { stopReason: "none" } });
  });

  it("schema lists every action and requires every field (flat, for structured outputs)", () => {
    expect(AI_ACTION_JSON_SCHEMA.properties.action.enum).toEqual([...AI_ACTIONS]);
    expect([...AI_ACTION_JSON_SCHEMA.required].sort()).toEqual(Object.keys(AI_ACTION_JSON_SCHEMA.properties).sort());
  });
});

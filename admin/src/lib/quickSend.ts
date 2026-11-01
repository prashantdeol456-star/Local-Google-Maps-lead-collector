// Hands the leads saved on the Quick Send page to the new email / WhatsApp campaign form
// (too many ids for a URL, so they wait in sessionStorage).

const KEY = "quick-send";

export interface QuickSendHandoff {
  list: string;
  leadIds: string[];
}

export function setQuickSend(handoff: QuickSendHandoff) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(handoff));
  } catch {
    // storage blocked: the campaign form falls back to filters
  }
}

export function getQuickSend(): QuickSendHandoff | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as QuickSendHandoff | null;
    return value && Array.isArray(value.leadIds) ? value : null;
  } catch {
    return null;
  }
}

/** Lead ids preselected for a new campaign: ?leadIds=a,b or ?quickSend=1. */
export function preselectedLeadIds(params: URLSearchParams): string[] {
  if (params.get("quickSend") === "1") return getQuickSend()?.leadIds ?? [];
  return (params.get("leadIds") ?? "").split(",").filter(Boolean);
}

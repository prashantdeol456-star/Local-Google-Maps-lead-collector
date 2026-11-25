// Justdial pace, chosen with the Slow ↔ Fast slider in the side panel (1 = slowest, 5 = fastest).
// Kept in chrome.storage.local on its own, so it can be changed while a job runs: the background
// reads it before every scroll request and every business page.

export const JD_SPEED_KEY = "jd-speed";
export const JD_SPEED_DEFAULT = 2;

export interface JdPace {
  label: string;
  /** Part of the screen height per scroll step */
  step: number;
  /** Pause between scroll steps, ms (from, to) */
  stepPause: [number, number];
  /** Pause after new businesses arrived, before scrolling on, ms (from, to) */
  afterLoad: [number, number];
  /** Pause between two business pages, ms */
  profileDelay: number;
  /** Rough time per 10 businesses on the list, for the hint */
  per10: string;
}

export const JD_PACES: Record<1 | 2 | 3 | 4 | 5, JdPace> = {
  1: { label: "Very slow", step: 0.3, stepPause: [1400, 2200], afterLoad: [8000, 12000], profileDelay: 5000, per10: "35–50 s" },
  2: { label: "Slow", step: 0.4, stepPause: [900, 1500], afterLoad: [5000, 8000], profileDelay: 3500, per10: "20–30 s" },
  3: { label: "Normal", step: 0.5, stepPause: [600, 1000], afterLoad: [3000, 5000], profileDelay: 2500, per10: "12–20 s" },
  4: { label: "Fast", step: 0.6, stepPause: [400, 650], afterLoad: [1500, 3000], profileDelay: 1800, per10: "8–12 s" },
  5: { label: "Very fast", step: 0.8, stepPause: [250, 400], afterLoad: [800, 1500], profileDelay: 1200, per10: "5–8 s" },
};

export function clampSpeed(value: unknown): 1 | 2 | 3 | 4 | 5 {
  const n = Math.round(Number(value));
  return (Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : JD_SPEED_DEFAULT) as 1 | 2 | 3 | 4 | 5;
}

export const paceOf = (speed: unknown): JdPace => JD_PACES[clampSpeed(speed)];

/** A random time in the range (so the pace does not look mechanical). */
export const between = ([from, to]: [number, number]) => from + Math.random() * (to - from);

export async function loadJdSpeed(): Promise<1 | 2 | 3 | 4 | 5> {
  const got = (await chrome.storage.local.get(JD_SPEED_KEY))[JD_SPEED_KEY];
  return got === undefined ? JD_SPEED_DEFAULT : clampSpeed(got);
}

export function saveJdSpeed(speed: number): Promise<void> {
  return chrome.storage.local.set({ [JD_SPEED_KEY]: clampSpeed(speed) });
}

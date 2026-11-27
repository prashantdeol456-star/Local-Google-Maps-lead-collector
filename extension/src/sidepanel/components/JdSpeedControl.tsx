import { useEffect, useState } from "react";
import { clampSpeed, JD_PACES, JD_SPEED_DEFAULT, JD_SPEED_KEY, loadJdSpeed, saveJdSpeed } from "../../utils/jdSpeed";

// Slow ↔ Fast for Justdial and Grotal: how calmly the list is scrolled and business pages are opened.
// Works while a job runs: the next scroll uses the new pace.

export function JdSpeedControl({ site = "Justdial" }: { site?: "Justdial" | "Grotal" }) {
  const [speed, setSpeed] = useState<number>(JD_SPEED_DEFAULT);

  useEffect(() => {
    void loadJdSpeed().then(setSpeed);
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes[JD_SPEED_KEY]) setSpeed(clampSpeed(changes[JD_SPEED_KEY].newValue));
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  const pace = JD_PACES[clampSpeed(speed)];
  return (
    <div className="card form jd-speed">
      <label className="field">
        <span>{site} speed: {pace.label}</span>
        <div className="jd-speed__row">
          <small className="hint">Slow</small>
          <input
            type="range"
            min={1}
            max={5}
            step={1}
            value={speed}
            aria-label={`${site} speed`}
            onChange={(e) => {
              const next = clampSpeed(e.target.valueAsNumber);
              setSpeed(next);
              void saveJdSpeed(next);
            }}
          />
          <small className="hint">Fast</small>
        </div>
        <small className="hint">
          {site === "Grotal" ? (
            <>{pace.profileDelay / 1000} s between pages (each list page has 20 businesses). You can change it while a job runs. Slower is kinder to Grotal and less likely to be blocked.</>
          ) : (
            <>
              About {pace.per10} per 10 businesses while scrolling the list, then {pace.profileDelay / 1000} s between business pages. You can change it while a job runs. Slower is
              safer: Justdial may show a security check when it is too fast.
            </>
          )}
        </small>
      </label>
    </div>
  );
}

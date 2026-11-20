import { useEffect, useState } from "react";
import {
  buildSearchQuery,
  COLLECTOR_FIELDS,
  isOn,
  JD_SHOW_NUMBER_DAILY_LIMIT,
  MAX_RECORDS_LIMIT,
  parseKeywords,
  type CollectorSettings,
  type SettingsErrors,
} from "@platform/shared";
import { send } from "../services/collectorClient";

interface Props {
  settings: CollectorSettings;
  errors: SettingsErrors;
  disabled: boolean;
  onChange: (s: CollectorSettings) => void;
  onOpenSearch: (query: string) => void;
}

export function SettingsForm({ settings, errors, disabled, onChange, onOpenSearch }: Props) {
  const keywords = parseKeywords(settings.keyword);
  const query = buildSearchQuery(keywords[0] ?? "", settings.location);
  const justdial = settings.source === "justdial";
  const [templates, setTemplates] = useState<{ id: string; name: string }[] | null>(null);

  useEffect(() => {
    if (!justdial || templates) return;
    send<{ id: string; name: string }[]>({ type: "GET_EMAIL_TEMPLATES" }).then((res) => setTemplates(res.ok ? res.data : []));
  }, [justdial, templates]);

  return (
    <fieldset className="card form" disabled={disabled}>
      <div className="fields">
        <span className="fields__title">Collect from</span>
        <div className="fields__grid">
          <label className="check">
            <input type="radio" name="source" checked={!justdial} onChange={() => onChange({ ...settings, source: "google_maps" })} />
            Google Maps
          </label>
          <label className="check">
            <input type="radio" name="source" checked={justdial} onChange={() => onChange({ ...settings, source: "justdial" })} />
            Justdial
          </label>
        </div>
      </div>

      <label className="field">
        <span>Search Keyword</span>
        <textarea
          rows={2}
          placeholder="University"
          value={settings.keyword}
          maxLength={2200}
          onChange={(e) => onChange({ ...settings, keyword: e.target.value })}
        />
        {errors.keyword && settings.keyword !== "" ? (
          <small className="error">{errors.keyword}</small>
        ) : keywords.length > 1 ? (
          <small className="hint">
            {keywords.length} searches will be queued
            {isOn(settings.autoNext) ? ", one after another by themselves" : "; you start each one"}: {keywords.join(" → ")}
          </small>
        ) : (
          <small className="hint">Tip: separate keywords with commas to queue several searches.</small>
        )}
      </label>

      <label className="field">
        <span>{justdial ? "City" : "Location"}</span>
        <input
          type="text"
          placeholder="Lucknow"
          value={settings.location}
          maxLength={100}
          onChange={(e) => onChange({ ...settings, location: e.target.value })}
        />
        {errors.location && <small className="error">{errors.location}</small>}
      </label>

      <label className="field">
        <span>Maximum Records</span>
        <input
          type="number"
          min={1}
          max={MAX_RECORDS_LIMIT}
          step={1}
          value={Number.isNaN(settings.maxRecords) ? "" : settings.maxRecords}
          onChange={(e) => onChange({ ...settings, maxRecords: e.target.valueAsNumber })}
        />
        {errors.maxRecords && <small className="error">{errors.maxRecords}</small>}
      </label>

      {justdial ? (
        <div className="fields">
          <span className="fields__title">Justdial</span>
          <label className="check" title="Address, website, year established, timings and photo links from each business page.">
            <input type="checkbox" checked={isOn(settings.jdOpenProfiles)} onChange={(e) => onChange({ ...settings, jdOpenProfiles: e.target.checked })} />
            Open each business page for details
          </label>
          <label className="check" title="Finds the same business on Google Maps (in another background tab) for its phone, website and Maps rating.">
            <input type="checkbox" checked={isOn(settings.jdMatchMaps)} onChange={(e) => onChange({ ...settings, jdMatchMaps: e.target.checked })} />
            Add phone and website from Google Maps
          </label>
          <label className="check" title="Uses your Justdial login. Justdial may share your number with the business, ask you to log in, or limit your account.">
            <input type="checkbox" checked={settings.jdShowNumber === true} onChange={(e) => onChange({ ...settings, jdShowNumber: e.target.checked })} />
            Press “Show Number” when no phone was found (max {JD_SHOW_NUMBER_DAILY_LIMIT} a day)
          </label>
          {settings.jdShowNumber === true && (
            <small className="hint">Justdial may share your own number with each business you press it for, and may ask you to log in. Off is safer.</small>
          )}
          <label className="field">
            <span>Email campaign for new leads</span>
            <select
              value={settings.jdTemplateId ?? ""}
              onChange={(e) => onChange({ ...settings, jdTemplateId: e.target.value || null })}
            >
              <option value="">No, only collect</option>
              {(templates ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  Yes, with template “{t.name}”
                </option>
              ))}
            </select>
            <small className="hint">
              {templates && templates.length === 0
                ? "Make an email template in the admin panel (Templates) to use this."
                : "When the search finishes, leads whose website shows an email go into an email campaign with this template, sent from your sender with an unsubscribe link."}
            </small>
          </label>
          <small className="hint">Runs in a tab behind yours, page by page with pauses. Justdial does not allow automated collection, so your Justdial access is at your own risk; the job stops if Justdial shows a security check.</small>
        </div>
      ) : (
      <>
      <button
        type="button"
        className="btn btn--ghost"
        disabled={disabled || keywords.length === 0}
        onClick={() => onOpenSearch(query)}
        title={query ? `Open "${query}" in Google Maps` : undefined}
      >
        Open search in Maps
      </button>

      <div className="fields">
        <span className="fields__title">Hands-off</span>
        <label className="check" title="Name, phone, website, address and rating are read from the results list. Much faster than opening every listing.">
          <input type="checkbox" checked={isOn(settings.fastMode)} onChange={(e) => onChange({ ...settings, fastMode: e.target.checked })} />
          Fast: read the list without opening each listing
        </label>
        <label className="check" title="The search opens in a new tab behind your current one. Keep that tab open; you can use Chrome as usual.">
          <input
            type="checkbox"
            checked={isOn(settings.runInBackground)}
            onChange={(e) => onChange({ ...settings, runInBackground: e.target.checked })}
          />
          Run in a background tab
        </label>
        <label className="check" title="When one search finishes, the next keyword starts by itself.">
          <input type="checkbox" checked={isOn(settings.autoNext)} onChange={(e) => onChange({ ...settings, autoNext: e.target.checked })} />
          Start the next search by itself
        </label>
        <small className="hint">You get a Chrome notification when everything is done, or if Google asks for a security check (only you can do that).</small>
      </div>

      <label className="check" title="The backend needs AI_PROVIDER set. Every AI step is logged on the job.">
        <input type="checkbox" checked={!!settings.aiAssist} onChange={(e) => onChange({ ...settings, aiAssist: e.target.checked })} />
        AI assist if the results list cannot be found
      </label>
      {settings.aiAssist && (
        <small className="hint">
          Only used when the normal collector gets stuck. It never signs in, accepts cookies or solves CAPTCHAs: those always pause the job for you.
        </small>
      )}

      </>
      )}

      <div className="fields">
        <span className="fields__title">Fields</span>
        <div className="fields__grid">
          {COLLECTOR_FIELDS.map((f) => {
            const required = "required" in f && f.required;
            return (
              <label key={f.key} className="check">
                <input
                  type="checkbox"
                  checked={settings.fields[f.key]}
                  disabled={required}
                  onChange={(e) => onChange({ ...settings, fields: { ...settings.fields, [f.key]: e.target.checked } })}
                />
                {f.label}
              </label>
            );
          })}
        </div>
      </div>
    </fieldset>
  );
}

import {
  buildSearchQuery,
  COLLECTOR_FIELDS,
  MAX_RECORDS_LIMIT,
  parseKeywords,
  type CollectorSettings,
  type SettingsErrors,
} from "@platform/shared";

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

  return (
    <fieldset className="card form" disabled={disabled}>
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
            {keywords.length} searches will be queued; you start each one: {keywords.join(" → ")}
          </small>
        ) : (
          <small className="hint">Tip: separate keywords with commas to queue several searches.</small>
        )}
      </label>

      <label className="field">
        <span>Location</span>
        <input
          type="text"
          placeholder="Lucknow"
          value={settings.location}
          maxLength={100}
          onChange={(e) => onChange({ ...settings, location: e.target.value })}
        />
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

      <button
        type="button"
        className="btn btn--ghost"
        disabled={disabled || keywords.length === 0}
        onClick={() => onOpenSearch(query)}
        title={query ? `Open "${query}" in Google Maps` : undefined}
      >
        Open search in Maps
      </button>

      <label className="check" title="The backend needs AI_PROVIDER set. Every AI step is logged on the job.">
        <input type="checkbox" checked={!!settings.aiAssist} onChange={(e) => onChange({ ...settings, aiAssist: e.target.checked })} />
        AI assist if the results list cannot be found
      </label>
      {settings.aiAssist && (
        <small className="hint">
          Only used when the normal collector gets stuck. It never signs in, accepts cookies or solves CAPTCHAs: those always pause the job for you.
        </small>
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

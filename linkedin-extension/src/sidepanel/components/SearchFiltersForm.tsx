import { useState } from "react";
import {
  CONNECTION_LABEL,
  copyFiltersFromUrl,
  describeCopied,
  emptyFilters,
  hasAnyFilter,
  PROFILE_LANGUAGES,
  type Connection,
  type PeopleSearchFilters,
} from "../services/searchFilters";

interface Props {
  filters: PeopleSearchFilters;
  onChange: (f: PeopleSearchFilters) => void;
  /** URL of the active tab, to copy LinkedIn's own filters from a search page */
  tabUrl: string | null;
}

const TEXT_FIELDS: [keyof PeopleSearchFilters, string, string][] = [
  ["title", "Title", "e.g. HR Manager"],
  ["company", "Company", "e.g. Genpact"],
  ["school", "School", "e.g. IIM Lucknow"],
  ["firstName", "First name", ""],
  ["lastName", "Last name", ""],
];

/** LinkedIn people filters for the Search button (collapsed until opened). */
export function SearchFiltersForm({ filters, onChange, tabUrl }: Props) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const active = hasAnyFilter(filters);
  const copyable = copyFiltersFromUrl(tabUrl);

  const toggleConnection = (c: Connection) =>
    onChange({ ...filters, connections: filters.connections.includes(c) ? filters.connections.filter((x) => x !== c) : [...filters.connections, c] });

  function copyFromPage() {
    if (!copyable) return;
    onChange({ ...filters, copied: copyable });
    setNote(Object.keys(copyable).length ? `Copied: ${describeCopied(copyable)}` : "This search has no location/company/industry filters to copy.");
  }

  return (
    <div className="filters">
      <div className="row row--between">
        <button type="button" className="link" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "▾" : "▸"} Filters{active ? " (on)" : ""}
        </button>
        {active && (
          <button
            type="button"
            className="link btn--danger"
            onClick={() => {
              onChange(emptyFilters());
              setNote(null);
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {open && (
        <>
          <div className="field">
            <span>Connections</span>
            <div className="row">
              {(Object.keys(CONNECTION_LABEL) as Connection[]).map((c) => (
                <label key={c} className="check">
                  <input type="checkbox" checked={filters.connections.includes(c)} onChange={() => toggleConnection(c)} />
                  {CONNECTION_LABEL[c]}
                </label>
              ))}
            </div>
          </div>

          <div className="grid2">
            {TEXT_FIELDS.map(([key, label, placeholder]) => (
              <label key={key} className="field">
                <span>{label}</span>
                <input value={filters[key] as string} maxLength={100} placeholder={placeholder} onChange={(e) => onChange({ ...filters, [key]: e.target.value })} />
              </label>
            ))}
            <label className="field">
              <span>Profile language</span>
              <select value={filters.language} onChange={(e) => onChange({ ...filters, language: e.target.value })}>
                {PROFILE_LANGUAGES.map(([v, text]) => (
                  <option key={v} value={v}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="field">
            <span>Locations, companies, industries, schools…</span>
            <p className="hint">
              Pick these once in LinkedIn’s “All filters” panel and click Show results, then copy them here. They are reused for every search.
            </p>
            <div className="row">
              <button type="button" className="btn" disabled={!copyable} onClick={copyFromPage} title={copyable ? undefined : "Open a LinkedIn people search first"}>
                Copy filters from this page
              </button>
              {Object.keys(filters.copied).length > 0 && (
                <button type="button" className="link" onClick={() => onChange({ ...filters, copied: {} })}>
                  Remove
                </button>
              )}
            </div>
            {Object.keys(filters.copied).length > 0 && <p className="msg msg--ok">Using: {describeCopied(filters.copied)}</p>}
            {note && <p className="hint">{note}</p>}
          </div>
        </>
      )}
    </div>
  );
}

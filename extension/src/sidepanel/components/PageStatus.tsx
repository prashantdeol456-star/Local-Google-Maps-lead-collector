import type { MapsPageState } from "../../utils/maps";

export function PageStatus({ page }: { page: MapsPageState | null }) {
  if (!page?.isMaps) {
    return (
      <div className="page-status page-status--off">
        <span className="dot" />
        <div>
          <strong>Google Maps not detected</strong>
          <p>Open google.com/maps in this tab. If it is already open, reload the tab once.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="page-status page-status--on">
      <span className="dot" />
      <div>
        <strong>Google Maps detected</strong>
        <p>{page.isSearch && page.query ? <>Search: “{page.query}”</> : "No search open yet"}</p>
      </div>
    </div>
  );
}

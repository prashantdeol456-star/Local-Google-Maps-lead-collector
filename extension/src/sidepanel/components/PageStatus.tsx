import type { MapsPageState } from "../../utils/maps";

export function PageStatus({ page, justdial = false }: { page: MapsPageState | null; justdial?: boolean }) {
  if (justdial) {
    return (
      <div className="page-status page-status--on">
        <span className="dot" />
        <div>
          <strong>Justdial mode</strong>
          <p>START opens Justdial in its own tab (no need to open it yourself). A second tab with Google Maps is used only to find each business's phone and website.</p>
        </div>
      </div>
    );
  }
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

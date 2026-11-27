import type { CollectorSource } from "@platform/shared";
import type { MapsPageState } from "../../utils/maps";

export function PageStatus({ page, source }: { page: MapsPageState | null; source?: CollectorSource }) {
  if (source === "sulekha") {
    return (
      <div className="page-status page-status--on">
        <span className="dot" />
        <div>
          <strong>Sulekha mode</strong>
          <p>START opens Sulekha in its own tab, finds the category for your keyword and reads every list page and business page by itself. A second tab with Google Maps is used only to find each business's website.</p>
        </div>
      </div>
    );
  }
  if (source === "grotal") {
    return (
      <div className="page-status page-status--on">
        <span className="dot" />
        <div>
          <strong>Grotal mode</strong>
          <p>START opens Grotal in its own tab and reads every list page by itself. A second tab with Google Maps is used only to find each business's website and rating.</p>
        </div>
      </div>
    );
  }
  if (source === "justdial") {
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

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { EmptyState, ErrorBox, PageHeader, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { formatDate } from "../lib/format";

// Download page for the Chrome extensions (zips built by `npm run build:extensions`).

interface ExtensionDownload {
  id: string;
  name: string;
  version: string;
  description: string;
  file: string;
  size: number;
  builtAt: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function ExtensionsPage() {
  const list = useQuery({ queryKey: ["extensions"], queryFn: () => api<{ items: ExtensionDownload[] }>("/extensions") });
  const backendUrl = window.location.origin;

  return (
    <>
      <PageHeader title="Extensions" subtitle="Download the Chrome extensions and install them in Chrome. They log in with the same email and password as this admin panel." />

      <div className="card mb-6 flex flex-wrap items-center gap-3 p-5">
        <div className="min-w-0 flex-1">
          <p className="label">Backend URL for the extension login</p>
          <code className="break-all text-sm">{backendUrl}</code>
        </div>
        <CopyButton text={backendUrl} />
      </div>

      {list.isPending && <Spinner />}
      {list.error && <ErrorBox error={list.error} />}
      {list.data?.items.length === 0 && (
        <EmptyState title="No extension built yet">
          Run <code>npm run build:extensions</code> on the server (the Docker image does this automatically).
        </EmptyState>
      )}

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        {list.data?.items.map((e) => (
          <div key={e.id} className="card flex flex-col gap-3 p-5">
            <div>
              <h2 className="font-medium">{e.name}</h2>
              <p className="text-sm text-slate-500">{e.description}</p>
            </div>
            <p className="text-xs text-slate-500">
              Version {e.version} · {(e.size / 1024).toFixed(0)} KB · built {formatDate(e.builtAt)}
            </p>
            <a className="btn btn-primary self-start" href={`/api/extensions/${encodeURIComponent(e.id)}/download`} download>
              ⬇ Download zip
            </a>
          </div>
        ))}
      </div>

      <div className="card p-5">
        <h2 className="mb-3 font-medium">How to install</h2>
        <ol className="list-inside list-decimal space-y-1 text-sm text-slate-600 dark:text-slate-300">
          <li>Download the zip and extract it into a folder (right click → Extract All).</li>
          <li>
            Open <code>chrome://extensions</code> in Chrome and turn on <strong>Developer mode</strong> (top right).
          </li>
          <li>
            Click <strong>Load unpacked</strong> and choose the extracted folder (the one with <code>manifest.json</code>).
          </li>
          <li>Click the extension icon to open its side panel.</li>
          <li>
            On the login screen click <strong>Backend: … change</strong>, paste the backend URL above, then log in. Chrome asks once for permission to
            reach it.
          </li>
          <li>
            To update later: download again, replace the folder’s files, and click <strong>Reload</strong> on the extension in <code>chrome://extensions</code>.
          </li>
        </ol>
      </div>
    </>
  );
}

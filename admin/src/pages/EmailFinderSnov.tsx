import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ErrorBox } from "../components/ui";
import { api } from "../lib/api";
import { formatDate } from "../lib/format";

// Snov.io: the second email finder. Used by itself when Hunter has no key, is switched off or its
// credits are used up, for a person's name + company website.

export interface SnovStatus {
  configured: boolean;
  keyHint: string | null;
  status: "ok" | "disabled" | null;
  statusReason: string | null;
  credits: { left: number; held: number; margin: number } | null;
  resetDate: string | null;
}

export function useSnovStatus() {
  return useQuery({ queryKey: ["snov"], queryFn: () => api<SnovStatus>("/enrich/snov/status") });
}

export function SnovCard() {
  const client = useQueryClient();
  const status = useSnovStatus();
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const save = useMutation({
    mutationFn: (key: { clientId: string; clientSecret: string } | null) => api<SnovStatus>("/enrich/snov/key", { method: "PUT", body: { key } }),
    onSuccess: (s) => {
      setClientId("");
      setSecret("");
      client.setQueryData(["snov"], s);
    },
  });
  const refresh = useMutation({ mutationFn: () => api<SnovStatus>("/enrich/snov/refresh", { method: "POST" }), onSuccess: (s) => client.setQueryData(["snov"], s) });
  const s = status.data;
  return (
    <div className="card space-y-3 p-4">
      <h2 className="font-semibold">Snov.io (second email finder)</h2>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Used automatically when Hunter has no key, is switched off or its credits are used up, for a person's name + company website (Contact Finder, Try it and Bulk). In Snov.io open
        Settings → API, copy the <b>User ID</b> and <b>Secret</b> and paste them here. Each email found costs 1 Snov.io credit; 10 % of your credits are kept back. Free Snov.io plans need API
        access asked from Snov first.
      </p>
      {status.error && <ErrorBox error={status.error} />}
      {s?.configured && (
        <p className="text-sm">
          Saved: <code>{s.keyHint}</code>
          {s.credits && (
            <>
              {" "}
              · <strong>{s.credits.left}</strong> credits left ({s.credits.margin} kept back{s.credits.held ? `, ${s.credits.held} held` : ""})
            </>
          )}
          {s.resetDate && ` · renews ${formatDate(s.resetDate)}`}
          {s.status === "disabled" && <span className="ml-2 text-red-600">Switched off: {s.statusReason}</span>}
        </p>
      )}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (clientId.trim() && secret.trim()) save.mutate({ clientId: clientId.trim(), clientSecret: secret.trim() });
        }}
      >
        <input className="input flex-1" autoComplete="off" placeholder="Snov.io User ID" value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Snov.io User ID" />
        <input className="input flex-1" type="password" autoComplete="off" placeholder="Snov.io Secret" value={secret} onChange={(e) => setSecret(e.target.value)} aria-label="Snov.io Secret" />
        <button className="btn btn-primary" disabled={save.isPending || !clientId.trim() || !secret.trim()}>
          {save.isPending ? "Checking…" : "Save and check"}
        </button>
        {s?.configured && (
          <>
            <button type="button" className="btn" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
              {refresh.isPending ? "Checking…" : "⟳ Credits"}
            </button>
            <button type="button" className="btn btn-danger" disabled={save.isPending} onClick={() => save.mutate(null)}>
              Remove
            </button>
          </>
        )}
      </form>
      {(save.error || refresh.error) && <ErrorBox error={save.error ?? refresh.error} />}
    </div>
  );
}

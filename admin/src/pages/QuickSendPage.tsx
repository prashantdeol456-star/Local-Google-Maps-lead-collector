import { useMutation } from "@tanstack/react-query";
import { useMemo, useState, type ChangeEvent } from "react";
import { ErrorBox, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import { setQuickSend } from "../lib/quickSend";
import { navigate } from "../lib/router";

// Quick Send: paste or upload emails / numbers, save them as contacts, then send an email
// template or an approved WhatsApp template (marketing or utility) through the normal campaigns.

interface Contact {
  name: string | null;
  email: string | null;
  phone: string | null;
}

interface SaveResult {
  leadIds: string[];
  created: number;
  existing: number;
  skipped: { row: number; value: string; reason: string }[];
  whatsapp: { optedIn: number; alreadyAllowed: number; optedOut: number };
}

const MAX = 5000;

/** One line / cell group → a contact: the part with "@" is the email, digits the phone, the rest the name. */
function toContact(parts: string[]): Contact | null {
  let email: string | null = null;
  let phone: string | null = null;
  const name: string[] = [];
  for (const raw of parts) {
    const v = raw.trim();
    if (!v) continue;
    if (!email && v.includes("@")) email = v;
    else if (!phone && /^\+?[\d\s()-]{7,}$/.test(v)) phone = v;
    else name.push(v);
  }
  return email || phone || name.length ? { name: name.join(" ") || null, email, phone } : null;
}

function parsePasted(text: string): Contact[] {
  return text
    .split(/\r?\n/)
    .map((line) => toContact(line.split(/[,;\t]|\s{2,}|\s+(?=\S+@)|(?<=@\S+)\s+/)))
    .filter((c): c is Contact => !!c);
}

/** Minimal CSV reader (quoted fields, commas, semicolons or tabs). */
function readCsv(text: string): string[][] {
  const sep = [",", ";", "\t"].sort((a, b) => text.split(b).length - text.split(a).length)[0]!;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) row.push(cell), (cell = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      (row = []), (cell = "");
    } else cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows.filter((r) => r.some((c) => c.trim()));
}

function parseCsv(text: string): Contact[] {
  const rows = readCsv(text.replace(/^﻿/, ""));
  if (!rows.length) return [];
  const head = rows[0]!.map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => head.findIndex((h) => names.some((n) => h.includes(n)));
  const emailCol = col("email", "e-mail", "mail");
  const phoneCol = col("phone", "mobile", "number", "whatsapp", "contact");
  const nameCol = col("name");
  if (emailCol < 0 && phoneCol < 0) return rows.map((r) => toContact(r)).filter((c): c is Contact => !!c);
  return rows
    .slice(1)
    .map((r) => ({ name: r[nameCol]?.trim() || null, email: r[emailCol]?.trim() || null, phone: r[phoneCol]?.trim() || null }))
    .filter((c) => c.email || c.phone);
}

export function QuickSendPage() {
  const [mode, setMode] = useState<"paste" | "csv">("paste");
  const [list, setList] = useState("");
  const [text, setText] = useState("");
  const [csv, setCsv] = useState<{ file: string; contacts: Contact[] } | null>(null);
  const [consent, setConsent] = useState(false);

  const contacts = useMemo(() => (mode === "paste" ? parsePasted(text) : (csv?.contacts ?? [])), [mode, text, csv]);
  const emails = contacts.filter((c) => c.email).length;
  const phones = contacts.filter((c) => c.phone).length;

  const save = useMutation({
    mutationFn: () => api<SaveResult>("/quick-send/contacts", { method: "POST", body: { list: list.trim(), contacts, whatsappConsent: consent && phones > 0 } }),
  });
  const result = save.data;

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsv({ file: file.name, contacts: parseCsv(await file.text()) });
    if (!list) setList(file.name.replace(/\.[^.]+$/, ""));
    save.reset();
  }

  function sendWith(channel: "email" | "whatsapp") {
    if (!result) return;
    setQuickSend({ list: list.trim(), leadIds: result.leadIds });
    navigate(`/${channel}/new?quickSend=1`);
  }

  return (
    <>
      <PageHeader
        title="Quick Send"
        subtitle="Paste or upload emails and phone numbers, then send them an email template or an approved WhatsApp template (marketing or utility)."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <section className="card space-y-4 p-5">
            <h2 className="font-semibold">1. Add contacts</h2>
            <label className="block space-y-1">
              <span className="label">List name</span>
              <input className="input" maxLength={100} value={list} onChange={(e) => setList(e.target.value)} placeholder="e.g. Diwali offer – Noida shops" />
            </label>

            <div className="inline-flex rounded-lg border border-[#cfd8d3] p-1 dark:border-[#24463a]">
              {(["paste", "csv"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`rounded-md px-4 py-1.5 text-sm font-semibold ${mode === m ? "nav-active" : "text-slate-600 hover:text-brand-700 dark:text-slate-300"}`}
                  onClick={() => (setMode(m), save.reset())}
                >
                  {m === "paste" ? "Paste" : "Upload CSV"}
                </button>
              ))}
            </div>

            {mode === "paste" ? (
              <label className="block space-y-1">
                <span className="label">One contact per line: email, number, or name with email/number</span>
                <textarea
                  className="input font-mono"
                  rows={9}
                  value={text}
                  onChange={(e) => (setText(e.target.value), save.reset())}
                  placeholder={"ravi@shop.in\n+91 98765 43210\nAsha Verma, asha@agency.in, 98100 12345"}
                />
              </label>
            ) : (
              <div className="space-y-2">
                <input className="input h-auto py-2" type="file" accept=".csv,text/csv,text/plain" onChange={onFile} />
                <p className="text-xs text-slate-500">
                  Columns such as <b>Name</b>, <b>Email</b>, <b>Phone</b> / Mobile / WhatsApp are found automatically. From Excel use “Save as → CSV”.
                </p>
                {csv && (
                  <p className="text-sm">
                    {csv.file}: {csv.contacts.length} rows with an email or number
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2 text-sm">
              <span className="rounded-full bg-brand-50 px-3 py-1 font-semibold text-brand-700">{contacts.length} contacts</span>
              <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">✉ {emails} emails</span>
              <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">✆ {phones} numbers</span>
              {contacts.length > MAX && <span className="rounded-full bg-red-50 px-3 py-1 text-red-600">At most {MAX} at a time</span>}
            </div>

            {phones > 0 && (
              <label className="flex items-start gap-3 rounded-xl border border-gold-400/60 bg-gold-100/50 p-3 text-sm dark:bg-gold-600/10">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-[#117a57]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>
                  <b>These people agreed to receive WhatsApp messages from us.</b> Required for WhatsApp templates. It is saved as their opt-in; people who opted
                  out (STOP) stay opted out.
                </span>
              </label>
            )}

            {save.error && <ErrorBox error={save.error} />}
            <button
              className="btn btn-primary"
              disabled={!list.trim() || !contacts.length || contacts.length > MAX || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Saving…" : `Save ${contacts.length || ""} contacts`}
            </button>
          </section>

          {result && (
            <section className="card space-y-4 p-5">
              <h2 className="font-semibold">2. Send a template</h2>
              <p className="text-sm">
                <b>{result.leadIds.length}</b> contacts ready ({result.created} new, {result.existing} already saved).
                {phones > 0 && consent && (
                  <>
                    {" "}
                    WhatsApp opt-in: {result.whatsapp.optedIn} recorded, {result.whatsapp.alreadyAllowed} already had it
                    {result.whatsapp.optedOut ? `, ${result.whatsapp.optedOut} opted out earlier (they will not get WhatsApp messages)` : ""}.
                  </>
                )}
              </p>
              {!!result.skipped.length && (
                <details className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                  <summary className="cursor-pointer font-semibold">{result.skipped.length} rows skipped</summary>
                  <ul className="mt-2 space-y-0.5">
                    {result.skipped.slice(0, 50).map((s) => (
                      <li key={s.row}>
                        Row {s.row}: {s.value} — {s.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="flex flex-wrap gap-3">
                <button className="btn btn-primary" disabled={!result.leadIds.length} onClick={() => sendWith("email")}>
                  ✉ Send email template
                </button>
                <button className="btn btn-gold" disabled={!result.leadIds.length} onClick={() => sendWith("whatsapp")}>
                  ✆ Send WhatsApp template
                </button>
              </div>
              <p className="text-xs text-slate-500">
                The next page lets you choose the template, the speed and the daily limit before starting. Opt-outs are always skipped.
              </p>
            </section>
          )}
        </div>

        <aside className="card h-fit space-y-3 p-5 text-sm">
          <h2 className="font-semibold">Marketing or utility?</h2>
          <p>
            <b>Email:</b> any template from <i>Templates</i>. Every email gets an unsubscribe link automatically.
          </p>
          <p>
            <b>WhatsApp marketing</b> (offers, new products, greetings): only to people who agreed to hear from you on WhatsApp.
          </p>
          <p>
            <b>WhatsApp utility</b> (order or booking updates, payment reminders): only about something the person already started with you — not
            promotions. Meta checks this and can re-categorise or block templates.
          </p>
          <p className="text-slate-500">WhatsApp templates must be approved in Meta first; add them under WhatsApp → Templates with the same name and category.</p>
        </aside>
      </div>
    </>
  );
}

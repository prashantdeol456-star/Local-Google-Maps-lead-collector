import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ON_POSTGRES } from "./helpers.js";

const migrationsDir = path.resolve(import.meta.dirname, "../prisma/migrations");
const migrations = readdirSync(migrationsDir).filter((n) => !n.endsWith(".toml")).sort();
const sql = (name: string) => readFileSync(path.join(migrationsDir, name, "migration.sql"), "utf8");

// These check the SQLite migrations (data-preserving changes); PostgreSQL starts from one baseline.
describe.skipIf(ON_POSTGRES)("migrations", () => {
  it("lead_location_job_queue keeps existing normalizedDomain values as normalizedWebsite", () => {
    const db = new Database(":memory:");
    const target = migrations.findIndex((n) => n.endsWith("_lead_location_job_queue"));
    expect(target).toBeGreaterThan(0);

    for (const name of migrations.slice(0, target)) db.exec(sql(name));
    db.prepare(
      `INSERT INTO "Lead" (id, name, normalizedName, normalizedDomain, dedupeKey, updatedAt)
       VALUES ('l1', 'ABC University', 'abc university', 'abc.edu.in', 'dom:abc.edu.in', CURRENT_TIMESTAMP)`,
    ).run();
    db.prepare(`INSERT INTO "CollectionJob" (id, searchKeyword, updatedAt) VALUES ('j1', 'University', CURRENT_TIMESTAMP)`).run();

    for (const name of migrations.slice(target)) db.exec(sql(name));

    const lead = db.prepare(`SELECT name, normalizedWebsite, latitude, longitude FROM "Lead" WHERE id = 'l1'`).get();
    expect(lead).toEqual({ name: "ABC University", normalizedWebsite: "abc.edu.in", latitude: null, longitude: null });
    const job = db.prepare(`SELECT searchKeyword, queueId, position FROM "CollectionJob" WHERE id = 'j1'`).get();
    expect(job).toEqual({ searchKeyword: "University", queueId: null, position: null });

    const indexes = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'Lead'`).all() as { name: string }[];
    expect(indexes.map((i) => i.name)).toContain("Lead_normalizedWebsite_idx");
    expect(indexes.map((i) => i.name)).not.toContain("Lead_normalizedDomain_idx");
    db.close();
  });

  it("suppressions backfills existing opt-outs as address-based entries", () => {
    const db = new Database(":memory:");
    const target = migrations.findIndex((n) => n.endsWith("_suppressions"));
    expect(target).toBeGreaterThan(0);
    for (const name of migrations.slice(0, target)) db.exec(sql(name));

    const lead = db.prepare(
      `INSERT INTO "Lead" (id, name, normalizedName, dedupeKey, email, normalizedPhone, updatedAt) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    );
    lead.run("unsub", "A", "a", "k1", " Info@A.in ", "+919000000001");
    lead.run("dnc", "B", "b", "k2", "b@b.in", "+919000000002");
    lead.run("fine", "C", "c", "k3", "c@c.in", "+919000000003");
    const pref = db.prepare(
      `INSERT INTO "LeadCommunicationPreference" (leadId, emailAllowed, optedOut, optOutReason, updatedAt) VALUES (?, ?, ?, ?, '2026-10-01 10:00:00')`,
    );
    pref.run("unsub", 0, 0, "unsubscribe_link");
    pref.run("dnc", 1, 1, "Asked for no contact");
    pref.run("fine", 1, 0, null);
    db.prepare(
      `INSERT INTO "WhatsAppEvent" (id, type, leadId, phone, provider, metadata, occurredAt) VALUES ('e1', 'opted_out', NULL, '+919000000009', 'keyword', '{"reason":"Replied \\"STOP\\""}', '2026-10-02 10:00:00')`,
    ).run();

    for (const name of migrations.slice(target)) db.exec(sql(name));
    const rows = db.prepare(`SELECT channel, address, source, reason, leadId FROM "Suppression" ORDER BY channel, address`).all();
    expect(rows).toEqual([
      { channel: "email", address: "b@b.in", source: "do_not_contact", reason: "Asked for no contact", leadId: "dnc" },
      { channel: "email", address: "info@a.in", source: "unsubscribe_link", reason: "Unsubscribed via email link", leadId: "unsub" },
      { channel: "whatsapp", address: "+919000000002", source: "do_not_contact", reason: "Asked for no contact", leadId: "dnc" },
      { channel: "whatsapp", address: "+919000000009", source: "stop_reply", reason: 'Replied "STOP"', leadId: null },
    ]);
    db.close();
  });
});

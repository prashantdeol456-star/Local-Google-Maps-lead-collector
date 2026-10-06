# Architecture — Google Maps Lead Platform

Focus: **Google Maps → Leads → Database → Email/WhatsApp outreach → Tracking.**
Not a CRM. Not a general-purpose AI agent.

## 1. Overview

```
┌─ Chrome (user's own) ──────────────────────────────────────────────┐
│ Google Maps tab              Side Panel (React)                     │
│  └ Content script ◄─msg─►  Background service worker               │
│    • maps/extractor          (job controller, outbox, API client,   │
│    • challenge detector       AI action executor)                   │
│    • whitelisted actions                                            │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ REST + Bearer token
┌──────────────────────────────▼──────────────────────────────────────┐
│ Backend (Fastify, 127.0.0.1:3000)                                    │
│  api/        routes · controllers · middleware (auth, validation)    │
│  services/   auth · lead · collection · email · whatsapp · tracking  │
│  providers/  email (resend, smtp, outplay) · whatsapp (gupshup,      │
│              msg91, meta) · ai (claude, gemini)                      │
│  jobs/       DB-backed queue worker                                  │
│  database/   Prisma client + repositories → data/app.db (SQLite)    │
│  /admin (React build) · /api/events (SSE)                           │
│  /t/click/:id · /u/:token · /api/webhooks/*  (need PUBLIC_BASE_URL)  │
└──────────────────────────────────────────────────────────────────────┘
```

- **Local now:** extension → `http://127.0.0.1:3000` → SQLite.
- **Production later:** extension → `https://yourdomain.com/api` → PostgreSQL.
  Only `prisma/schema.prisma` (provider) and `src/database/client.ts` (driver adapter) change.
- **Queue:** no Redis. `ContactAttempt` rows with `status=queued` + `scheduledAt`; a worker picks due rows.
- **Shared code:** `shared/` holds types, collector state machine and (Phase 5) normalization +
  dedupe keys, so the extension and backend make identical decisions.

## 2. Folder structure

```
google-maps-lead-platform/
├─ shared/src/            collector.ts (fields, settings, job state machine), later normalize/dedupe
├─ extension/
│  ├─ manifest.json · vite.config.ts (CRXJS)
│  └─ src/
│     ├─ background/      service-worker.ts, jobController.ts (+ outbox, apiClient later)
│     ├─ content/         index.ts (page detection); maps/ extractor etc. in Phase 4
│     ├─ sidepanel/       components/ pages/ services/
│     ├─ storage/         chrome.storage wrappers (+ IndexedDB outbox later)
│     └─ utils/           maps URL helpers, message types
├─ backend/
│  ├─ prisma/             schema.prisma, migrations/
│  └─ src/
│     ├─ api/             routes/ controllers/ middleware/
│     ├─ database/        client.ts, repositories/ (interfaces + prisma/)
│     ├─ services/        auth/ lead/ collection/ email/ whatsapp/ tracking/
│     ├─ providers/       email/ whatsapp/
│     ├─ jobs/  utils/
│     └─ app.ts · server.ts · config.ts
├─ admin/                 (Phase 7) React + Vite, served at /admin
├─ data/app.db
└─ docs/
```

## 3. Database

Existing (migration `init`): `AdminUser`, `Session`, `Lead`, `CollectionJob`, `JobItem`, `AgentLog`.

Added in the phase that needs them:

| Phase | Change |
|---|---|
| 2 | `ApiToken` (extension bearer tokens, hashed) |
| 3 | `Lead.latitude/longitude`, `normalizedDomain → normalizedWebsite`, `CollectionJob.queueId/position` |
| 10 | `MessageTemplate`, `Campaign` (channel = email/whatsapp), `ContactAttempt` (queue + history, unique per campaign+lead) |
| 11 | `EmailEvent` (unique `providerEventId`), `TrackedLink` |
| 13–14 | `WhatsAppEvent` |
| 10/15 | `LeadCommunicationPreference` (emailAllowed, whatsappAllowed, whatsappOptInAt/Source, optedOut, reason) |
| 9+ | `Setting` (non-secret key/value only) |

JSON columns are stored as `String` for SQLite/PostgreSQL portability.

## 4. API

| Group | Endpoints |
|---|---|
| Auth | `POST /api/auth/login` (cookie) · `POST /api/auth/token` (extension) · `POST /api/auth/logout` · `GET /api/auth/me` |
| Leads | `POST/GET /api/leads` · `GET/PATCH/DELETE /api/leads/:id` · `GET /api/leads/:id/timeline` · `PATCH /api/leads/:id/preferences` |
| Collection | `POST/GET /api/jobs` · `GET/PATCH /api/jobs/:id` · `POST /api/jobs/queue` · `POST /api/jobs/:id/logs` |
| Live | `GET /api/events` (SSE) |
| Stats/Export | `GET /api/stats` · `GET /api/export/csv` · `GET /api/export/xlsx` |
| Templates | `GET/POST /api/templates` · `PATCH/DELETE /api/templates/:id` · `POST /api/templates/:id/preview` |
| Email | `POST/GET /api/email/campaigns` · `POST /api/email/campaigns/:id/{start,pause,stop}` · `POST /api/email/send-test` |
| WhatsApp | `POST/GET /api/whatsapp/campaigns` · `POST /api/whatsapp/campaigns/:id/{start,pause,stop}` |
| Webhooks (public) | `POST /api/webhooks/email/:provider` · `GET+POST /api/webhooks/whatsapp/:provider` |
| Tracking (public) | `GET /t/click/:id` · `GET/POST /u/:token` |
| AI | `POST /api/ai/next-action` |
| Settings/Logs | `GET/PUT /api/settings` (secrets masked) · `GET /api/logs` |

Errors: `{ "error": { "code": "...", "message": "..." } }`.

## 5. Data flow

**Collection:** side panel START → `POST /api/jobs` → content script scrolls/opens listings →
extract → normalize (shared) → local seen-set → IndexedDB outbox → `POST /api/leads {jobId, clientKey, lead}` →
backend normalizes again → transaction: dedupe (placeId → phone → website → name+address), insert,
`JobItem`, counters → response updates side panel → SSE updates admin.
CAPTCHA/challenge → job paused + warning → user solves manually → Resume.

**Email:** select leads → preview → start → one `ContactAttempt` per eligible lead with `scheduledAt`
(min/max delay, window, daily limit) → worker re-checks preferences → `provider.sendEmail()` →
webhook (signature verified) → `EmailEvent` → lead timeline.

**WhatsApp:** same, plus: approved template only, opt-in gate, inbound replies matched by phone.

## 6. Email

```ts
interface EmailProvider {
  readonly name: "resend" | "smtp" | "outplay";
  readonly capabilities: { delivery: boolean; opens: boolean; clicks: boolean; replies: boolean; batch: boolean };
  sendEmail(msg: OutgoingEmail): Promise<{ externalMessageId: string }>;
  sendBatch(msgs: OutgoingEmail[]): Promise<{ externalMessageId: string }[]>;
  getMessageStatus(id: string): Promise<ProviderStatus | null>;
  handleWebhook(req: RawWebhook): Promise<NormalizedEmailEvent[]>;
}
```

- Selected by `EMAIL_PROVIDER`. SMTP has no delivery events (bounces/replies via IMAP later).
- Click tracking redirects only to the URL stored at send time (no open redirect).
- Opens are shown as **approximate**.
- Every email: unsubscribe link + `List-Unsubscribe` / `List-Unsubscribe-Post` headers.
- No automatic replies.

## 7. WhatsApp

```ts
interface WhatsAppProvider {
  readonly name: "gupshup" | "msg91" | "meta";
  sendTemplate(to: string, tpl: { externalTemplateId: string; language: string; params: string[] }):
    Promise<{ externalMessageId: string }>;
  getStatus(id: string): Promise<ProviderStatus | null>;
  verifyWebhook(req: RawWebhook): boolean;
  handleWebhook(req: RawWebhook): Promise<NormalizedWaEvent[]>;
}
```

Send gate: template `approved` AND `whatsappAllowed` with recorded opt-in AND not opted out AND
under daily limit. A "STOP"-style reply sets `optedOut`. Business-initiated WhatsApp messages
require recipient opt-in under Meta policy; phone numbers collected from Maps are not opt-ins.

## 8. AI browser control (optional, Phase 16)

Off by default (`AI_PROVIDER=off`). Used only when the deterministic collector cannot find the
results list **and** the user ticked "AI assist" for that search.

```
runner: list not found ─► page.snapshot()  (content/maps/snapshot.ts)
   pageKind, URL query, title, counts, ≤40 clickable controls by index, ≤1500 chars of
   main-panel text (emails / long numbers masked). Account bar, footer, consent, external
   links and denied labels (sign in, share, directions, filters, reviews…) are never listed.
 ─► background ─► POST /api/ai/next-action (bearer token; AI key only on the backend)
 ─► Anthropic Messages API, structured outputs (output_config.format json_schema)
 ─► checkAiAction() in @platform/shared, on the backend AND again in the page
 ─► one step: click <listed index> | scroll_results | scroll_page | back | wait | done
              | search (background reopens the job's own Maps search URL, max 2 per run)
              | stop (no_results → job completed; needs_user / unknown_layout → paused)
```

Guardrails: no selectors, URLs, code or typed text from the AI; challenges (CAPTCHA, consent,
unusual traffic) are checked before every step and always pause the job; 6 steps per recovery
and `AI_MAX_STEPS_PER_JOB` per job; page text is untrusted data; every step is an AgentLog on
the job. AI is never used for normalization, duplicates, storage, queues or exports.

## 9. Security

- Backend binds to `127.0.0.1`. CORS allows only the extension ID and admin origin.
- Admin: httpOnly, signed, SameSite=Strict session cookie (sessions hashed in DB).
- Extension: revocable bearer token (hashed in DB). **No provider secrets in the extension.**
- Secrets only in `backend/.env` (never committed). Settings API masks secrets.
  If credentials become editable in the UI they are encrypted with `ENCRYPTION_KEY` (AES-256-GCM).
- zod validation on every input. No raw queries from clients.
- Webhooks: signature verification (Resend/Svix, Meta HMAC) or secret URL token; idempotent via `providerEventId`.
- Rate limits on login, webhooks, public tracking routes.
- Unsubscribe tokens are HMAC-signed.
- Logs redact passwords, tokens and keys.

## 10. Phases

| # | Phase | Status |
|---|---|---|
| 1 | Project setup + Chrome Extension + Side Panel | ✅ |
| 2 | Local backend (+ extension login, CORS) | ✅ |
| 3 | SQLite + Prisma (+ jobs/leads/stats read API) | ✅ |
| 4 | Google Maps extractor | ✅ |
| 5 | Normalization + duplicate engine | ✅ |
| 6 | Collection jobs + live counters (outbox, sync, search queue) | ✅ |
| 7 | Admin panel + lead management (+ `/api/events` SSE live updates) | ✅ |
| 8 | CSV/XLSX export | ✅ |
| 9 | Email provider abstraction | ✅ |
| 10 | Email campaigns + queue (+ unsubscribe) | ✅ |
| 11 | Email tracking + webhooks (needs public URL / tunnel) | ✅ |
| 12 | WhatsApp provider abstraction (Meta Cloud API + dev provider) | ✅ |
| 13 | WhatsApp templates + campaigns (opt-in gate, auto-pause on setup errors) | ✅ |
| 14 | WhatsApp webhooks + replies (statuses, inbox, STOP / marketing opt-outs) | ✅ |
| 15 | Opt-out / preferences UI (address-based suppression list, do-not-contact) | ✅ |
| 16 | Optional AI browser navigation (off by default, Claude structured outputs, step whitelist) | ✅ |
| 17 | Optional n8n (signed webhooks with retries, read-only API tokens; see docs/n8n.md) | ✅ |
| 18 | Production deployment prep (PostgreSQL, Docker + Caddy, prod checks, backups; see docs/DEPLOYMENT.md) | ✅ |

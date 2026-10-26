# Google Maps Lead Platform (local-first)

Chrome extension collects publicly visible Google Maps listing info → backend normalizes,
de-duplicates and stores it (SQLite locally, PostgreSQL on a server) → admin panel → CSV/XLSX
export, email campaigns (Resend / SMTP) and WhatsApp template campaigns (Meta Cloud API) with
tracking, replies, opt-outs and an address-based suppression list. Optional: AI help for
navigation, n8n integration.

| Guide | |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Design, data flow, all 18 phases |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Server setup: PostgreSQL, Docker, HTTPS, backups, security checklist |
| [docs/n8n.md](docs/n8n.md) | Webhooks and API tokens for n8n |

## Workspaces

| Folder | What |
|---|---|
| `shared/` | Types and logic used by both extension and backend |
| `extension/` | Chrome extension (Manifest V3, React side panel) |
| `linkedin-extension/` | LinkedIn Helper: separate Chrome extension that saves LinkedIn profiles you open yourself |
| `backend/` | Fastify API + Prisma (SQLite or PostgreSQL), workers for campaigns and webhooks |
| `admin/` | Admin panel (React + Tailwind), served by the backend at `/admin` |

## Setup (Windows)

```bash
npm install
```

### Backend

```bash
cd backend
cp .env.example .env      # set SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npx prisma migrate deploy
npm run dev               # http://127.0.0.1:3000
```

The first start creates the admin from `ADMIN_EMAIL` / `ADMIN_PASSWORD` if no admin exists.
Changing those values later does **not** change the password. To change it:

```bash
npm run admin:password -w backend
```

(asks for email and new password; signs out existing admin-panel and extension logins).

### Admin panel

```bash
npm run build:admin       # builds into backend/public/admin
```

Then open http://127.0.0.1:3000/admin (backend must be running).
For UI development with hot reload: `npm run dev:admin` → http://127.0.0.1:5174/admin/ (proxies `/api` to the backend).

### Extension

```bash
npm run build:extension
```

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose `extension/dist`.
3. Open Google Maps, then click the extension icon to open the side panel.

During development, `npm run dev:extension` rebuilds on save (reload the extension
in `chrome://extensions` after changing the manifest or background script).

### LinkedIn Helper (separate extension)

```bash
npm run build:linkedin
```

Load `linkedin-extension/dist` the same way (Load unpacked) and log in with the admin email and
password. It is user-driven only:

1. Type a keyword in the side panel and click **Search**: LinkedIn's people search (People filter) opens in the tab.
2. **Add profiles on this page** puts the results in your list (go to the next results page on LinkedIn and add again).
3. **Open next profile** opens one profile with its Contact info dialog; the helper reads it
   automatically (name, headline, company, location, email, phone, website, IM, birthday,
   connected since, Experience and Education; it scrolls the open profile once so LinkedIn
   loads those sections). Check or edit, then **Save & open next**.

Every search and every profile is opened by your click; the helper does not run through the list on its own. Saved profiles appear in the admin
panel under **LinkedIn Leads** (separate from Google Maps leads), with filters (company, tag,
has email / phone, source), editing, CSV export, and import of LinkedIn's own `Connections.csv`
(LinkedIn → Settings → Data privacy → Get a copy of your data).

### Contacts (Sheets), templates, LinkedIn Messenger and Campaign Logs

**Contacts (Sheets)** in the admin panel takes your own sheet (.xlsx or .csv) with the columns
**Name, LinkedIn URL, Contact Number, Email, Designation, Company**. Download the template from
that page, fill it in and upload it with an optional list name. Re-uploading the same LinkedIn
URL (or email) updates that contact instead of adding a copy; bad rows are listed with the reason.

**Templates** has one tab per channel: Email, SMS, WhatsApp and LinkedIn message. SMS and LinkedIn
templates use contact variables: `{{first_name}}`, `{{name}}`, `{{company}}`, `{{designation}}`,
`{{email}}`, `{{phone}}` (fallback: `{{company|your company}}`). SMS templates are for writing and
previewing only; no SMS provider is connected yet.

**LinkedIn Outreach** creates a campaign from a list (or contacts ticked on the Contacts page) and a
LinkedIn template, with a gap between messages (min 1 min), a daily cap (max 100) and sending
hours. Messages are sent by the **LinkedIn Messenger** extension, in your own browser and LinkedIn
account:

```bash
npm run build:messenger
```

1. Load `linkedin-messenger/dist` with **Load unpacked** and log in with the admin email and password.
2. Log in to LinkedIn in the same browser.
3. In the admin panel, start the campaign; in the extension's side panel, press **Start**.

The extension asks the backend for one message at a time (when the campaign's pace allows), opens
that profile in one tab, clicks **Message** and types the personalised text.
- **Assisted mode** (the default): you read it and press Send yourself (or **Skip this contact**).
- **Automatic mode**: the extension presses Send too.

People who are not 1st-degree connections, and anyone who would need a paid InMail, are skipped. If
LinkedIn asks for a login or a security check, or shows a limit, every LinkedIn campaign pauses and
the extension stops. Fix it yourself in the tab, then resume.

> **Risk:** LinkedIn's User Agreement (section 8.2, "Prohibited software and extensions") does not
> allow tools that automate sending messages. Accounts that use them can be restricted or closed.
> Use assisted mode and low daily limits, and message only people who expect to hear from you.

**Campaign Logs** shows every campaign and message across email, WhatsApp and LinkedIn:
- status counts per campaign;
- a searchable message log with the reason for each skip or failure;
- a feed of campaign events (started, paused, stopped, completed).

### Social Accounts (Facebook, Instagram, LinkedIn)

**Admin → Social Accounts** connects your accounts with each platform's own login (OAuth). Never type or
store a Facebook, Instagram or LinkedIn password in this project. The backend only receives an
access token, stores it encrypted (AES-256-GCM, key derived from `SESSION_SECRET`) and never sends
it to the browser.

- **Facebook & Instagram:** one "Connect with Facebook" brings in every Facebook Page you manage, and
  the Instagram Business/Creator account linked to each Page.
  - Create an app on developers.facebook.com with Facebook Login for Business.
  - Add the redirect URI shown on the page.
  - Set `META_APP_ID` and `META_APP_SECRET` in `backend/.env`.
- **LinkedIn:** connects your profile (60-day login; connect again when it expires).
  - Create an app on linkedin.com/developers with *Sign In with LinkedIn using OpenID Connect* and
    *Share on LinkedIn*.
  - Add the redirect URL.
  - Set `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`.

The redirect URIs are `<SOCIAL_REDIRECT_BASE_URL>/api/oauth/callback/meta` and `/linkedin`. The
base defaults to `PUBLIC_BASE_URL`, else `http://localhost:3000`. Open the admin panel on that same
address. **Check** tests a connection; **Disconnect** deletes the token here.

Planned on top of this: publishing/scheduling posts, and an inbox for Page messages, Instagram DMs
and comments. The official APIs do not allow cold DMs: Meta only allows messaging people who
contacted you first.

## Scripts (root)

| Command | What it does |
|---|---|
| `npm test` | All tests (backend tests use a temporary DB, never `data/app.db`) |
| `npm run typecheck` | TypeScript check for every workspace |
| `npm run dev:backend` | Backend with auto-reload |
| `npm run dev:extension` | Extension dev build with HMR |
| `npm run build:extension` | Production build into `extension/dist` |
| `npm run build:messenger` | Production build of the LinkedIn Messenger into `linkedin-messenger/dist` |
| `npm run dev:messenger` | LinkedIn Messenger dev build with HMR |
| `npm run build:linkedin` | Production build of the LinkedIn Helper into `linkedin-extension/dist` |
| `npm run dev:admin` | Admin panel dev server with hot reload |
| `npm run build:admin` | Production build of the admin panel |

## Database scripts (backend)

| Command | What it does |
|---|---|
| `npm run db:generate -w backend` | Prisma client for `DATABASE_PROVIDER` (sqlite / postgresql) |
| `npm run db:migrate -w backend` | Apply pending migrations |
| `npm run db:backup -w backend` | Copy of the SQLite database into `data/backups/` (keeps 14) |
| `npm run db:pg:schema -w backend` | Regenerate the PostgreSQL schema after a schema change |
| `npm run db:copy-to-postgres -w backend -- --from … --to …` | Move local SQLite data into a fresh PostgreSQL database |

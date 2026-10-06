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

## Scripts (root)

| Command | What it does |
|---|---|
| `npm test` | All tests (backend tests use a temporary DB, never `data/app.db`) |
| `npm run typecheck` | TypeScript check for every workspace |
| `npm run dev:backend` | Backend with auto-reload |
| `npm run dev:extension` | Extension dev build with HMR |
| `npm run build:extension` | Production build into `extension/dist` |
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

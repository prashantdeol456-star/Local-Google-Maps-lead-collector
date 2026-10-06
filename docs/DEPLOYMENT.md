# Deploying to a server

Locally everything runs on your computer with SQLite. On a server the same code runs with
**PostgreSQL**, behind **HTTPS**:

```
Chrome Extension ──► https://leads.example.com ──► Caddy (HTTPS) ──► Node.js backend ──► PostgreSQL
Admin panel      ──► https://leads.example.com/admin
Resend / Meta    ──► https://leads.example.com/api/webhooks/…
```

`deploy/` contains a ready setup: `docker-compose.yml` (PostgreSQL 17, the app, Caddy with
automatic Let's Encrypt certificates), `Caddyfile`, example settings and a backup script.

## 1. What you need

- A Linux server (1 vCPU / 1–2 GB RAM is enough to start) with Docker and Docker Compose.
- A domain or subdomain (e.g. `leads.example.com`) whose DNS A/AAAA record points to the
  server. Ports 80 and 443 must be open: Caddy needs them for the certificate.

## 2. Configure

```bash
git clone <your repository> /opt/leads && cd /opt/leads
cp deploy/.env.example deploy/.env           # DOMAIN, POSTGRES_PASSWORD
cp deploy/app.env.example deploy/app.env     # SESSION_SECRET, admin, providers
```

- `POSTGRES_PASSWORD`: use hex (`openssl rand -hex 24`), because it goes into a URL.
- `SESSION_SECRET`: `openssl rand -base64 48`. **If you move data from your laptop, use the
  same value as in your local `backend/.env`.** Webhook signing secrets are encrypted with it.
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` (12+ characters): only used on the first start. Remove the
  password from the file afterwards. To change it later:
  `docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec app npm run admin:password`.

The backend **refuses to start** in production with example secrets, a weak admin password,
an `http://` `PUBLIC_BASE_URL` or `http://` CORS origins, and says exactly what to fix.

## 3. Start

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs -f app
```

On every start the app runs `prisma migrate deploy` (it only applies new migrations), then
starts. Open `https://<DOMAIN>/admin` and log in.

Updating to a new version: `git pull` and run the same `up -d --build` command again.

## 4. Move your local data (optional)

Only into a **fresh** database (the copy refuses to write into tables that already have rows):

```bash
# On your computer, with the server's PostgreSQL reachable (e.g. an SSH tunnel to port 5432):
DATABASE_PROVIDER=postgresql DATABASE_URL="postgresql://leads:<password>@localhost:5432/leads" npm run db:migrate -w backend
npm run db:copy-to-postgres -w backend -- --from ../data/app.db --to "postgresql://leads:<password>@localhost:5432/leads"
```

It copies every table in one transaction (all or nothing) and checks the row counts. Do it
before you create anything on the server, and keep the same `SESSION_SECRET`.

## 5. Point everything at the server

| Where | Set |
|---|---|
| Chrome extension, login screen | Backend `https://<DOMAIN>`. Chrome asks once for permission to reach it. |
| Resend → Webhooks | `https://<DOMAIN>/api/webhooks/email/resend` and `RESEND_WEBHOOK_SECRET` |
| Meta app → WhatsApp → Configuration | Callback `https://<DOMAIN>/api/webhooks/whatsapp/meta`, verify token = `META_WA_VERIFY_TOKEN` |
| n8n | Webhook URLs and tokens as in [n8n.md](n8n.md) |

Unsubscribe and click links in emails automatically use `PUBLIC_BASE_URL` (`https://<DOMAIN>`).

## 6. Backups

- **PostgreSQL**: `deploy/backup-postgres.sh` writes `backups/leads-<date>.sql.gz` with
  `pg_dump` and keeps the newest 14. Run it daily from cron (example inside the script), and
  copy `backups/` off the server (another machine or object storage). The restore command is
  in the script.
- **SQLite** (local): `npm run db:backup -w backend` writes a consistent copy to `data/backups/`
  while the backend keeps running, and keeps the newest 14.

Test a restore once, so you know it works before you need it.

## 7. Security checklist

- [ ] HTTPS only (Caddy). The app adds HSTS on HTTPS requests in production.
- [ ] `deploy/.env` and `deploy/app.env` are never committed (they are in `.gitignore`).
- [ ] Strong `SESSION_SECRET`, `POSTGRES_PASSWORD` and admin password; remove `ADMIN_PASSWORD` after the first start.
- [ ] PostgreSQL is not published to the internet (the compose file does not open port 5432).
- [ ] `TRUST_PROXY=1` (set in the compose file), so login rate limits apply per real client IP.
- [ ] Revoke extension and n8n tokens you no longer use (Settings / Integrations).
- [ ] Backups run daily and are copied off the server.
- [ ] Provider webhooks have their secrets set (`RESEND_WEBHOOK_SECRET`, `META_WA_APP_SECRET`).
- [ ] The server's firewall allows only 22, 80 and 443.

Logs never contain passwords, cookies, bearer tokens or webhook tokens (redacted). Sessions
expire, and expired ones are removed every 6 hours, together with webhook delivery logs older
than 30 days (delivered) or 90 days (failed). Leads, history and opt-outs are never deleted
automatically.

### Known `npm audit` findings (checked 2026-10-06)

`npm audit --omit=dev` reports issues in packages the app does not use in a vulnerable way:

- `mysql2` and `deepmerge-ts`, inside the Prisma **CLI** (used only to generate the client and
  run migrations; the app never talks to MySQL). npm's "fix" downgrades Prisma to 6.x, which
  would break the app. Update Prisma when a stable 7.x/8.x release fixes them.
- `uuid` < 11.1.1, inside `exceljs`: the bug is in `v3`/`v5`/`v6` with a buffer argument;
  exceljs only uses `v4`.

## 8. Without Docker

Any Node.js 24 host with PostgreSQL works:

```bash
npm ci --workspace shared --workspace backend --workspace admin --include-workspace-root
npm run build:admin
cd backend
export NODE_ENV=production DATABASE_PROVIDER=postgresql DATABASE_URL=postgresql://… # plus app.env values
npx prisma generate          # Prisma client for PostgreSQL
npx prisma migrate deploy
node --import tsx src/server.ts
```

Put it behind a reverse proxy with HTTPS (Caddy, nginx) and set `TRUST_PROXY=1`, `HOST=127.0.0.1`.
Keep it running with systemd or pm2.

## Developers: SQLite and PostgreSQL

`prisma/schema.prisma` is the single schema (SQLite). For PostgreSQL:

- `npm run db:pg:schema -w backend` regenerates `prisma/postgres/schema.prisma` from it.
- Create the PostgreSQL migration for a schema change with
  `DATABASE_PROVIDER=postgresql npx prisma migrate dev --name <change>` against a development
  PostgreSQL database (in `backend/`).
- A test fails if the PostgreSQL schema or migrations fall behind.
- `DATABASE_PROVIDER` decides which client `npx prisma generate` builds; regenerate when you switch.

Run the backend tests on PostgreSQL (tested with PostgreSQL 17; each test file uses its own schema):

```bash
cd backend
DATABASE_PROVIDER=postgresql npx prisma generate
DATABASE_PROVIDER=postgresql TEST_DATABASE_URL="postgresql://user:pass@localhost:5432/leads_test" npx vitest run
npx prisma generate   # back to SQLite
```

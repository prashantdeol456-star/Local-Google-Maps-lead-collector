# Production image: backend + built admin panel, PostgreSQL client, and zips of the Maps and
# LinkedIn Helper extensions for the admin panel's Extensions page.
#   docker compose -f deploy/docker-compose.yml up -d --build

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY admin/package.json admin/
COPY extension/package.json extension/
COPY linkedin-extension/package.json linkedin-extension/
COPY linkedin-messenger/package.json linkedin-messenger/
COPY meta-helper/package.json meta-helper/
# backend's postinstall runs `prisma generate`, which needs the schema and its config.
COPY backend/prisma backend/prisma
COPY backend/prisma.config.ts backend/
ENV DATABASE_PROVIDER=postgresql \
    DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN npm ci --workspace shared --workspace backend --workspace admin --workspace extension --workspace linkedin-extension --include-workspace-root
COPY shared shared
COPY backend backend
COPY admin admin
COPY extension extension
COPY linkedin-extension linkedin-extension
# Admin panel → backend/public/admin; extension zips → backend/public/extensions (admin
# Extensions page); Prisma client generated for PostgreSQL.
# (prisma.config.ts needs a DATABASE_URL; nothing connects during the build.)
RUN npm run build:admin \
 && npm run build:extensions \
 && cd backend \
 && DATABASE_PROVIDER=postgresql DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    DATABASE_PROVIDER=postgresql \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
WORKDIR /app/backend
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
# Apply pending migrations, then start (exec: the server receives SIGTERM directly).
CMD ["sh", "-c", "npx prisma migrate deploy && exec node --import tsx src/server.ts"]

# Production image: backend + built admin panel, PostgreSQL client. The Chrome extension is
# not part of it (it is built and loaded in Chrome separately).
#   docker compose -f deploy/docker-compose.yml up -d --build

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY admin/package.json admin/
COPY extension/package.json extension/
RUN npm ci --workspace shared --workspace backend --workspace admin --include-workspace-root
COPY shared shared
COPY backend backend
COPY admin admin
# Admin panel → backend/public/admin; Prisma client generated for PostgreSQL.
# (prisma.config.ts needs a DATABASE_URL; nothing connects during the build.)
RUN npm run build:admin \
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

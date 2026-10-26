import { buildApp } from "./app.js";
import { config } from "./config.js";
import { createPrismaClient } from "./database/client.js";

const db = createPrismaClient(config.databaseUrl);
const app = await buildApp({ config, db });
for (const warning of config.startupWarnings) app.log.warn(warning);

const adminStatus = await app.authService.ensureInitialAdmin(config.initialAdmin);
if (adminStatus === "created") app.log.info(`Initial admin created: ${config.initialAdmin?.email}`);
if (adminStatus === "skipped") app.log.warn("No admin exists. Set ADMIN_EMAIL and ADMIN_PASSWORD in backend/.env and restart.");

const shutdown = async () => {
  await app.close();
  await db.$disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const interrupted = await app.emailWorker.recover();
if (interrupted) app.log.warn(`${interrupted} email(s) were interrupted mid-send by the last shutdown and marked failed (not re-sent).`);
const waInterrupted = await app.whatsappWorker.recover();
if (waInterrupted) app.log.warn(`${waInterrupted} WhatsApp message(s) were interrupted mid-send by the last shutdown and marked failed (not re-sent).`);
app.emailWorker.start();
app.whatsappWorker.start();
app.inboxWorker.start();
app.webhookWorker.start();
app.maintenance.start();

await app.listen({ port: config.port, host: config.host });

// Changes an admin's password (or creates the admin) from the terminal:
//   npm run admin:password -w backend
// The password is typed at a prompt (not passed as an argument) so it stays out of shell history.
// All existing sessions and extension tokens of that admin are signed out.

import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { config } from "../config.js";
import { createPrismaClient } from "../database/client.js";
import { hashPassword } from "../services/auth/password.js";

// One readline for the whole session; typed characters are hidden while a password is asked.
let muted = false;
const output = new Writable({
  write(chunk, _enc, cb) {
    if (!muted) process.stdout.write(chunk);
    cb();
  },
});
const rl = createInterface({ input: process.stdin, output, terminal: !!process.stdin.isTTY });
const lines = rl[Symbol.asyncIterator]();

async function ask(question: string, hidden = false): Promise<string> {
  process.stdout.write(question);
  muted = hidden;
  const { value, done } = await lines.next();
  muted = false;
  if (hidden) process.stdout.write("\n");
  if (done) throw new Error("No input");
  return String(value).trim();
}

const db = createPrismaClient(config.databaseUrl);
try {
  const email = (await ask("Admin email: ")).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Not a valid email");
  const password = await ask("New password (min 8 characters): ", true);
  if (password.length < 8) throw new Error("Password must be at least 8 characters");
  if ((await ask("Repeat password: ", true)) !== password) throw new Error("Passwords do not match");

  const passwordHash = await hashPassword(password);
  const existing = await db.adminUser.findUnique({ where: { email } });
  if (existing) {
    await db.$transaction([
      db.adminUser.update({ where: { email }, data: { passwordHash } }),
      db.session.deleteMany({ where: { userId: existing.id } }),
      db.apiToken.updateMany({ where: { userId: existing.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    console.log(`Password changed for ${email}. Existing logins (admin panel and extensions) were signed out.`);
  } else {
    await db.adminUser.create({ data: { email, name: "Admin", passwordHash } });
    console.log(`Admin ${email} created.`);
  }
} catch (err) {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  rl.close();
  await db.$disconnect();
}

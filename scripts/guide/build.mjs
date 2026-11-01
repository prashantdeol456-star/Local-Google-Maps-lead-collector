// Rebuilds the user guide's screenshots and PDFs:   npm run guide:build
//
// 1. creates a throw-away demo database (data/guide-demo.db) and starts the backend on it,
// 2. fills it with sample data (never real customer data),
// 3. takes the screenshots in SHOTS into admin/public/guide,
// 4. builds the admin panel and prints the Guide page to the two PDFs,
// 5. stops the server and deletes the demo database.
//
// New screen in the guide? Add it to SHOTS (file name = the `img()` name in
// admin/src/guide/content.ts). Needs Google Chrome; set CHROME_PATH if it is not found.

import { execSync, spawn } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BACKEND = join(ROOT, "backend");
const OUT = join(ROOT, "admin", "public", "guide");
const PORT = Number(process.env.GUIDE_PORT ?? 3099);
const B = `http://127.0.0.1:${PORT}`;
const DB_FILE = join(ROOT, "data", "guide-demo.db");
const DB_URL = "file:../data/guide-demo.db";
// Demo-only accounts, created in the throw-away database above.
const OWNER = { email: "owner@demo.test", password: "guide-demo-pass-1" };
const CUSTOMER = { email: "demo.shop@example.com", username: "demo.shop", password: "demo-shop-pass-1" };

const CHROME =
  process.env.CHROME_PATH ??
  [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].find((p) => existsSync(p));

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, cwd, env = {}) => execSync(cmd, { cwd, stdio: "inherit", env: { ...process.env, ...env } });

function removeDb() {
  for (const f of readdirSync(join(ROOT, "data"))) if (f.startsWith("guide-demo.db")) rmSync(join(ROOT, "data", f), { force: true });
}

// ---------- demo data ----------
async function j(method, path, body, token) {
  const res = await fetch(B + path, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const token = async (email, password) => (await j("POST", "/api/auth/token", { email, password })).token;

async function seed() {
  const sa = await token(OWNER.email, OWNER.password);
  await j("PUT", "/api/site/settings", {
    brandName: "Lead Platform",
    contactEmail: "support@the360tech.com",
    contactPhone: "+91 95573 93301",
    address: "Sector 62, Noida, Uttar Pradesh 201301",
  }, sa);

  await j("POST", "/api/auth/register", { email: CUSTOMER.email, phone: "+91 90000 00001", username: CUSTOMER.username, password: CUSTOMER.password });
  await j("POST", "/api/auth/register", { email: "new.agency@example.com", phone: "+91 90000 00002", username: "new.agency", password: "new-agency-pass-1" });
  const users = (await j("GET", `/api/users?q=${CUSTOMER.username}`, null, sa)).items;
  await j("POST", `/api/users/${users[0].id}/approve`, null, sa);
  const cu = await token(CUSTOMER.username, CUSTOMER.password);

  const job = (await j("POST", "/api/jobs", { searchKeyword: "Hospital", location: "Lucknow" }, cu)).job;
  await j("PATCH", `/api/jobs/${job.id}`, { status: "running" }, cu);
  const places = [
    ["City Care Hospital", "Hospital", "+91 90000 10001", "citycare.example.in", "Gomti Nagar, Lucknow", 4.5, 812],
    ["Sunrise Clinic", "Medical clinic", "+91 90000 10002", "sunriseclinic.example.in", "Hazratganj, Lucknow", 4.3, 240],
    ["Green Valley Diagnostics", "Diagnostic centre", "+91 90000 10003", null, "Aliganj, Lucknow", 4.7, 530],
    ["Shanti Nursing Home", "Hospital", "+91 90000 10004", "shantinursing.example.in", "Indira Nagar, Lucknow", 4.1, 156],
    ["Lifeline Dental Care", "Dentist", "+91 90000 10005", "lifelinedental.example.in", "Mahanagar, Lucknow", 4.8, 402],
    ["Metro Eye Hospital", "Eye care centre", "+91 90000 10006", null, "Kapoorthala, Lucknow", 4.4, 377],
  ];
  let n = 0;
  for (const [name, category, phone, website, address, rating, reviewCount] of places) {
    await j("POST", "/api/leads", {
      jobId: job.id,
      clientKey: `k${n++}`,
      lead: { name, category, phone, website: website && `https://${website}`, email: website ? `info@${website}` : null, address, city: "Lucknow", state: "Uttar Pradesh", country: "India", rating, reviewCount, searchKeyword: "Hospital" },
    }, cu);
  }
  await j("PATCH", `/api/jobs/${job.id}`, { status: "completed" }, cu);

  for (const [slug, name, headline, company] of [
    ["rahul-hr-demo", "Rahul Verma", "HR Manager at Acme Healthcare", "Acme Healthcare"],
    ["neha-ops-demo", "Neha Singh", "Operations Head | Hospital administration", "City Care Hospital"],
    ["amit-founder-demo", "Amit Gupta", "Founder at Sunrise Clinics", "Sunrise Clinics"],
  ]) {
    await j("POST", "/api/linkedin/leads", { lead: { profileUrl: `https://www.linkedin.com/in/${slug}`, name, headline, company, location: "Lucknow, Uttar Pradesh, India", emails: [`${slug.split("-")[0]}@example.com`], tag: "Hospitals Lucknow" } }, cu);
  }

  const sheet = "Name,LinkedIn URL,Contact Number,Email,Designation,Company\nPriya Sharma,https://www.linkedin.com/in/priya-demo,+91 90000 20001,priya@example.com,Marketing Head,Priya Digital\nKaran Mehta,https://www.linkedin.com/in/karan-demo,+91 90000 20002,karan@example.com,Owner,Mehta Traders\n";
  await j("POST", "/api/contacts/import", { fileName: "contacts.csv", data: Buffer.from(sheet).toString("base64"), listName: "Noida shops" }, cu);

  await j("PUT", "/api/senders/email", { provider: "log", from: "Demo Shop <hello@demo-shop.example>" }, cu);
  const tpl = (await j("POST", "/api/templates", { name: "Introduction", subject: "Hello {{name}} – quick question", body: "Hi {{name}},\n\nWe help hospitals in {{city}} reach more patients online. Can I share a 2-minute idea?\n\nRegards,\nDemo Shop" }, cu)).template;
  const leadIds = (await j("GET", "/api/leads?pageSize=25", null, cu)).items.filter((l) => l.email).map((l) => l.id);
  await j("POST", "/api/email/campaigns", { name: "Hospitals Lucknow – intro", templateId: tpl.id, recipients: { leadIds }, intervalSec: 60, dailyLimit: 50, windowStart: "10:00", windowEnd: "18:00" }, cu);
  await j("POST", "/api/opt-outs", { channel: "email", addresses: "no-marketing@example.com", reason: "Asked not to be contacted" }, cu);

  // Billing: demo Razorpay test keys (not real; the throw-away database is deleted afterwards) and a manual credit
  await j("PUT", "/api/platform-integrations/razorpay", { keyId: "rzp_test_GuideDemo01", keySecret: "guide-demo-not-a-real-secret", webhookSecret: "guide-demo-webhook" }, sa);
  await j("POST", `/api/billing/accounts/${users[0].id}/adjust`, { amountInr: 500, note: "Paid by bank transfer" }, sa);

  await fetch(B + "/contact", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ name: "Priya Sharma", email: "priya@example.com", phone: "+91 90000 00009", company: "Priya Digital", message: "Hi, I would like a demo of the Google Maps leads feature for my agency." }),
    redirect: "manual",
  });
}

// ---------- screenshots ----------
async function shoot(page) {
  async function login(email, password) {
    await page.goto(B + "/admin/", { waitUntil: "load" });
    await page.evaluate(async (e, p) => {
      await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
      const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: e, password: p }) });
      if (!r.ok) throw new Error("login failed " + r.status);
    }, email, password);
  }
  const clickText = (text) =>
    page.evaluate((t) => {
      const el = [...document.querySelectorAll("button, a")].find((b) => b.textContent.trim().startsWith(t));
      el?.click();
      return !!el;
    }, text);
  async function shot(name, path, before) {
    await page.goto(B + path, { waitUntil: "load" }); // not "networkidle": the live-updates stream never goes idle
    await pause(1500);
    if (before) {
      await before();
      await pause(1500);
    }
    await page.screenshot({ path: join(OUT, `${name}.jpg`), type: "jpeg", quality: 85 });
    console.log("shot", name);
  }

  await shot("01-website-home", "/");
  await shot("02-website-pricing", "/pricing");
  await shot("03-register", "/admin/register");
  await shot("04-login", "/admin/");

  await login(CUSTOMER.username, CUSTOMER.password);
  await shot("05-dashboard", "/admin/");
  await shot("06-extensions", "/admin/extensions");
  await shot("07-maps-leads", "/admin/leads");
  await shot("08-collections", "/admin/collections");
  await shot("09-linkedin-leads", "/admin/linkedin");
  await shot("10-my-sender", "/admin/sender");
  await shot("11-templates", "/admin/templates");
  const campaignId = await page.evaluate(async () => (await (await fetch("/api/email/campaigns")).json()).items[0].id);
  await shot("12-email-campaign", `/admin/email/${campaignId}`);
  await shot("13-opt-outs", "/admin/opt-outs");
  await shot("14-ai-inbox-setup", "/admin/inbox", () => clickText("Setup"));
  await shot("15-social-accounts", "/admin/social");
  await shot("18-quick-send", "/admin/quick-send", async () => {
    await page.type('input[placeholder^="e.g."]', "Diwali offer – Noida");
    await page.type("textarea", "ravi@shop.example\n+91 98765 43210\nAsha Verma, asha@agency.example, 98100 12345\n");
    await page.click('input[type="checkbox"]');
    await clickText("Save");
  });
  await shot("19-contacts", "/admin/contacts");
  await shot("21-billing", "/admin/billing");

  await login(OWNER.email, OWNER.password);
  await shot("16-users", "/admin/users", () => clickText("Services ("));
  await shot("17-website-settings", "/admin/website");
  await shot("20-contact-leads", "/admin/contact-leads");
  await shot("22-payments", "/admin/payments?tab=accounts");
  await shot("23-platform-integrations", "/admin/platform", () => page.waitForFunction(() => document.body.innerText.includes("online recharge"), { timeout: 20_000 }));
}

// ---------- PDFs ----------
async function printPdfs(page) {
  await page.setViewport({ width: 1100, height: 1400 });
  await page.goto(B + "/admin/", { waitUntil: "load" });
  async function print(path, file, title) {
    await page.goto(B + path, { waitUntil: "load" });
    await page.waitForSelector("#overview");
    await page.evaluate(async () => {
      for (const img of document.querySelectorAll("img")) img.loading = "eager";
      await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => (img.onload = img.onerror = r)))));
    });
    await pause(800);
    await page.pdf({
      path: join(OUT, file),
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", bottom: "16mm", left: "14mm", right: "14mm" },
      displayHeaderFooter: true,
      headerTemplate: `<div style="font-size:8px;width:100%;padding:0 14mm;color:#5f6368;font-family:Arial">${title}</div>`,
      footerTemplate: '<div style="font-size:8px;width:100%;padding:0 14mm;color:#5f6368;font-family:Arial;text-align:right">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
    });
    console.log("pdf", file);
  }
  await print("/admin/guide?audience=customer", "lead-platform-guide.pdf", "Lead Platform – User guide");
  await print("/admin/guide", "lead-platform-admin-guide.pdf", "Lead Platform – Guide (with administrator sections)");
}

// ---------- main ----------
if (!CHROME) throw new Error("Google Chrome not found: set CHROME_PATH");
removeDb();
run("npx prisma migrate deploy", BACKEND, { DATABASE_URL: DB_URL });
run("npm run build:admin", ROOT);

const server = spawn("npx tsx src/server.ts", {
  cwd: BACKEND,
  shell: true,
  stdio: "ignore",
  env: { ...process.env, PORT: String(PORT), DATABASE_URL: DB_URL, PUBLIC_BASE_URL: "https://lead.the360tech.com", ADMIN_EMAIL: OWNER.email, ADMIN_PASSWORD: OWNER.password },
});
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-first-run", "--disable-extensions"] });
try {
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(B + "/api/health")).ok) break;
    } catch {}
    if (i > 60) throw new Error("backend did not start");
    await pause(1000);
  }
  await seed();
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(90_000);
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await shoot(page);
  run("npm run build:admin", ROOT); // copies the new screenshots into the served build
  await printPdfs(page);
  run("npm run build:admin", ROOT); // and the new PDFs
} finally {
  await browser.close();
  if (process.platform === "win32") execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: "ignore" });
  else server.kill("SIGTERM");
  await pause(1000);
  removeDb();
}
console.log("Guide screenshots and PDFs updated in admin/public/guide");

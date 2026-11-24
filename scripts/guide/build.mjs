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
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
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

  // Justdial demo leads (as the extension sends them in Justdial mode)
  const jdJob = (await j("POST", "/api/jobs", { searchKeyword: "Study Visa Consultants", location: "Delhi" }, cu)).job;
  await j("PATCH", `/api/jobs/${jdJob.id}`, { status: "running" }, cu);
  const jd = [
    ["Global Study Visa Point", "Visa Assistance, Immigration Consultants", "Punjabi Bagh", "1999", 4.5, 209, true, 4.6, 980, "globalstudyvisa.example.in"],
    ["Pathway Overseas Education", "Overseas Education Consultants, Visa Assistance", "Laxmi Nagar", "2011", 4.8, 612, true, 4.7, 455, "pathwayoverseas.example.in"],
    ["Canada Dream Consultants", "Immigration Consultants For Canada", "Rajouri Garden", "2016", 4.2, 88, true, 4.4, 131, null],
    ["Student Visa Hub", "Student Visa Assistance", "Janakpuri", null, 4.0, 35, false, null, null, null],
  ];
  let m = 0;
  for (const [name, categories, area, established, jdRating, jdReviews, onMaps, mapsRating, mapsReviews, site] of jd) {
    m++;
    await j("POST", "/api/leads", {
      jobId: jdJob.id,
      clientKey: `jd:${m}`,
      lead: { name, category: categories.split(",")[0], phone: onMaps ? `+91 90000 3000${m}` : null, website: site && `https://${site}`, email: site ? `info@${site}` : null, address: `Shop ${m}, Main Market, ${area}, New Delhi`, city: "New Delhi", state: "Delhi", country: "India", postalCode: "110026", rating: jdRating, reviewCount: jdReviews, searchKeyword: "Study Visa Consultants", source: "justdial" },
      justdial: {
        docid: `011PXX11.XX11.DEMO${m}`, jdUrl: `https://www.justdial.com/Delhi/demo-${m}`, jdPhone: `0794700000${m}`, jdRating, jdReviewCount: jdReviews, categories, area, established, hours: "Open until 7:00 pm", photos: [],
        mapsMatched: onMaps, mapsName: onMaps ? name : null, mapsPhone: onMaps ? `+91 90000 3000${m}` : null, mapsWebsite: site && `https://${site}`, mapsRating, mapsReviewCount: mapsReviews, mapsUrl: onMaps ? "https://www.google.com/maps/place/?q=place_id:ChIJdemo" : null,
      },
    }, cu);
  }
  await j("PATCH", `/api/jobs/${jdJob.id}`, { status: "completed" }, cu);

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

  // WhatsApp Chat: the demo number ("log": nothing leaves the server) and two chats started with a template
  await j("PUT", "/api/senders/whatsapp", { provider: "log" }, cu);
  const waTpl = (await j("POST", "/api/whatsapp/templates", { name: "visa_followup", language: "en", category: "marketing", paramFormat: "positional", approvalStatus: "approved", body: "Hello {{name|there}}, thanks for your enquiry about studying abroad. When can our counsellor call you?" }, cu)).template;
  await j("POST", "/api/whatsapp/chats", { phone: "+91 90000 40001", name: "Riya Sharma", templateId: waTpl.id }, cu);
  await j("POST", "/api/whatsapp/chats", { phone: "+91 90000 40002", name: "Aman Verma", templateId: waTpl.id }, cu);

  // Social Engagement: there is no Facebook in the demo, so the rows a sync would save go straight into the demo database.
  seedEngagement(users[0].id);

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

/** Demo Facebook Page + Instagram account with comments, reactions and shares (made-up people). */
function seedEngagement(ownerId) {
  const db = new DatabaseSync(DB_FILE);
  const at = (hoursAgo) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString().replace("Z", "+00:00");
  const id = () => randomUUID().replace(/-/g, "").slice(0, 25);
  const now = at(0);
  const insert = (table, row) => {
    const keys = Object.keys(row);
    db.prepare(`INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...Object.values(row));
  };
  const meta = (extra) => JSON.stringify({ ...extra, engagement: { syncedAt: at(0.2), error: null, realtime: true } });
  const fb = id();
  const ig = id();
  insert("SocialAccount", { id: fb, ownerId, platform: "facebook_page", externalId: "demo-page-1", name: "Pathway Overseas Education", tokenEnc: "demo", scopes: "[]", status: "connected", meta: meta({}), createdAt: now, updatedAt: now });
  insert("SocialAccount", { id: ig, ownerId, platform: "instagram", externalId: "demo-ig-1", name: "Pathway Overseas", username: "pathway.overseas", tokenEnc: "demo", scopes: "[]", status: "connected", meta: meta({ pageId: "demo-page-1" }), createdAt: now, updatedAt: now });
  const posts = [
    [fb, "facebook", "Canada September intake: applications open. Free profile check this week!", 30, 14, 9, 3],
    [fb, "facebook", "Congratulations Simran on your UK student visa 🎉", 70, 6, 41, 2],
    [ig, "instagram", "IELTS weekend batch starts Saturday ✍️", 20, 8, 126, null],
  ].map(([accountId, platform, message, hoursAgo, comments, reactions, shares], i) => {
    const pid = id();
    insert("SocialPost", { id: pid, ownerId, accountId, platform, externalId: `demo-post-${i}`, message, postedAt: at(hoursAgo), commentCount: comments, reactionCount: reactions, shareCount: shares, lastSyncedAt: now, createdAt: now, updatedAt: now });
    return { pid, accountId, platform };
  });
  const people = {};
  const person = (platform, name, username) => {
    const key = platform + name;
    if (!people[key]) {
      people[key] = { id: id(), platform, name, username, rows: [] };
    }
    return people[key];
  };
  const add = (post, p, kind, hoursAgo, extra = {}) => p.rows.push({ post, kind, hoursAgo, ...extra });
  const [canada, uk, ielts] = posts;
  add(canada, person("facebook", "Rohit Malhotra"), "comment", 2, { text: "What are the fees for the Canada diploma programs?", lead: 1 });
  add(canada, person("facebook", "Rohit Malhotra"), "reaction", 2.1, { type: "LIKE" });
  add(canada, person("facebook", "Sneha Kapoor"), "comment", 5, { text: "Please share details, I want to apply for September", lead: 1, replied: "Hi Sneha, we have sent you the details in Messenger." });
  add(canada, person("facebook", "Sneha Kapoor"), "share", 5.5);
  add(canada, person("facebook", "Arjun Bedi"), "reaction", 6, { type: "LOVE" });
  add(canada, person("facebook", "Manpreet Kaur"), "comment", 9, { text: "Is there any scholarship available?", lead: 1 });
  add(uk, person("facebook", "Simran Gill"), "comment", 60, { text: "Thank you so much team! Couldn't have done it without you ❤️", replied: "Congratulations Simran!" });
  add(uk, person("facebook", "Arjun Bedi"), "reaction", 62, { type: "WOW" });
  add(uk, person("facebook", "Vikas Yadav"), "share", 64);
  add(ielts, person("instagram", "karan.mehta_", "karan.mehta_"), "comment", 1, { text: "Fees kitni hai weekend batch ki?", lead: 1 });
  add(ielts, person("instagram", "priya.travels", "priya.travels"), "comment", 3, { text: "Superb 🔥" });
  add(ielts, person("instagram", "anjali.s", "anjali.s"), "comment", 4, { text: "DM me the timings please", lead: 1 });
  for (const p of Object.values(people)) {
    const comments = p.rows.filter((r) => r.kind === "comment");
    const times = p.rows.map((r) => r.hoursAgo);
    insert("SocialPerson", {
      id: p.id, ownerId, platform: p.platform, externalId: `demo-${p.id}`, name: p.name, username: p.username ?? null,
      profileUrl: p.username ? `https://www.instagram.com/${p.username}/` : null,
      comments: comments.length, reactions: p.rows.filter((r) => r.kind === "reaction").length, shares: p.rows.filter((r) => r.kind === "share").length,
      leadSignal: comments.some((c) => c.lead) ? 1 : 0, status: p.name === "Simran Gill" ? "customer" : "new", lastComment: comments.at(0)?.text ?? null,
      firstSeenAt: at(Math.max(...times)), lastSeenAt: at(Math.min(...times)), createdAt: now, updatedAt: now,
    });
    for (const r of p.rows) {
      insert("SocialEngagement", {
        id: id(), ownerId, accountId: r.post.accountId, postId: r.post.pid, personId: p.id, platform: p.platform, kind: r.kind, externalId: id(),
        reactionType: r.type ?? null, text: r.text ?? null, leadSignal: r.lead ? 1 : 0, repliedAt: r.replied ? at(r.hoursAgo - 0.5) : null, replyText: r.replied ?? null,
        occurredAt: at(r.hoursAgo), createdAt: now, updatedAt: now,
      });
    }
  }
  db.close();
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
  await shot("24-justdial-leads", "/admin/justdial");
  const waChat = await page.evaluate(async () => (await (await fetch("/api/whatsapp/chats")).json()).items[0].id);
  await shot("25-whatsapp-chat", `/admin/whatsapp-chat?chat=${waChat}`);
  await shot("26-social-engagement", "/admin/engagement");

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
    const errors = [];
    const onError = (err) => errors.push(String(err));
    page.on("pageerror", onError);
    await page.goto(B + path, { waitUntil: "load" });
    await page.waitForSelector("#overview", { timeout: 60_000 }).catch(async (err) => {
      const text = await page.evaluate(() => document.body.innerText.slice(0, 500)).catch(() => "");
      throw new Error(`The guide page did not show (${path}). Page text: ${text}
Page errors: ${errors.join(" | ")}
${err}`);
    });
    page.off("pageerror", onError);
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

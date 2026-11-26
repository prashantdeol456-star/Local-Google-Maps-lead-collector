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
  seedInbox(users[0].id);
  seedBulkJob(users[0].id);
  seedMarketplace(users[0].id);
  seedApollo(users[0].id);
  seedSnov(users[0].id);

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

/** Demo AI Inbox chats (Instagram, Facebook, Telegram, LinkedIn) for All messages (made-up people). */
function seedInbox(ownerId) {
  const db = new DatabaseSync(DB_FILE);
  const at = (minutesAgo) => new Date(Date.now() - minutesAgo * 60_000).toISOString().replace("Z", "+00:00");
  const id = () => randomUUID().replace(/-/g, "").slice(0, 25);
  const now = at(0);
  const chats = [
    ["instagram", "Karan Mehta", "karan.mehta_", 4, 2, "needs_reply", [["in", "Hi! Is the IELTS weekend batch still open?", 6], ["in", "Fees kitni hai?", 4]]],
    ["facebook", "Sneha Kapoor", null, 50, 0, "replied", [["in", "Can I book a free profile check for Canada?", 70], ["out", "Sure Sneha! Tomorrow 11 am works?", 50]]],
    ["telegram", "Rahul Verma", "rahulv", 140, 1, "needs_reply", [["in", "Please send the document checklist for UK student visa", 140]]],
    ["linkedin", "Neha Singh", null, 26 * 60, 0, "replied", [["in", "Hello, we are looking for a visa partner for our students.", 27 * 60], ["out", "Happy to help, Neha. Can we talk this week?", 26 * 60]]],
  ];
  for (const [platform, name, username, lastMin, unread, status, messages] of chats) {
    const cid = id();
    const inbound = messages.filter((m) => m[0] === "in").map((m) => m[2]);
    db.prepare(
      `INSERT INTO "InboxConversation" ("id","ownerId","platform","accountKey","externalThreadId","participantName","participantUsername","status","lastInboundAt","lastMessageAt","unreadCount","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(cid, ownerId, platform, platform === "telegram" ? "bot" : "demo", `demo-${cid}`, name, username, status, inbound.length ? at(Math.min(...inbound)) : null, at(lastMin), unread, now, now);
    for (const [direction, text, minutesAgo] of messages) {
      db.prepare(`INSERT INTO "InboxMessage" ("id","ownerId","conversationId","direction","text","author","sentAt","createdAt") VALUES (?,?,?,?,?,?,?,?)`).run(
        id(), ownerId, cid, direction, text, direction === "in" ? "customer" : "admin", at(minutesAgo), now,
      );
    }
  }
  db.close();
}

/** A finished Email finder sheet (made-up businesses) for Email finder → Bulk. */
function seedBulkJob(ownerId) {
  const db = new DatabaseSync(DB_FILE);
  const now = new Date().toISOString().replace("Z", "+00:00");
  const id = () => randomUUID().replace(/-/g, "").slice(0, 25);
  const jobId = id();
  const rows = [
    ["Rohit Malhotra", "Global Study Visa Point", "globalstudyvisa.example.in", "Director", "found", [["info@globalstudyvisa.example.in", "contact_page"]], [["+91 98100 30001", "website"]], null],
    ["Sneha Kapoor", "Pathway Overseas Education", "pathwayoverseas.example.in", "Counsellor", "found", [["sneha.kapoor@pathwayoverseas.example.in", "hunter"]], [["011 4501 2345", "contact_page"]], null],
    [null, "Canada Dream Consultants", "canadadream.example.in", null, "found", [], [["+91 98111 22233", "website"]], null],
    ["Karan Mehta", "Student Visa Hub", null, "Owner", "not_found", [], [], "Hunter: not found"],
    [null, "Lifeline Dental Care", "lifelinedental.example.in", null, "found", [["care@lifelinedental.example.in", "website"]], [], null],
  ];
  db.prepare(`INSERT INTO "EnrichJob" ("id","ownerId","name","fileName","status","useWebsites","useHunter","hunterBudget","hunterUsed","total","done","found","createdAt","updatedAt","finishedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    jobId, ownerId, "Visa consultants Delhi", "visa-delhi.xlsx", "done", 1, 1, 10, 1, rows.length, rows.length, 4, now, now, now,
  );
  rows.forEach(([name, company, website, designation, status, emails, phones, note], i) => {
    db.prepare(`INSERT INTO "EnrichJobRow" ("id","ownerId","jobId","idx","name","company","website","designation","status","emails","phones","note","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id(), ownerId, jobId, i, name, company, website, designation, status,
      JSON.stringify(emails.map(([value, source]) => ({ value, source }))), JSON.stringify(phones.map(([value, source]) => ({ value, source }))), note, now,
    );
  });
  db.close();
}

/** Demo IndiaMART + TradeIndia sources with a few buyer enquiries (made-up people). */
function seedMarketplace(ownerId) {
  const db = new DatabaseSync(DB_FILE);
  const at = (minAgo) => new Date(Date.now() - minAgo * 60_000).toISOString().replace("Z", "+00:00");
  const id = () => randomUUID().replace(/-/g, "").slice(0, 25);
  const im = id();
  const ti = id();
  const src = db.prepare(`INSERT INTO "MarketplaceSource" ("id","ownerId","kind","name","configEnc","configHint","enabled","status","lastPolledAt","lastLeadAt","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  src.run(im, ownerId, "indiamart", "IndiaMART", "demo", "…k7Q2", 1, "ok", at(1), at(12), at(3000), at(1));
  src.run(ti, ownerId, "tradeindia", "TradeIndia", "demo", "…91ab", 1, "ok", at(2), at(95), at(3000), at(2));
  const leads = [
    [im, "indiamart", "Ramesh Gupta", "+919810012345", "ramesh@guptatraders.example.in", "Gupta Traders", "Delhi", "Delhi", "Refurbished laptops", "Need 50 units of i5 laptops, best price with GST bill?", 12, "sent", "Template enquiry_thanks"],
    [im, "indiamart", "Anita Shah", "+919822000111", null, "Shah Mobiles", "Pune", "Maharashtra", "Mobile phone accessories", "Bulk order of chargers and cables for my shop.", 48, "sent", "Template enquiry_thanks"],
    [ti, "tradeindia", "Vikram Singh", "+919811100000", "vikram@vkexports.example.in", "VK Exports", "Mumbai", "Maharashtra", "Copper cables", "Please send your catalogue and MOQ.", 95, "none", null],
    [im, "indiamart", "Farhan Ali", "+919900112233", null, null, "Lucknow", "Uttar Pradesh", "Smartphones", "Looking for a wholesale dealer in Lucknow.", 300, "failed", "Add your WhatsApp number on My sender"],
  ];
  const lead = db.prepare(`INSERT INTO "MarketplaceLead" ("id","ownerId","sourceId","kind","externalId","name","mobile","email","company","city","state","product","message","receivedAt","followUp","followUpNote","createdAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  leads.forEach(([sourceId, kind, name, mobile, email, company, city, state, product, message, minAgo, followUp, note], i) => {
    lead.run(id(), ownerId, sourceId, kind, String(5000 + i), name, mobile, email, company, city, state, product, message, at(minAgo), followUp, note, at(minAgo));
  });
  db.close();
}

/** Demo Snov.io credentials (never used: only the card is shown). */
function seedSnov(ownerId) {
  const db = new DatabaseSync(DB_FILE);
  const now = new Date().toISOString().replace("Z", "+00:00");
  const reset = new Date(Date.now() + 18 * 86400_000).toISOString().replace("Z", "+00:00");
  db.prepare(`INSERT INTO "SnovAccount" ("id","keyEnc","keyHint","status","credits","creditsPeak","resetDate","checkedAt","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?)`).run(ownerId, "demo", "…a41c", "ok", 42, 50, reset, now, now, now);
  db.close();
}

/** Demo Apollo key (never used: the guide's search answer is filled in the browser). */
function seedApollo(ownerId) {
  const db = new DatabaseSync(DB_FILE);
  const now = new Date().toISOString().replace("Z", "+00:00");
  const end = new Date(Date.now() + 20 * 86400_000).toISOString().replace("Z", "+00:00");
  db.prepare(`INSERT INTO "ApolloAccount" ("id","keyEnc","keyHint","status","creditsLimit","creditsUsed","cycleEnd","checkedAt","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?)`).run(ownerId, "demo", "…x9Fq", "ok", 75, 12, end, now, now, now);
  db.close();
}

/** What the guide shows for an Apollo search (made-up people). */
const APOLLO_DEMO = {
  total: 1842,
  page: 1,
  pages: 74,
  pageSize: 25,
  people: [
    { id: "d1", firstName: "Neha", lastName: "Ag***l", title: "HR Manager", company: "Brightpath Infotech", domain: "brightpath.example.in", hasEmail: true, revealed: { name: "Neha Agarwal", title: "HR Manager", company: "Brightpath Infotech", email: "neha.agarwal@brightpath.example.in", emailStatus: "verified", linkedinUrl: "https://www.linkedin.com/in/example-neha", city: "Noida", country: "India" } },
    { id: "d2", firstName: "Arjun", lastName: "Me***a", title: "Head of Talent Acquisition", company: "Corelink Systems", domain: "corelink.example.in", hasEmail: true, revealed: { name: "Arjun Mehra", title: "Head of Talent Acquisition", company: "Corelink Systems", email: "arjun@corelink.example.in", emailStatus: "verified", linkedinUrl: null, city: "Noida", country: "India" } },
    { id: "d3", firstName: "Pooja", lastName: "Si***h", title: "HR Manager", company: "Nimbus Retail", domain: "nimbusretail.example.in", hasEmail: true, revealed: null },
    { id: "d4", firstName: "Vikas", lastName: "Ya***v", title: "Senior HR Manager", company: "Greenleaf Foods", domain: "greenleaf.example.in", hasEmail: true, revealed: null },
    { id: "d5", firstName: "Simran", lastName: "Ka***r", title: "HR Business Partner", company: "Orbit Logistics", domain: null, hasEmail: false, revealed: null },
  ],
};

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
  const igChat = await page.evaluate(async () => (await (await fetch("/api/messages/chats?platform=instagram")).json()).items[0].id);
  await shot("27-all-messages", `/admin/messages?chat=in:${igChat}`);
  const bulkJob = await page.evaluate(async () => (await (await fetch("/api/enrich/jobs")).json()).items[0].id);
  await shot("29-email-finder-bulk", `/admin/email-finder?job=${bulkJob}`);
  await shot("30-marketplace-leads", "/admin/marketplace");
  await shot("32-email-finder-snov", "/admin/email-finder", () => page.evaluate(() => [...document.querySelectorAll("h2")].find((h) => h.textContent.startsWith("Snov.io"))?.closest(".card")?.scrollIntoView({ block: "center" })));
  await page.setRequestInterception(true);
  const apolloDemo = (req) => {
    if (req.url().endsWith("/api/enrich/apollo/search")) req.respond({ status: 200, contentType: "application/json", body: JSON.stringify(APOLLO_DEMO) });
    else req.continue();
  };
  page.on("request", apolloDemo);
  await shot("31-apollo-search", "/admin/email-finder?tab=apollo", async () => {
    await page.type('input[placeholder="HR Manager, Purchase Manager"]', "HR Manager");
    await page.type('input[placeholder="Noida, India; Gurugram, India"]', "Noida, India");
    await clickText("Search Apollo");
    await pause(1200);
    await page.click('input[aria-label="Select Pooja"]');
    await page.click('input[aria-label="Select Vikas"]');
    await page.evaluate(() => document.querySelector("table")?.closest(".card")?.scrollIntoView({ block: "start" }));
  });
  page.off("request", apolloDemo);
  await page.setRequestInterception(false);

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

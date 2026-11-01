// The user guide: shown on the Guide page and printed to the PDF (same content, one source).
// Screenshots live in admin/public/guide; `npm run guide:build` retakes them from a demo
// account and prints the PDFs (scripts/guide/build.mjs).
//
// Adding a feature? Add or update its section here and list its menu path in `pages`, so the
// "Guide" button on that page opens it. tests/guide.test.ts fails when a menu page has no
// section or a section points to a screenshot that does not exist. Titles are numbered on screen.

export type Audience = "all" | "admin";

export interface GuideTable {
  head: string[];
  rows: string[][];
}

export interface GuideSection {
  id: string;
  title: string;
  audience: Audience;
  /** Admin panel menu paths this section explains (the page's Guide button opens it). */
  pages?: string[];
  intro?: string;
  image?: { src: string; alt: string };
  steps?: string[];
  table?: GuideTable;
  notes?: string[];
}

/** PDFs printed from this page (see the guide script): customers' guide and the full one. */
export const GUIDE_PDF = { customer: "/admin/guide/lead-platform-guide.pdf", admin: "/admin/guide/lead-platform-admin-guide.pdf" };

const img = (name: string, alt: string) => ({ src: `/admin/guide/${name}.jpg`, alt });

export const GUIDE: GuideSection[] = [
  {
    id: "overview",
    title: "What this platform does",
    audience: "all",
    pages: ["/guide"],
    intro:
      "Lead Platform helps you find business leads and reach them. It works in five steps: you search Google Maps or LinkedIn, the Chrome extension saves the details into your private list, the platform cleans and de-duplicates them, you send email and WhatsApp campaigns from your own accounts, and replies and opt-outs come back into the panel.",
    image: img("01-website-home", "The public website: what the platform does, pricing and contact"),
    steps: [
      "Find: search Google Maps (businesses) or LinkedIn (people) yourself — or paste your own list in Quick Send.",
      "Save: the Chrome extension saves what the page shows into your account.",
      "Organise: duplicates are skipped; filter by city, category, tag or date added; export to CSV/Excel.",
      "Reach: email and WhatsApp campaigns sent from your own Resend/SMTP and Meta WhatsApp accounts.",
      "Follow up: opens, clicks, replies and opt-outs are recorded; the AI Inbox helps you answer chats.",
    ],
    notes: ["Every account is private: you see only your own leads, campaigns and settings."],
  },
  {
    id: "requirements",
    title: "What you need before you start",
    audience: "all",
    table: {
      head: ["You need", "For", "Required?"],
      rows: [
        ["An approved account", "Signing in to the panel and the extensions", "Always"],
        ["Google Chrome on a computer", "The Maps Data Collector and LinkedIn Helper extensions", "To collect leads"],
        ["Your own Resend account (or SMTP mailbox)", "Sending email campaigns", "For email"],
        ["Your own Meta WhatsApp Business (Cloud API) number + approved templates", "Sending WhatsApp campaigns", "For WhatsApp"],
        ["Claude or Gemini API key, Telegram bot", "AI replies in the AI Inbox", "Optional"],
        ["Your Facebook / Instagram / LinkedIn login", "Chats from your pages in the AI Inbox", "Optional"],
      ],
    },
    notes: ["Details for each integration are in “Where each integration is needed” below."],
  },
  {
    id: "pricing",
    title: "Pricing",
    audience: "all",
    image: img("02-website-pricing", "Pricing page"),
    steps: [
      "Your first 1,000 leads are free (Google Maps and LinkedIn together).",
      "After that each new lead costs ₹0.50. Saving a lead you already have is free.",
      "Email and WhatsApp messages are billed by your own provider (Resend, Meta…), not by the platform.",
    ],
  },
  {
    id: "account",
    title: "Create your account and sign in",
    audience: "all",
    image: img("03-register", "Create an account: email, phone, user id and password"),
    steps: [
      "Open the website and click “Get Started Free” (or “Create an account” on the sign-in page).",
      "Enter your email, phone number, a user id (e.g. ravi.shop) and a password of at least 10 characters.",
      "Your account waits for approval by the administrator. You get access once it is approved.",
      "Sign in with your email or your user id and your password.",
    ],
    notes: ["Forgot your password? Ask the administrator to reset it from the Users page."],
  },
  {
    id: "dashboard",
    title: "The dashboard",
    audience: "all",
    pages: ["/"],
    image: img("05-dashboard", "Dashboard after sign-in"),
    intro:
      "After signing in you see your totals: leads, new leads today, duplicates skipped, collections, and the latest leads and collections. The menu on the left shows only the services enabled for your account; it scrolls when it is longer than the screen. The “Guide” button at the top of every page opens the part of this guide for that page.",
  },
  {
    id: "extensions",
    title: "Install the Chrome extensions",
    audience: "all",
    pages: ["/extensions"],
    image: img("06-extensions", "Extensions page with download buttons and the backend URL"),
    steps: [
      "Open Extensions in the menu and click “Download zip” for Maps Data Collector (Google Maps) and/or LinkedIn Helper.",
      "Extract the zip into a folder (right click → Extract All).",
      "In Chrome open chrome://extensions and switch on Developer mode (top right).",
      "Click “Load unpacked” and choose the extracted folder (the one with manifest.json).",
      "Click the extension icon to open its side panel. On the login screen click “Backend: … change”, paste the Backend URL shown on the Extensions page (for example https://lead.the360tech.com), then sign in with your email or user id and password.",
      "To update later: download again, replace the files in the folder and click Reload on the extension in chrome://extensions.",
    ],
  },
  {
    id: "maps",
    title: "Collect Google Maps leads",
    audience: "all",
    pages: ["/leads"],
    image: img("07-maps-leads", "Google Maps Leads list with filters, date filter and export"),
    steps: [
      "Open google.com/maps in Chrome and open the Maps Data Collector side panel.",
      "Type what you want (e.g. “hospitals in Lucknow”) and start a collection. The extension saves the listings that Maps shows: name, category, phone, website, address, rating.",
      "Duplicates are skipped automatically, also across collections.",
      "Google Maps Leads: search, filter by city, state, category and keyword, and use the date filter (Today, Yesterday, Last 7 / 30 days, This month or a custom range). “More filters” adds phone, email, website, rating and reviews.",
      "Select rows or use the filters and click Export CSV / Export XLSX — the export uses the same filters. Selected rows can go straight into an email or WhatsApp campaign.",
    ],
  },
  {
    id: "collections",
    title: "Collections",
    audience: "all",
    pages: ["/collections"],
    image: img("08-collections", "Collections: one row per search"),
    intro: "Every search you run with the extension is a collection. Open one to see which leads it found and its activity log.",
  },
  {
    id: "linkedin",
    title: "LinkedIn leads",
    audience: "all",
    pages: ["/linkedin"],
    image: img("09-linkedin-leads", "LinkedIn Leads with filters, import and export"),
    steps: [
      "With LinkedIn Helper: search on LinkedIn yourself, add the profiles of a results page to your list, open each profile and click “Save & open next” (shortcut Alt+N). The helper reads only what the open profile shows you, including Contact info you are allowed to see.",
      "With a file: LinkedIn → Settings → Data privacy → Get a copy of your data → Connections. Upload Connections.csv with Import CSV.",
      "Filter by company, tag, email, phone, website, source and date added, and export to CSV.",
    ],
    notes: ["Keep a human pace (the helper shows a daily limit); LinkedIn may restrict accounts that open too many profiles."],
  },
  {
    id: "contacts",
    title: "Contacts (Sheets)",
    audience: "all",
    pages: ["/contacts"],
    image: img("19-contacts", "Contacts uploaded from a sheet"),
    steps: [
      "Download the template (CSV or Excel), fill in Name, LinkedIn URL, Contact Number, Email, Designation and Company, and upload it with a list name.",
      "Uploading the same people again updates them instead of adding duplicates.",
      "Search and filter by list, company or designation; delete what you no longer need.",
    ],
  },
  {
    id: "sender",
    title: "Connect your own sender (email and WhatsApp)",
    audience: "all",
    pages: ["/sender"],
    image: img("10-my-sender", "My sender: your own email and WhatsApp accounts"),
    intro: "Campaigns are sent from your own accounts. Open My sender and connect at least one. Keys are stored encrypted and never shown again.",
    steps: [
      "Email with Resend: create an account at resend.com, verify your domain (add the DNS records it shows), create an API key (starts with re_). Enter From (e.g. Your Shop <hello@yourshop.in>) and the API key, then Save.",
      "Resend tracking (optional): in Resend → Webhooks add the endpoint URL shown on My sender and copy its signing secret (starts with whsec_) into “Webhook signing secret”.",
      "Email with SMTP instead: enter host, port (587 or 465), user and password. For Gmail use smtp.gmail.com and an App Password (Google Account → Security → App passwords).",
      "WhatsApp: in Meta for Developers create an app with WhatsApp, add your business phone number, create a permanent System User token, and copy the Phone number ID. Enter both and Save.",
      "WhatsApp replies and opt-outs (optional): in the Meta app → WhatsApp → Configuration set the Callback URL shown on My sender, use the verify token you chose, and subscribe to messages.",
      "Click “Send test email” / “Send hello_world test” to check the connection.",
    ],
  },
  {
    id: "templates",
    title: "Templates (email and WhatsApp)",
    audience: "all",
    pages: ["/templates"],
    image: img("11-templates", "Email templates with variables"),
    intro:
      "Write reusable messages. Variables such as {{name}} and {{city}} are filled from each contact. Every email automatically gets an unsubscribe link. WhatsApp templates must be approved by Meta first; add them under WhatsApp → Templates with the same name, language and category as in Meta.",
    table: {
      head: ["WhatsApp category", "Use it for", "Who may receive it"],
      rows: [
        ["Marketing", "Offers, new products, greetings, newsletters", "Only people who agreed to receive WhatsApp messages from you"],
        ["Utility", "Order / booking updates, payment reminders, account alerts", "Only about something the person already started with you — never promotions"],
      ],
    },
    notes: ["Meta reviews every template and can re-categorise or reject it. Sending marketing messages without consent can get your number blocked."],
  },
  {
    id: "quick-send",
    title: "Quick Send: your own emails and numbers",
    audience: "all",
    pages: ["/quick-send"],
    image: img("18-quick-send", "Quick Send: paste or upload contacts, then send a template"),
    steps: [
      "Open Quick Send and give the list a name (e.g. “Diwali offer – Noida”).",
      "Paste one contact per line — an email, a number, or a name with email/number (“Asha Verma, asha@agency.in, 98100 12345”) — or upload a CSV with Name, Email and Phone/Mobile columns (from Excel: Save as → CSV). Up to 5,000 at a time.",
      "For WhatsApp, tick “These people agreed to receive WhatsApp messages from us”. It is saved as their opt-in; anyone who replied STOP or opted out stays excluded.",
      "Click Save contacts. Rows with a wrong email or number are listed with the reason; contacts you already have are reused, not duplicated.",
      "Click “Send email template” or “Send WhatsApp template”. The campaign form opens with these contacts selected: choose the template (WhatsApp shows Marketing / Utility), pace and daily limit, then Start.",
    ],
    notes: ["Quick Send contacts also appear under Google Maps Leads with category “Quick Send” and the list name as keyword, where you can filter and export them."],
  },
  {
    id: "campaigns",
    title: "Email and WhatsApp campaigns",
    audience: "all",
    pages: ["/email", "/whatsapp"],
    image: img("12-email-campaign", "An email campaign with its pace, window and recipients"),
    steps: [
      "Email → New campaign: choose a template, pick recipients (filters, selected leads or a Quick Send list), set the pace (one message every N minutes), a daily limit and the sending window.",
      "Leads without an email address, opted-out addresses and repeated addresses are left out automatically.",
      "Click “Start sending”. You can pause, resume or stop at any time.",
      "The campaign page shows sent, failed, delivered, opened, clicked, replied and bounced.",
      "WhatsApp campaigns work the same way with an approved template; only contacts with a recorded opt-in receive messages.",
    ],
    notes: ["Start sending is available once your sender for that channel is connected (see “Connect your own sender”)."],
  },
  {
    id: "optouts",
    title: "Opt-outs",
    audience: "all",
    pages: ["/opt-outs"],
    image: img("13-opt-outs", "Opt-out list"),
    intro:
      "Unsubscribes, STOP replies and spam reports are added automatically. You can add addresses yourself (one per line). Campaigns never message an address on this list, even for leads collected or pasted again later.",
  },
  {
    id: "inbox",
    title: "AI Inbox",
    audience: "all",
    pages: ["/inbox"],
    image: img("14-ai-inbox-setup", "AI Inbox → Setup: AI model, API key and Telegram bot"),
    steps: [
      "Setup → choose Claude (Anthropic) or Google Gemini and paste your API key: Claude from console.anthropic.com → API keys (starts with sk-ant-); Gemini from aistudio.google.com → Get API key.",
      "Telegram: open @BotFather in Telegram, send /newbot, and paste the token it gives you.",
      "AI instructions: describe your business, prices, FAQs, tone and topics the AI must leave to you.",
      "Choose per app whether the AI replies on its own, only drafts replies for your approval, or stays off.",
      "Facebook and Instagram chats appear after you connect your accounts (see “Social accounts”).",
    ],
  },
  {
    id: "social",
    title: "Social accounts",
    audience: "all",
    pages: ["/social"],
    image: img("15-social-accounts", "Connect Facebook, Instagram and LinkedIn"),
    intro:
      "Click Connect: Facebook or LinkedIn opens its own login page; you never type your password into this panel. The platform receives an access token, stores it encrypted, and you can disconnect at any time.",
    notes: ["The Connect buttons work once the administrator has set up the platform's Facebook and LinkedIn apps (see the server settings section)."],
  },
  {
    id: "integrations",
    title: "Where each integration is needed",
    audience: "all",
    table: {
      head: ["Integration", "Needed for", "Where to get it", "Where to enter it"],
      rows: [
        ["Chrome (desktop)", "Collecting leads with the extensions", "google.com/chrome", "Extensions page → download → Load unpacked"],
        ["Resend", "Sending email campaigns (recommended)", "resend.com → API keys (verify your domain)", "My sender → Email (Resend)"],
        ["SMTP (Gmail, Zoho…)", "Sending email without Resend", "Your mail provider (Gmail: App password)", "My sender → Email (SMTP)"],
        ["Meta WhatsApp Cloud API", "WhatsApp campaigns and Quick Send, replies, STOP", "developers.facebook.com → app with WhatsApp", "My sender → WhatsApp"],
        ["WhatsApp templates (Marketing / Utility)", "Every WhatsApp campaign", "Meta Business Manager → WhatsApp Manager → Message templates", "WhatsApp → Templates (same name, language, category)"],
        ["Claude or Gemini API key", "AI replies in the AI Inbox", "console.anthropic.com / aistudio.google.com", "AI Inbox → Setup"],
        ["Telegram bot", "Telegram chats in the AI Inbox", "@BotFather in Telegram", "AI Inbox → Setup"],
        ["Facebook / Instagram / LinkedIn", "Page and Instagram chats, LinkedIn profile", "Your own accounts (login via Connect)", "Social Accounts → Connect"],
        ["Meta & LinkedIn developer apps", "Makes the Connect buttons work", "developers.facebook.com, linkedin.com/developers", "Server settings (administrator)"],
      ],
    },
  },
  {
    id: "admin-users",
    title: "Administrators: users and services",
    audience: "admin",
    pages: ["/users"],
    image: img("16-users", "Users: approve sign-ups and choose each customer's services"),
    steps: [
      "New sign-ups appear under “Waiting for approval” (the top bar shows “N new”). Click Approve or Reject.",
      "Services: choose what each customer may use (Google Maps, LinkedIn, contacts, email, WhatsApp, AI Inbox, social). A switched-off service disappears from their menu and its extension download.",
      "Disable an account or reset a password; both sign the user out everywhere.",
      "“View data” or the Data selector at the top shows one customer's data; “All users” shows everything.",
    ],
  },
  {
    id: "admin-contact-leads",
    title: "Administrators: Contact Leads",
    audience: "admin",
    pages: ["/contact-leads"],
    image: img("20-contact-leads", "Contact Leads: messages from the website's Contact us form"),
    steps: [
      "Every message sent with the website's Contact us form appears here with name, email, phone, company and message.",
      "The menu shows how many are new. Filter by New or by date (Today, Last 7 days, custom range…).",
      "Mark a message read once you have answered it, or delete it.",
    ],
  },
  {
    id: "admin-website",
    title: "Administrators: website and server settings",
    audience: "admin",
    pages: ["/website", "/settings"],
    image: img("17-website-settings", "Website: brand, contact details and social links"),
    steps: [
      "Website page: edit the brand name, tagline, contact email, phone, WhatsApp, address and the “Follow us” links (LinkedIn, YouTube, X) shown on the public pages.",
      "Server settings (Render → service → Environment): DATABASE_URL, SESSION_SECRET, ADMIN_EMAIL/ADMIN_PASSWORD (first start only), PUBLIC_BASE_URL = your domain (e.g. https://lead.the360tech.com).",
      "Social Connect: META_APP_ID and META_APP_SECRET (Meta app with Facebook Login), LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET. Add the redirect URLs <your domain>/api/oauth/callback/meta and …/linkedin in those apps.",
      "Optional platform defaults used by super admins: EMAIL_PROVIDER with RESEND_API_KEY or SMTP_*, WHATSAPP_PROVIDER=meta with META_WA_*, ANTHROPIC_API_KEY. Customers always use their own keys.",
      "The public website (/, /features, /pricing, /about, /contact, /privacy, /terms) and sitemap.xml are ready for Google; submit https://<your domain>/sitemap.xml in Google Search Console.",
    ],
  },
  {
    id: "admin-system",
    title: "Administrators: system, dependencies and updating this guide",
    audience: "admin",
    table: {
      head: ["Part", "What it is", "Notes"],
      rows: [
        ["Hosting", "Render web service (Docker), branch feature/linkedin-outreach", "Pushing code does not deploy by itself: trigger a deploy on Render after each push."],
        ["Database", "Render PostgreSQL (free plan)", "The free database expires on 30 Nov 2026 — upgrade the plan or move the data before then. Migrations run on every start."],
        ["Domain", "lead.the360tech.com → Render", "PUBLIC_BASE_URL must match it (links in emails, webhooks, sitemap)."],
        ["Backend", "Node.js 24, Fastify, Prisma (SQLite locally, PostgreSQL on Render)", "Secrets entered by users are stored encrypted (SESSION_SECRET must stay the same)."],
        ["Admin panel", "React + Vite, served at /admin", "Built inside the Docker image."],
        ["Chrome extensions", "Maps Data Collector, LinkedIn Helper (zips on the Extensions page)", "Users load them unpacked in Chrome."],
        ["Email / WhatsApp / AI", "Each customer's own Resend/SMTP, Meta WhatsApp, Claude/Gemini keys", "The platform's own .env keys are only a fallback for super admins."],
        ["This guide", "admin/src/guide/content.ts + screenshots and PDFs in admin/public/guide", "After adding a feature: add its section (with `pages`), then run `npm run guide:build` to retake screenshots and PDFs."],
      ],
    },
  },
  {
    id: "admin-roadmap",
    title: "Administrators: remaining work",
    audience: "admin",
    table: {
      head: ["Item", "Status", "What is needed"],
      rows: [
        ["Lead credits: 1,000 free, then ₹0.50 per new lead, saving blocked at zero balance", "Not built yet — the website shows the price but it is not enforced", "Build the balance, per-lead charge and block (duplicates stay free)."],
        ["Manual credit by the super admin, with a ledger", "Not built yet", "Credit / debit screen per user and a history of every change."],
        ["Online recharge with Razorpay", "Not built yet", "Razorpay test keys first, then live keys — entered in Render environment variables, never in chat."],
        ["Per-user API tokens and integrations (phase D)", "Pending", "Each customer manages their own tokens and webhooks; final security review."],
        ["Database plan", "Free until 30 Nov 2026", "Upgrade or migrate before it expires."],
      ],
    },
  },
  {
    id: "help",
    title: "Troubleshooting",
    audience: "all",
    table: {
      head: ["Problem", "What to do"],
      rows: [
        ["“Your account is waiting for approval”", "The administrator has not approved it yet. Contact them."],
        ["The page still looks old after an update", "Reload with Ctrl+F5 to load the new version."],
        ["Extension says it cannot reach the backend", "Check the Backend URL on the extension's login screen (copy it from the Extensions page) and allow the permission Chrome asks for."],
        ["“This service is not enabled for your account”", "Ask the administrator to switch the service on for you."],
        ["Start sending is greyed out", "Connect your sender on My sender and send a test."],
        ["WhatsApp campaign says 0 recipients", "Contacts need a recorded opt-in (tick the consent box in Quick Send) and an approved template."],
        ["Campaign paused with a setup message", "Open the campaign; fix the reason shown (sender, template approval) and resume."],
      ],
    },
  },
];

/** Menu pages that intentionally have no guide section (super-admin tools outside the customer flow). */
export const PAGES_WITHOUT_GUIDE = ["/social-leads", "/linkedin-outreach", "/instagram-outreach", "/campaign-logs", "/integrations"];

/** The guide section that explains a menu page (by its top-level path). */
export function guideSectionFor(path: string): GuideSection | undefined {
  const top = `/${path.split("/")[1] ?? ""}`;
  return GUIDE.find((s) => s.pages?.includes(top));
}

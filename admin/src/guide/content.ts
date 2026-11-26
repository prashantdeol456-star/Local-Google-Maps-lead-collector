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
        ["Lead credit (after your 1,000 free leads)", "Saving new Google Maps / LinkedIn leads — ₹0.50 each, recharge on Billing", "After 1,000 leads"],
        ["Google Chrome on a computer", "The Chrome extensions (Maps Data Collector, LinkedIn Helper, LinkedIn Messenger, Meta Helper, Contact Finder)", "To collect leads and send LinkedIn / Instagram messages"],
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
      "After that each new lead costs ₹0.50 from your balance. Saving a lead you already have is free, and so are Quick Send contacts.",
      "Recharge any time on the Billing page (UPI, card, netbanking through Razorpay).",
      "Email and WhatsApp messages are billed by your own provider (Resend, Meta…), not by the platform.",
    ],
  },
  {
    id: "billing",
    title: "Billing: free leads, balance and recharge",
    audience: "all",
    pages: ["/billing"],
    image: img("21-billing", "Billing: free leads left, balance, recharge and history"),
    steps: [
      "The top bar always shows how many free leads and how many leads in total you can still save; click it to open Billing.",
      "Billing shows free leads left (of 1,000), your balance, how many new leads it pays for, and your total recharges.",
      "Recharge: pick ₹100 / ₹500 / ₹1,000 / ₹2,000 or type an amount (₹100 to ₹1,00,000), click Pay and finish in the Razorpay window with UPI, card or netbanking. The balance updates as soon as Razorpay confirms the payment.",
      "Balance history lists every recharge, every credit the administrator added or removed, and every paid lead.",
      "When free leads and balance are both used up, new leads are not saved. The Maps extension keeps them waiting and sends them by itself after you recharge; LinkedIn Helper shows the message and you save the profile again.",
    ],
    notes: ["“Test mode — no real money” on the Recharge card means the administrator is still testing Razorpay."],
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
      "After signing in you see your totals: leads, new leads today, duplicates skipped, collections, and the latest leads and collections. The menu on the left is grouped by what you want to do — Start, Find leads, Send messages, Chats and My account (super admins also see Administration). It shows only the services enabled for your account and scrolls when it is longer than the screen. The “Guide” button at the top of every page opens the part of this guide for that page.",
  },
  {
    id: "extensions",
    title: "Install the Chrome extensions",
    audience: "all",
    pages: ["/extensions"],
    image: img("06-extensions", "Extensions page with download buttons and the backend URL"),
    steps: [
      "Open Extensions in the menu and click “Download zip” for the ones you need: Maps Data Collector (Google Maps and Justdial leads), LinkedIn Helper (save LinkedIn profiles), LinkedIn Messenger (send LinkedIn Outreach campaigns) Meta Helper (Instagram and Facebook search, Instagram Outreach) and Contact Finder (emails and phones on the websites and LinkedIn profiles you open). You only see the ones for the services your account has.",
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
      "Open the Maps Data Collector side panel (click the extension icon in Chrome).",
      "Type what you want (e.g. “hospitals”) and the location (e.g. “Lucknow”). Several keywords separated by commas (“hospitals, clinics, labs”) are run one after another.",
      "Press START. With the Hands-off options on (they are on by default) the extension opens the search in a new tab behind your current one, reads the whole list without opening each listing (name, category, phone, website, address, rating), scrolls to the end by itself and then starts the next keyword. You can keep using Chrome; just leave that tab open.",
      "You get a Chrome notification when all searches are done, or if Google shows a security check (CAPTCHA). Only you can complete a security check: click the notification, finish it in the Maps tab and press RESUME.",
      "Turn off “Fast” only if a search comes back with empty fields: the extension then opens every listing, which is slower. Google Maps shows at most about 120 results per search, so use more specific keywords or areas (e.g. “hospitals in Gomti Nagar”) to get more.",
      "Duplicates are skipped automatically, also across collections.",
      "Google Maps Leads: search, filter by city, state, category and keyword, and use the date filter (Today, Yesterday, Last 7 / 30 days, This month or a custom range). “More filters” adds phone, email, website, rating and reviews.",
      "Select rows or use the filters and click Export CSV / Export XLSX — the export uses the same filters. Selected rows can go straight into an email or WhatsApp campaign.",
    ],
  },
  {
    id: "justdial",
    title: "Collect Justdial leads",
    audience: "all",
    pages: ["/justdial"],
    image: img("24-justdial-leads", "Justdial Leads: Justdial details with the same business's Google Maps rating, phone and website"),
    steps: [
      "Open the Maps Data Collector side panel and choose “Justdial” under Collect from.",
      "Type the keyword (e.g. “Study Visa Consultants”) and the city (e.g. “Delhi”); several keywords separated by commas run one after another. Press START.",
      "The extension opens Justdial in its own tab and scrolls down the list by itself, the way you would: Justdial loads 10 more businesses each time, until your “Max records” (e.g. 200) are read or the list ends; then it opens Justdial's next page if there is one. Keep that tab open (you can work in other tabs). The “Justdial speed” slider (Slow ↔ Fast) sets the pace, even while a job runs: Slow waits for each new set of businesses to load and pauses before scrolling on; faster saves time but Justdial may show a security check sooner. If Justdial stops giving more businesses before your “Max records” (the list ended, or it stopped loading), the log says how many were found and the job goes on to the business pages with those; a business page that does not load is saved with the list details and the job continues. Then it opens each business page: name, categories, area, address, website, year established, timings, Justdial rating and photo links (photos stay on Justdial).",
      "Numbers and emails: the number Justdial shows on the list card (the green call button) or on the business page is saved, and so is a WhatsApp number Justdial lists. An email is saved when the business page shows one (most show only an enquiry form, which is never used). The phone from Google Maps comes first when found, because Justdial's numbers are often call-forwarding numbers.",
      "“Add phone and website from Google Maps” looks the same business up on Google Maps in a second background tab. Only a clear match (same name, close by) is used, so no business gets someone else's number.",
      "“Show Number” is off by default. Turned on, it is pressed only for businesses without a phone, at most 30 times a day; Justdial may share your number with the business or ask you to log in, and then the job stops pressing it.",
      "After the search, the platform looks for a public email on each business's own website. If you chose an email template under “Email campaign for new leads”, the new leads with an email go into an email campaign that starts by itself (your sender, with an unsubscribe link). The extension never fills in Justdial's enquiry forms.",
      "Justdial Leads shows everything in one row per business, with filters (phone, email, website, found on Google Maps), Export CSV and Email / WhatsApp campaign for selected rows.",
      "Justdial does not allow automated collection, so use it at your own risk and at a calm pace. If Justdial shows a security check or blocks the page, the job pauses and you get a notification: open the tab, deal with it yourself, then press RESUME.",
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
    id: "contact-finder",
    title: "Contact Finder: emails and phones on any website or LinkedIn profile",
    audience: "all",
    intro:
      "A separate Chrome extension (Extensions page → Contact Finder). Open a company website or a LinkedIn profile and it shows the emails and phone numbers that page displays, with where each came from, and keeps them in your browser. Nothing is sent anywhere until you press “Send to Lead Platform”.",
    steps: [
      "Install it like the other extensions and click its icon: the side panel opens with three tabs, This page, Saved and Settings. The icon shows how many emails and phones the open page has.",
      "Websites: emails and phones written on the page, in email/phone links and WhatsApp links are read, also spellings like “info [at] shop [dot] com”. If the page has no email, its Contact/About pages (up to 4, same site, once a day) are read too, or press “Check Contact/About pages”.",
      "LinkedIn profiles: name, headline, company and location, plus the email and phone in “Contact info”, which LinkedIn shows only when the person shares them with you (often your 1st-degree connections). Press “Open Contact info” in the panel to read it. Nothing is guessed and no personal number is looked up elsewhere.",
      "Settings: “Save what a page shows by itself” (on), “Read every website I open” (Chrome asks once; otherwise allow one site at a time from the panel), the Contact/About pages option, and sites never to read.",
      "Saved: search, Export CSV (Excel), delete, and “Send to Lead Platform”, which adds the chosen ones to Contacts (Contacts (Sheets)) under a list name, after you log in under Settings with your admin panel login.",
      "Email finder (needs your Hunter key, see “Email finder”): on a LinkedIn profile press “Find work email” (name, company and profile; 1 credit only if an email is found); on a website or LinkedIn company page press “Emails at this website” (1 credit per email Hunter knows there, at most 5). “Check” next to an email asks Hunter whether it works (0.5 credit). Hunter's emails are saved with their confidence and marked “Hunter”.",
    ],
    notes: ["LinkedIn does not allow tools that collect data from its site. Contact Finder only reads the profile you open yourself and what LinkedIn shows you, and never opens other profiles; use it at your own risk."],
  },
  {
    id: "email-finder",
    title: "Email finder (Hunter)",
    audience: "all",
    pages: ["/email-finder"],
    image: img("29-email-finder-bulk", "Email finder → Bulk: a sheet's rows with the emails and phones found and where"),
    intro:
      "Finds a person's work email from their name and company, or the emails at a company's website, with your own free Hunter account (50 credits a month). Contact Finder uses it from LinkedIn profiles and websites; you can also try it on this page.",
    steps: [
      "Tabs: “Hunter key and credits”, “Bulk (sheet)” and “Apollo people search” (next section). Make a free account on hunter.io, open API → API keys, copy the key, paste it here and press “Save and check”. The key is kept encrypted on the server and is never put in the extension.",
      "Credits: finding an email costs 1 credit only when one is found; checking an email 0.5; emails at a website 1 per email found (at most 5 per search). The same search again within 30 days is answered from your earlier result for free.",
      "Before every lookup the platform asks Hunter how many credits are left and keeps 10 % as a safety margin, so nothing is ever spent beyond your free credits and nothing paid is used. When they run out, lookups wait until Hunter renews them (the date is shown).",
      "Recent lookups lists each search with its result and the credits it used. A lookup that did not answer in time keeps its credit “held” until the month's numbers settle.",
      "Bulk (sheet): upload an Excel or CSV sheet (up to 2,000 rows) with a Website column, and Name, Company, LinkedIn URL, Designation if you have them (“Download a sample sheet”). Each row's website and up to 3 of its Contact/About pages are read for the emails and phones they show (free). Tick “ask Hunter” and set a credit limit to also get work emails for named people whose website shows none.",
      "The sheet is worked through in the background, one row at a time; you can pause, resume or stop it. Each row shows what was found and where (website, contact page, Hunter, or already in the sheet). Export CSV downloads the results; “Add the found ones to Contacts” puts the rows with an email or phone into Contacts under a list name, ready for a campaign.",
    ],
    notes: ["Hunter's emails are its best guess with a confidence score: check them before writing. Personal mobile numbers are never looked up."],
  },
  {
    id: "snov",
    title: "Snov.io: the second email finder",
    audience: "all",
    image: img("32-email-finder-snov", "Email finder: the Hunter key and Snov.io as the second email finder, with its credits"),
    intro:
      "When Hunter cannot answer (no Hunter key, the key is switched off, or its free credits are used up), the platform asks Snov.io instead, with your own Snov.io account. It works for a person's name plus their company's website: in Contact Finder, in “Try it” and in Bulk.",
    steps: [
      "In Snov.io open Settings → API and copy the User ID and the Secret. Free Snov.io plans get API access only after asking Snov for it (a short demo call); paid plans have it already.",
      "Email finder → Hunter key and credits → Snov.io card: paste both and press “Save and check”. They are kept encrypted on the server. The card shows the credits left and how many are kept back.",
      "Nothing else to do: a lookup goes to Hunter first and to Snov.io when Hunter cannot answer. The answer says which one found the email; in Bulk the source column shows “Snov.io”.",
      "Each email Snov.io returns costs 1 Snov.io credit. The credits are read first and 10 % are kept back, so nothing beyond your credits is ever used; the same person within 30 days is answered again for free.",
    ],
  },
  {
    id: "apollo-search",
    title: "Apollo people search (decision-makers by job title)",
    audience: "all",
    image: img("31-apollo-search", "Email finder → Apollo people search: HR managers at Noida companies, two with their work emails"),
    intro:
      "Finds people by job title, seniority, location and company in Apollo.io's database with your own free Apollo account, for example HR managers or purchase heads in Noida, or the founders of IT companies abroad. Searching is free; you then pick the people you want and get their work emails, 1 Apollo credit each, only within your credits.",
    steps: [
      "Make a free account on apollo.io with your work email (Apollo does not give free API access to Gmail/Yahoo accounts). Then Settings → Integrations → API → Create new key, tick People API Search, People Enrichment and View Credit Usage Stats (or “Set as master key”), copy the key.",
      "Email finder → Apollo people search: paste the key and press “Save and check”. It is kept encrypted on the server. The cards show the email credits of your Apollo plan this month, what is used, and the 10 % kept back as a safety margin.",
      "Find people (free): job titles (comma-separated), a location (where the company's office is, or where the person lives), seniority, company size, company websites or keywords. Apollo shows first names and hides part of the last name until you get the person's details.",
      "Tick the people you want and press “Get emails for N selected”. Each costs 1 Apollo credit when Apollo returns the person (nothing when it has nobody). The platform checks your credits first and stops before going over them; a person you already got in the last 30 days is shown again for free.",
      "Type a list name and press “Add … revealed to Contacts” to put them in Contacts (name, email, job title, company, LinkedIn), ready for an email campaign.",
    ],
    notes: ["Only work emails are fetched. Personal emails and mobile numbers are never asked for (they cost much more and are personal data)."],
  },
  {
    id: "marketplace",
    title: "Marketplace leads (IndiaMART, TradeIndia, other portals)",
    audience: "all",
    pages: ["/marketplace"],
    image: img("30-marketplace-leads", "Marketplace leads: connected portals and the buyer enquiries they sent, with the WhatsApp reply"),
    intro:
      "Brings the buyer enquiries from your own seller account on IndiaMART, TradeIndia or another B2B portal into the platform every 5 minutes, saves each buyer to Contacts and can send them an approved WhatsApp template from your own number straight away. It reads only your own enquiries with the API key the portal gives its paying sellers; portal directories are never scraped.",
    steps: [
      "Under “Connect a portal” (later: “+ Connect another portal”) pick the portal. IndiaMART: log in as a seller → Lead Manager → Import/Export Leads (or Settings) → Pull API, generate the CRM key and paste it here. TradeIndia: My Dashboard → Inquiries & Contacts → My Inquiry API, copy the User ID, Profile ID and Key. Other portal (ExportersIndia, …): paste the full https enquiry API link from its member panel and give it a name.",
      "Choose an approved WhatsApp template for the automatic reply, or leave “No automatic WhatsApp reply”. The reply goes from your number on My sender; the chat then shows in All messages / WhatsApp Chat. Buyers on portals usually take the seller who answers first.",
      "Press “Save and start checking”. The portal is checked every 5 minutes (IndiaMART allows no more), and “⟳ Check now” checks at once if the last check was 5 or more minutes ago. Keys are kept encrypted on the server.",
      "Each new enquiry is saved once: buyer, company, city, mobile, email, product and message (click a row to read the message). Buyers go to Contacts under the portal's name; someone already in Contacts with the same mobile is reused.",
      "A wrong key or a portal problem shows on the portal card in red. Pause stops the checks, Resume starts them again, Remove deletes the portal (the enquiries stay). Export CSV downloads the enquiries.",
    ],
    notes: ["Needs a paid seller account on the portal (that is where the API key comes from). Use “Find leads” pages for directories like Google Maps and Justdial."],
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
    id: "all-messages",
    title: "All messages",
    audience: "all",
    pages: ["/messages"],
    image: img("27-all-messages", "All messages: WhatsApp, Facebook, Instagram, Telegram and LinkedIn chats in one list"),
    intro:
      "One list of every chat on every app you connected: WhatsApp (your own number), Facebook Page Messenger, Instagram DMs, your Telegram bot and LinkedIn. The newest chat is on top, with the app, an unread count and how long you may still reply.",
    steps: [
      "Connect the apps once: WhatsApp on My sender; Telegram, Facebook, Instagram and LinkedIn under AI Inbox → Setup and Social Accounts.",
      "Use the app tabs (All, WhatsApp, Facebook…) to see one app, and Unread or Needs reply to see what waits for you. Search finds a name, number or username.",
      "Click a chat to open it on the right. WhatsApp chats open with everything WhatsApp Chat has (files, voice notes, reactions, templates); the other apps open with their AI Inbox chat (AI draft, Send, Mark as done).",
      "The small label shows the reply window: WhatsApp, Facebook and Instagram allow a free reply for 24 hours after the person's last message (“5 h left”). After that WhatsApp needs an approved template, and Facebook/Instagram need a reply in their own app.",
      "🔔 Notifications on: a sound and a browser notification when a new message arrives on any app. + New WhatsApp chat starts a chat with an approved template.",
      "Photos, videos, voice notes and files show inside the chats of every app. Facebook and Instagram messages arrive within seconds once the Meta webhook is set up (Social Engagement → Real-time setup, fields “messages”); otherwise they are checked every minute.",
      "Your own Telegram number: with Telegram Business (AI Inbox → Setup explains the steps) the chats customers have with your personal Telegram account appear here too, marked “your Telegram”; replies from here go out as you, within 24 hours of their last message.",
      "One person, every app: the bar above an open chat (👤) shows the Contacts record it belongs to. A WhatsApp chat links by itself to the contact with the same phone, an Instagram chat to the contact with the same Instagram link, a LinkedIn chat to the same LinkedIn profile. Otherwise pick a suggested contact, find one, or press “+ New contact” (added to Contacts, list “Chats”). The bar then shows the same person's chats on other apps; “Show all their chats in the list” filters the list to them.",
      "Labels and notes: in the same bar, add labels (e.g. Hot, Follow up) and private notes to Facebook, Instagram, Telegram and LinkedIn chats; WhatsApp chats keep theirs in Contact info. The label filter above the list works for every app.",
    ],
    notes: ["Settings stay where they were: WhatsApp Chat ⚙ (greeting, away message, quick replies, business profile) and AI Inbox (AI instructions, keys, Telegram bot)."],
  },
  {
    id: "whatsapp-chat",
    title: "WhatsApp Chat",
    audience: "all",
    pages: ["/whatsapp-chat"],
    image: img("25-whatsapp-chat", "WhatsApp Chat: chats on the left, the open chat with ticks and the 24-hour reply window on the right"),
    steps: [
      "Connect your own WhatsApp number on My sender (Meta WhatsApp Cloud API: Phone Number ID, permanent access token, App Secret and Verify Token). Copy the webhook URL shown there into Meta App Dashboard → WhatsApp → Configuration, and subscribe to the “messages” field.",
      "Every message people send to that number appears in WhatsApp Chat by itself, newest chat on top, with an unread count. Photos, documents and voice notes are saved here (up to 5 MB each), because WhatsApp's own links expire.",
      "Open a chat to read it: the person gets blue ticks. Your messages show ✓ sent, ✓✓ delivered and blue ✓✓ read, or ⚠ with the reason if WhatsApp did not deliver it.",
      "For 24 hours after the person's last message you can reply freely: type, attach a photo or file (📎), and press Send. After 24 hours, and for a new chat (+ New chat), WhatsApp allows only an approved template; when they reply, free chat opens again.",
      "The AI writes a draft of the next reply for every new message, using your business information from AI Inbox → Setup. Press “Use this”, change it if needed, and Send. Nothing is sent without you.",
      "Templates: add them on the Templates page with the exact name from WhatsApp Manager and mark them Approved once Meta approves them.",
      "Like the WhatsApp app: hover a message to Reply (quoted), React with an emoji, Star, Forward to other chats, Copy or Delete for me. Incoming replies, reactions, edits, deleted messages, locations, contact cards and button choices show as they do on the phone.",
      "The composer also sends a voice note (🎤, recorded in the browser), your location or any place, a contact card, up to 3 reply buttons, a list of options, a link button or a location request, and quick replies: type “/” and the shortcut.",
      "The ⋮ menu: contact info (your name for the contact, labels, notes), pin, archive, mute, mark as unread, starred messages and block. Search finds a name or number; the filters show unread, starred and archived chats, or one label.",
      "⚙ Settings: notifications (sound and browser notification), a greeting message for new chats, an away message outside your working hours, quick replies, and your WhatsApp business profile (about, description, address, email, website).",
    ],
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
    image: img("15-social-accounts", "Connect Facebook, Instagram, LinkedIn and YouTube"),
    intro:
      "Click Connect: Facebook, LinkedIn or Google opens its own login page; you never type your password into this panel. The platform receives an access token, stores it encrypted, and you can disconnect at any time.",
    steps: [
      "Facebook & Instagram: one login connects every Page you manage and the Instagram Business/Creator account linked to each.",
      "YouTube: “Connect with Google”, pick the Google account (or brand account) that owns the channel and allow access. Its comments and subscribers then come to Social Engagement.",
    ],
    notes: ["The Connect buttons work once the administrator has set up the platform's Facebook, LinkedIn and Google apps (Integrations page)."],
  },
  {
    id: "social-engagement",
    title: "Social Engagement",
    audience: "all",
    pages: ["/engagement"],
    image: img("26-social-engagement", "Social Engagement: who commented, liked and shared your Facebook and Instagram posts"),
    intro:
      "Everyone who comments, likes or shares your own Facebook Page and Instagram posts, and who comments on or subscribes to your YouTube channel, is saved here by itself, with their name (or username / channel), their ID and what they did. Comments that ask about price, fees, details or say DM are marked “Looks like a lead”.",
    steps: [
      "Connect your Facebook Page under Social Accounts (the Instagram Business or Creator account linked to the Page comes with it). If you connected before this feature, press Connect again once and allow all permissions.",
      "YouTube: connect your channel under Social Accounts (Connect with Google). It is checked every 15 minutes (YouTube has no live updates): the newest videos with their like and comment counts, every comment and reply with the channel that wrote it, and new subscribers whose subscriptions are public (“▶ Subscribed”). Reply to a YouTube comment here as your channel. Who liked a video is not shown by YouTube, only the count.",
      "Open Social Engagement and press “Sync now” on an account: your latest 50 posts and who engaged with them are read. After that it checks every 15 minutes by itself, and new comments arrive within seconds once real-time is on.",
      "Activity: the live feed of comments, likes/reactions and shares. Filter “Looks like a lead” or “Comments not answered”, and press Reply to answer a comment as your Page or Instagram account.",
      "“Message privately” sends the person who commented one private message (Messenger for a Page comment, Instagram Direct for an Instagram comment). Meta allows one per comment, within 7 days; when they answer, the chat continues in All messages.",
      "People: one row per person with how many times they commented, liked and shared, their last comment, status (New, Lead, Customer, Ignore) and your notes. Export CSV downloads the list; Instagram people can be added to Contacts for Instagram Outreach.",
      "Posts: each post with its counts; “Who engaged” lists the people who commented, reacted and shared on it.",
    ],
    notes: [
      "What the platforms allow: Facebook gives the name of everyone who comments or reacts, and shares only when the share is public. Instagram gives who commented, but likes and shares only as numbers. YouTube and LinkedIn come next.",
      "Only your own Pages and accounts are read, and only what Meta's API gives. “Forget” deletes a person and everything saved about them (for privacy requests).",
    ],
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
        ["Meta & LinkedIn developer apps", "Makes the Connect buttons work", "developers.facebook.com, linkedin.com/developers", "Integrations page (administrator)"],
        ["Razorpay", "Online recharge of lead credit", "razorpay.com → API Keys and Webhooks", "Integrations page (administrator)"],
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
    id: "admin-payments",
    title: "Administrators: payments and customer credit",
    audience: "admin",
    pages: ["/payments"],
    image: img("22-payments", "Payments: money received, customer balances and the ledger"),
    steps: [
      "Payments received: totals for today, this month and all time, and every Razorpay payment with customer, amount, status (Paid / Not completed / Failed), method and Razorpay ids. Filter by status and date.",
      "Customer balances: each customer's free leads used, balance, leads left and total paid online. “± Credit” adds or removes money by hand (e.g. paid by bank transfer, bonus, correction) — a reason is required and kept in the ledger.",
      "Ledger: every balance change of every customer (recharges, manual changes, paid leads), filtered by type, date or one customer.",
      "A payment is credited only once, and only after its Razorpay signature is checked — from the customer's browser or from the Razorpay webhook, whichever comes first.",
    ],
  },
  {
    id: "admin-platform-integrations",
    title: "Administrators: Integrations page (Razorpay, Facebook, LinkedIn, Google)",
    audience: "admin",
    pages: ["/platform"],
    image: img("23-platform-integrations", "Integrations: Razorpay, Meta and LinkedIn apps, and where everything else is set up"),
    steps: [
      "Razorpay: in razorpay.com switch on Test mode → Account & Settings → API Keys → Generate Key; paste the Key ID (rzp_test_…) and Key Secret. Under Webhooks add the Webhook URL shown on the page with events payment.captured and payment.failed and a secret; enter the same secret. Save and click Test connection.",
      "Going live: after Razorpay approves your KYC, generate live keys (rzp_live_…), add the webhook in live mode and save the live values — the page then shows “Live — real payments”.",
      "Facebook & Instagram (Meta app) and LinkedIn app: create the apps, paste the Redirect URL shown on the page into them, and enter App ID / Secret or Client ID / Secret. Customers' Connect buttons work immediately.",
      "Google app (YouTube): in console.cloud.google.com create a project, enable “YouTube Data API v3”, set up the OAuth consent screen with the scope youtube.force-ssl, then Credentials → OAuth client ID (Web application) with the Redirect URL shown on the page. Paste the Client ID and Client secret. Until Google verifies the app, only test users you add on the consent screen can connect their channel. The API allows 10,000 units a day (one channel check costs about 5, a reply 50).",
      "Keys are stored encrypted, never shown again (leave a secret empty to keep it) and replace the same values in Render. “Remove keys” goes back to the Render values, if any.",
      "The “Other integrations” table links to everything set up elsewhere: customers' senders, AI Inbox, Webhooks & n8n, Website, Extensions and Render.",
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
      "Social Connect and Razorpay keys are entered on the Integrations page (no Render change needed). Render variables META_APP_ID/SECRET, LINKEDIN_CLIENT_ID/SECRET and RAZORPAY_KEY_ID/KEY_SECRET/WEBHOOK_SECRET still work as a fallback.",
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
        ["Chrome extensions", "Maps Data Collector, LinkedIn Helper, LinkedIn Messenger, Meta Helper (zips on the Extensions page, built on every deploy)", "Users load them unpacked in Chrome."],
        ["Email / WhatsApp / AI", "Each customer's own Resend/SMTP, Meta WhatsApp, Claude/Gemini keys", "The platform's own .env keys are only a fallback for super admins."],
        ["Payments", "Razorpay (orders, Checkout, webhook) + credit ledger", "Keys on the Integrations page; webhook /api/webhooks/razorpay; ₹0.50 per new lead after 1,000 free."],
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
        ["Lead credits (1,000 free, then ₹0.50 per new lead, blocked at zero)", "Done", "—"],
        ["Manual credit / debit with a ledger; Payments page", "Done", "—"],
        ["Online recharge with Razorpay", "Built — waiting for keys", "Enter Razorpay test keys on the Integrations page and test a recharge; after KYC switch to live keys."],
        ["Justdial collection (Maps extension v0.3.0, Justdial Leads page, website emails, automatic email campaign)", "Done", "Customers re-download the Maps extension."],
        ["Social Engagement phase 1: Facebook Page and Instagram comments, reactions, shares", "Built — needs Meta setup", "Meta app: Page webhooks (feed) and Instagram webhooks (comments) with the callback URL and verify token shown on the Social Engagement page; App Review for pages_read_user_content, pages_manage_engagement and instagram_manage_comments so customer accounts work."],
        ["All messages phase 1: one list of WhatsApp, Facebook, Instagram, Telegram and LinkedIn chats", "Done", "—"],
        ["Contact Finder phases 1–2: extension (emails and phones on websites and LinkedIn) and Hunter email finder with a credit guard", "Done", "Each customer adds a free Hunter key on the Email finder page."],
        ["Contact Finder phase 3: upload a sheet of companies/people and fill in emails and phones (websites first, Hunter within a budget)", "Done", "—"],
        ["All messages phase 2: Meta webhooks for Messenger/Instagram, photos and voice, private reply to comments, Telegram Business (your own Telegram number)", "Done", "Meta: Page webhook field “messages” and Instagram “messages”, App Review for pages_messaging and instagram_manage_messages. Telegram: Business Mode on the bot."],
        ["All messages phase 3: one contact across apps, labels and notes on every chat", "Done", "—"],
        ["B2B phase 1: Marketplace leads from IndiaMART, TradeIndia and other portals' enquiry APIs, with an automatic WhatsApp reply", "Done", "Each customer pastes their own seller API key on Marketplace leads."],
        ["B2B phase 2: Apollo people search (title, company, city) with work emails within the credits", "Done", "Each customer adds a free Apollo API key (work-email account) on Email finder → Apollo people search."],
        ["B2B phase 3: Snov.io as the second email finder when Hunter cannot answer", "Done", "Each customer adds Snov.io API credentials (free plans must ask Snov for API access)."],
        ["Team accounts: several people under one customer, chats assigned to a team member", "Not started", "Needs team members (sub-users) with their own logins first."],
        ["WhatsApp Coexistence: same number in the WhatsApp Business app and the API, 6 months of chat history", "Waiting", "Meta Tech Provider status (Embedded Signup) for the platform."],
        ["Social Engagement phase 2: YouTube comments and subscribers", "Built — needs Google setup", "Google Cloud project with the YouTube Data API, OAuth consent screen (youtube.force-ssl) and Google verification for customers' channels; keys on the Integrations page."],
        ["Social Engagement phase 3: LinkedIn company page comments, reactions, reposts", "Agreed", "LinkedIn Community Management API approval."],
        ["Customers re-download the Maps extension (v0.2.0)", "Recommended", "Fast hands-off collecting: reads the list without opening listings, runs in a background tab, starts the next keyword by itself, notifies when done. Also keeps leads waiting when credit runs out."],
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
        ["“Your free leads are used up and your balance is below ₹0.50”", "Recharge on the Billing page (or ask the administrator to add credit). Leads you already have are still saved free."],
        ["Recharge card says online recharge is not set up", "The administrator has not entered the Razorpay keys yet (Integrations page)."],
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

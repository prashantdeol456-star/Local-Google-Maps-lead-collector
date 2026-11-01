// Public website pages, rendered on the server as plain HTML (no JavaScript): fast to load and
// fully readable by search engines. Texts that change per installation (brand, contact details)
// come from SiteSettings and are always escaped. The CSP allows no inline styles: classes only.

export interface SiteInfo {
  brandName: string;
  tagline: string;
  contactEmail: string;
  contactPhone: string;
  whatsapp: string;
  address: string;
  linkedinUrl: string;
  youtubeUrl: string;
  xUrl: string;
  /** Public https address of the site, without a trailing slash (null: relative links only) */
  baseUrl: string | null;
}

export const PRICE_PER_LEAD_INR = 0.5;
export const FREE_LEADS = 1000;

export function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** JSON inside <script type="application/ld+json">: "</" must not close the tag. */
const ld = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");

const FREE = FREE_LEADS.toLocaleString("en-IN");
const PRICE = `₹${PRICE_PER_LEAD_INR.toFixed(2)}`;

export const SITE_PAGES = [
  { path: "/", label: "Home" },
  { path: "/features", label: "Features" },
  { path: "/pricing", label: "Pricing" },
  { path: "/about", label: "About us" },
  { path: "/contact", label: "Contact" },
  { path: "/privacy", label: "Privacy" },
  { path: "/terms", label: "Terms" },
] as const;

interface PageOptions {
  path: string;
  title: string;
  description: string;
  body: string;
  structuredData?: unknown[];
}

// Line icons (stroke = currentColor) and a few brand marks.
const svg = (d: string, cls = "i") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON = {
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
  layers: svg('<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12.5 9 5 9-5"/><path d="m3 16.5 9 5 9-5"/>'),
  send: svg('<path d="M21 3 3 10.5l7 2.5 2.5 7L21 3Z"/><path d="m10 13 4.5-4.5"/>'),
  pin: svg('<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  linkedin: svg('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 10.5V17M8 7.5v.01M12 17v-6.5M12 13.5c0-2 1.2-3 2.6-3S17 11.4 17 13.4V17"/>'),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6 8.5-6"/>'),
  whatsapp: svg('<path d="M4 20l1.2-3.7A8 8 0 1 1 8 19.1L4 20Z"/><path d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.6-2-1-1 .9a5 5 0 0 1-2.3-2.3l.9-1-1-2L9 8.5Z"/>'),
  spark: svg('<path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6L12 3Z"/><path d="M19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7L19 16Z"/>'),
  shield: svg('<path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>'),
  users: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-3.5 3.2-5.5 6.5-5.5s6 2 6.5 5.5"/><path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c2 .7 3.2 2.5 3.5 5.2"/>'),
  chart: svg('<path d="M4 20V14M9 20V10M14 20v-7M19 20V6"/><path d="m4 9 5-4 5 3 6-5"/>'),
  target: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/><path d="m15.5 8.5 5-5M17 3.5h3.5V7"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>', "i i--sm"),
  play: svg('<path d="M8 5.5v13l10-6.5-10-6.5Z"/>', "i i--sm i--fill"),
  rocket: svg('<path d="M14 4c3-1.5 6-1 6-1s.5 3-1 6l-6 6-5-5 6-6Z"/><path d="M8 10H5l-2 3h4M14 16v3l-3 2v-4M6 18c-1 1-1.5 3-1.5 3s2-.5 3-1.5"/>', "i i--sm"),
  card: svg('<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h3"/>', "i i--sm"),
  bolt: svg('<path d="M13 2 5 13.5h6L10 22l8-11.5h-6L13 2Z"/>', "i i--sm"),
  phone: svg('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z"/>'),
  home: svg('<path d="M4 11 12 4l8 7v9h-5v-6H9v6H4v-9Z"/>', "i i--sm"),
  list: svg('<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>', "i i--sm"),
  inbox: svg('<path d="M4 13 6.5 5h11L20 13v6H4v-6Z"/><path d="M4 13h4.5l1 2h5l1-2H20"/>', "i i--sm"),
  bars: svg('<path d="M5 20v-6M10 20V9M15 20v-4M20 20V5"/>', "i i--sm"),
  plane: svg('<path d="M21 3 3 10.5l7 2.5 2.5 7L21 3Z"/>', "i i--sm"),
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  chevron: svg('<path d="m7 10 5 5 5-5"/>', "i i--xs"),
};
const BRAND = {
  maps: '<svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><path fill="#34a853" d="M12 22s-7-6.4-7-12.2C5 5.8 8.1 3 12 3v6.5a2.5 2.5 0 0 0 0 5V22Z"/><path fill="#fbbc04" d="M12 22s7-6.4 7-12.2c0-1.3-.3-2.5-.9-3.5L13.8 9.9A2.5 2.5 0 0 1 12 14.5V22Z"/><path fill="#4285f4" d="M18.1 6.3A7 7 0 0 0 12 3v6.5a2.5 2.5 0 0 1 1.8 2.4l4.3-5.6Z"/><path fill="#ea4335" d="M12 3a7 7 0 0 0-6.4 4.1l4.6 3.4A2.5 2.5 0 0 1 12 9.5V3Z"/></svg>',
  linkedin: '<svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="4" fill="#0a66c2"/><path fill="#fff" d="M7 9.5h2.4V18H7V9.5Zm1.2-4a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8ZM11 9.5h2.3v1.2c.4-.7 1.3-1.4 2.6-1.4 2.6 0 3.1 1.7 3.1 4V18h-2.4v-4.2c0-1 0-2.3-1.4-2.3s-1.6 1.1-1.6 2.2V18H11V9.5Z"/></svg>',
  layers: '<svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><path fill="#cfe0ff" d="m12 13.5-9-5 9-5 9 5-9 5Z"/><path fill="none" stroke="#3b6cf6" stroke-width="1.6" stroke-linejoin="round" d="m12 3.5 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5m-18 4 9 5 9-5"/></svg>',
  whatsapp: '<svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><path fill="#25d366" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Z"/><path fill="#fff" d="M8.6 7c.3 0 .5 0 .7.5l.9 2.1c.1.2 0 .5-.1.7l-.6.7c-.2.2-.2.4 0 .6a7 7 0 0 0 3 2.6c.2.1.5.1.6-.1l.8-1c.2-.2.4-.2.6-.1l2 1c.3.1.4.3.4.5 0 .6-.3 1.6-1.6 2-1 .3-2.4.1-4.4-1A10.6 10.6 0 0 1 7.3 10C6.6 8.6 7.3 7.5 7.8 7.2c.3-.2.5-.2.8-.2Z"/></svg>',
};
const SOCIAL = {
  linkedin: '<svg class="i i--fill" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8.5h3V19H5V8.5Zm1.5-5a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4ZM10 8.5h2.9v1.4c.4-.8 1.4-1.6 3-1.6 3.1 0 3.7 2 3.7 4.7V19h-3v-5.2c0-1.2 0-2.8-1.7-2.8s-2 1.3-2 2.7V19H10V8.5Z"/></svg>',
  youtube: '<svg class="i i--fill" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 8.2a3 3 0 0 0-2.1-2.1C18 5.6 12 5.6 12 5.6s-6 0-7.9.5A3 3 0 0 0 2 8.2 31 31 0 0 0 1.6 12 31 31 0 0 0 2 15.8a3 3 0 0 0 2.1 2.1c1.9.5 7.9.5 7.9.5s6 0 7.9-.5a3 3 0 0 0 2.1-2.1c.4-1.2.4-3.8.4-3.8s0-2.6-.4-3.8ZM10 15V9l5.2 3L10 15Z"/></svg>',
  x: '<svg class="i i--fill" viewBox="0 0 24 24" aria-hidden="true"><path d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.2-8.3L2 3h6.4l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z"/></svg>',
};

const logo = (site: SiteInfo) => `<span class="brand__logo">LP</span><span class="brand__name">${esc(site.brandName)}<sup>™</sup></span>`;
const tel = (phone: string) => phone.replace(/[^\d+]/g, "");

function layout(site: SiteInfo, o: PageOptions): string {
  const url = site.baseUrl ? `${site.baseUrl}${o.path === "/" ? "/" : o.path}` : null;
  const title = o.path === "/" ? `${site.brandName} – ${o.title}` : `${o.title} | ${site.brandName}`;
  const cur = (p: string) => (p === o.path ? ' aria-current="page"' : "");
  const links = `<a href="/features"${cur("/features")}>Features</a><a href="/#how">How it Works</a><a href="/pricing"${cur("/pricing")}>Pricing</a><a href="/#faq">FAQ</a>`;
  const resources = `<a href="/about"${cur("/about")}>About us</a><a href="/contact"${cur("/contact")}>Contact us</a><a href="/privacy"${cur("/privacy")}>Privacy policy</a><a href="/terms"${cur("/terms")}>Terms of service</a>`;
  const socials = (
    [
      ["linkedinUrl", "LinkedIn", SOCIAL.linkedin],
      ["youtubeUrl", "YouTube", SOCIAL.youtube],
      ["xUrl", "X", SOCIAL.x],
    ] as const
  )
    .filter(([k]) => site[k])
    .map(([k, label, icon]) => `<a href="${esc(site[k])}" rel="noopener" target="_blank" aria-label="${label}">${icon}</a>`)
    .join("");
  const contact = [
    site.contactPhone && `<a href="tel:${esc(tel(site.contactPhone))}">${ICON.phone}${esc(site.contactPhone)}</a>`,
    site.contactEmail && `<a href="mailto:${esc(site.contactEmail)}">${ICON.mail}${esc(site.contactEmail)}</a>`,
    site.address && `<span>${ICON.pin}${esc(site.address)}</span>`,
  ]
    .filter(Boolean)
    .join("");
  const data = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: site.brandName,
      ...(site.baseUrl ? { url: `${site.baseUrl}/` } : {}),
      ...(site.contactEmail ? { email: site.contactEmail } : {}),
      ...(site.contactPhone ? { telephone: site.contactPhone } : {}),
      ...(site.address ? { address: { "@type": "PostalAddress", streetAddress: site.address, addressCountry: "IN" } } : {}),
      ...(socials ? { sameAs: [site.linkedinUrl, site.youtubeUrl, site.xUrl].filter(Boolean) } : {}),
    },
    ...(o.structuredData ?? []),
  ];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(o.description)}">
<meta name="robots" content="index, follow">
${url ? `<link rel="canonical" href="${esc(url)}">` : ""}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(site.brandName)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(o.description)}">
${url ? `<meta property="og:url" content="${esc(url)}">` : ""}
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#0a2e23">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/site.css">
<script type="application/ld+json">${ld(data)}</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <div class="wrap top__in">
    <a class="brand" href="/" aria-label="${esc(site.brandName)} home">${logo(site)}</a>
    <nav class="nav" aria-label="Main">${links}<details class="dd"><summary>Resources ${ICON.chevron}</summary><div class="dd__menu">${resources}</div></details></nav>
    <div class="top__cta"><a class="btn btn--ghost" href="/admin/">Sign in</a><a class="btn btn--gold" href="/admin/register">Get Started Free ${ICON.arrow}</a></div>
    <details class="menu"><summary aria-label="Menu">${ICON.menu}</summary><div class="menu__panel">${links}${resources}<a href="/admin/">Sign in</a><a class="btn btn--gold" href="/admin/register">Get Started Free</a></div></details>
  </div>
</header>
<main id="main">
${o.body}
</main>
<footer class="foot">
  <div class="wrap foot__in">
    <div class="foot__about">
      <a class="brand" href="/">${logo(site)}</a>
      <p>${esc(site.tagline)}</p>
      ${contact ? `<p class="foot__contact">${contact}</p>` : ""}
    </div>
    <div class="foot__col">
      <h2 class="foot__h">Product</h2>
      <a href="/features">Features</a><a href="/pricing">Pricing</a><a href="/admin/register">Create an account</a><a href="/admin/">Sign in</a>
    </div>
    <div class="foot__col">
      <h2 class="foot__h">Company</h2>
      <a href="/about">About us</a><a href="/contact">Contact us</a><a href="/privacy">Privacy policy</a><a href="/terms">Terms of service</a>
    </div>
    <div class="foot__col">
      <h2 class="foot__h">${socials ? "Follow us" : "Get in touch"}</h2>
      ${socials ? `<div class="foot__social">${socials}</div>` : `<a href="/contact">Send us a message</a>`}
    </div>
  </div>
  <div class="wrap foot__legal">© ${new Date().getFullYear()} ${esc(site.brandName)}. All rights reserved.</div>
</footer>
</body>
</html>`;
}

const FEATURES = [
  {
    icon: ICON.pin,
    title: "Google Maps Leads",
    short: "Search and extract business details like name, category, phone, website and rating.",
    text: "Search Google Maps for any business type and city. The Chrome extension saves the listing details that Maps shows publicly: name, category, phone, website, address and rating.",
  },
  {
    icon: ICON.linkedin,
    title: "LinkedIn Leads",
    short: "Save LinkedIn profiles you open, including contact details and company information.",
    text: "Save LinkedIn profiles you open, including the contact info you are allowed to see. Or import your own Connections export in one go.",
  },
  {
    icon: ICON.layers,
    title: "Clean, De-duplicated Lists",
    short: "Automatically remove duplicates, normalize phone numbers and export to CSV or Excel.",
    text: "Phone numbers and websites are normalised and duplicates are skipped automatically. Filter by city, category or keyword and export to CSV or Excel.",
  },
  {
    icon: ICON.mail,
    title: "Email Campaigns",
    short: "Send personalized emails from your own Gmail or SMTP, with scheduling and tracking.",
    text: "Send personalised emails from your own Resend or SMTP account, with pacing, daily limits, open and click tracking, and a working unsubscribe link in every mail.",
  },
  {
    icon: ICON.whatsapp,
    title: "WhatsApp Campaigns",
    short: "Send approved WhatsApp template messages via your WhatsApp Business account and track replies.",
    text: "Send approved WhatsApp template messages through your own Meta WhatsApp Business account, only to leads who opted in. STOP replies are respected automatically.",
  },
  {
    icon: ICON.spark,
    title: "AI Inbox",
    short: "Manage chats from Telegram, Facebook and Instagram in one place with AI-drafted responses.",
    text: "Telegram, Facebook and Instagram chats in one place. AI drafts replies from your business information; you decide what is sent on its own and what waits for you.",
  },
  {
    icon: ICON.shield,
    title: "Opt-outs Built In",
    short: "Unsubscribes and STOP replies are kept on a suppression list every campaign respects.",
    text: "Unsubscribes, STOP replies and spam reports go to a suppression list that every campaign checks, even for leads collected again later.",
  },
  {
    icon: ICON.users,
    title: "Your Own Private Account",
    short: "Every account has its own leads, campaigns, senders and settings.",
    text: "Every account has its own leads, campaigns, senders and settings. Nobody else sees your data.",
  },
];

const FAQS = [
  {
    q: "What does Lead Platform do?",
    a: "It helps you find business leads from Google Maps and LinkedIn, clean and organize them, and reach out through email and WhatsApp campaigns from your own accounts.",
  },
  {
    q: "How do I get started?",
    a: "Create an account and wait for approval. Then download the Chrome extension from your dashboard, open Google Maps, and start saving leads.",
  },
  {
    q: "How much does it cost?",
    a: `Your first ${FREE} leads are free. After that every new lead costs ${PRICE}. Duplicates you already have are not charged.`,
  },
  {
    q: "Do I need my own email and WhatsApp accounts?",
    a: "Yes. Campaigns are sent from your own Resend/SMTP email and your own Meta WhatsApp Business account, so your messages carry your name and you stay in control of costs and limits.",
  },
  {
    q: "Is my data private and secure?",
    a: "Yes. Each account is separate: your leads, campaigns and keys are visible only to you (and the platform administrator for support). Keys and passwords you enter are stored encrypted.",
  },
];

const tag = (text: string) => `<p class="tag">${text}</p>`;
const ticks = (items: string[]) => `<ul class="ticks">${items.map((i) => `<li>${ICON.check}${i}</li>`).join("")}</ul>`;

function cta(): string {
  return `<section class="cta"><div class="wrap cta__in">
  <span class="cta__icon">${ICON.target}</span>
  <div class="cta__text"><h2>Start with ${FREE} Free Leads Today</h2><p>Create your account in a minute and start finding, saving and reaching the right businesses.</p></div>
  <a class="btn btn--gold btn--lg" href="/admin/register">Create a Free Account ${ICON.arrow}</a>
</div></section>`;
}

function plans(): string {
  return `<section class="plans"><div class="wrap"><div class="plans__panel">
  <div class="plans__intro">
    <span class="plans__icon">${ICON.chart}</span>
    <div><h2>Simple, Flexible Plans for Growing Businesses</h2><p>Start free and upgrade as your lead generation and outreach needs grow.</p></div>
  </div>
  <article class="plan">
    <p class="plan__name">Starter</p>
    <h3>Free to Start</h3>
    ${ticks([`${FREE} free leads`, "Google Maps &amp; LinkedIn search", "Clean and de-duplicated lists", "Basic email &amp; WhatsApp campaigns"])}
    <a class="btn btn--gold btn--block" href="/admin/register">Get Started Free</a>
  </article>
  <article class="plan plan--main">
    <span class="plan__badge">Most Popular</span>
    <p class="plan__name">Growth</p>
    <h3>Pay as You Grow</h3>
    ${ticks([`${PRICE} per new lead after ${FREE}`, "Bulk lead export (CSV/Excel)", "Advanced email &amp; WhatsApp campaigns", "AI Inbox and reply management", "Duplicates are never charged"])}
    <a class="btn btn--gold btn--block" href="/pricing">Choose Growth Plan</a>
  </article>
</div></div></section>`;
}

function faqList(items: { q: string; a: string }[]): string {
  return `<div class="faqs">${items.map((f, i) => `<details class="faq"${i === 0 ? " open" : ""}><summary>${f.q}</summary><p>${f.a}</p></details>`).join("")}</div>`;
}

/** Decorative product preview in the hero (not real data). */
function mockup(site: SiteInfo): string {
  const rows = [
    ["City Care Hospital", "Hospital", "4.5", "+91 98100 10010", "Saved"],
    ["Sunrise Clinic", "Medical Clinic", "4.3", "+91 99100 20020", "New"],
    ["Green Valley Diagnostics", "Diagnostics", "4.4", "+91 97100 30030", "Saved"],
  ];
  return `<div class="mock" aria-hidden="true">
  <div class="mock__bar"><span></span><span></span><span></span></div>
  <div class="mock__body">
    <div class="mock__side">
      <p class="mock__brand"><span class="brand__logo">LP</span>${esc(site.brandName)}</p>
      <p class="mock__nav is-on">${ICON.home}Dashboard</p><p class="mock__nav">${ICON.list}Leads</p><p class="mock__nav">${ICON.plane}Campaigns</p><p class="mock__nav">${ICON.inbox}Inbox</p><p class="mock__nav">${ICON.list}Lists</p><p class="mock__nav">${ICON.bars}Reports</p>
    </div>
    <div class="mock__main">
      <div class="mock__head"><b>Leads Overview</b><span class="mock__pill">Last 30 Days ${ICON.chevron}</span></div>
      <div class="mock__stats">
        <div><span class="mock__ic mock__ic--blue">${ICON.users}</span><b>1,248</b><small>Leads Found</small></div>
        <div><span class="mock__ic mock__ic--green">${ICON.check}</span><b>1,192</b><small>With Phone</small></div>
        <div><span class="mock__ic mock__ic--violet">${ICON.layers}</span><b>56</b><small>Duplicates Removed</small></div>
      </div>
      <div class="mock__search"><span>${ICON.search}Hospitals in Lucknow</span><b>Search</b></div>
      <div class="mock__chips"><span class="is-on">All Leads (1,248)</span><span>Hospitals</span><span>Clinics</span><span>Diagnostics</span><span class="mock__city">City: Lucknow ${ICON.chevron}</span></div>
      <table class="mock__table"><thead><tr><th></th><th>Business</th><th>Category</th><th>Rating</th><th>Phone</th><th>Status</th></tr></thead><tbody>
      ${rows.map(([n, c, r, p, s]) => `<tr><td><i></i></td><td><b>${n}</b></td><td>${c}</td><td><em>★</em> ${r}</td><td>${p}</td><td><span class="st st--${s === "New" ? "new" : "ok"}">${s}</span></td></tr>`).join("")}
      </tbody></table>
    </div>
  </div>
</div>`;
}

export function homePage(site: SiteInfo): string {
  const steps = [
    [ICON.search, "Search", "Find businesses on Google Maps or LinkedIn by city, category or keyword."],
    [ICON.layers, "Save", "Get clean, de-duplicated leads with key details like name, phone, website and more."],
    [ICON.send, "Reach Out", "Run email and WhatsApp campaigns to start real conversations."],
  ];
  const strip = [
    [BRAND.maps, "Google Maps Leads", "Discover local businesses in any city"],
    [BRAND.linkedin, "LinkedIn Leads", "Find and save relevant prospects"],
    [BRAND.layers, "Clean Data", "De-duplicated, normalised and ready to use"],
    [BRAND.whatsapp, "Outreach &amp; Campaigns", "Reach leads via email and WhatsApp"],
  ];
  const body = `
<section class="hero">
  <div class="wrap hero__in">
    <div class="hero__text">
      <p class="badge">${ICON.rocket}Lead Generation Platform</p>
      <h1>Find &amp; Reach High-Quality Business Leads</h1>
      <p class="hero__lead">Collect business leads from Google Maps and LinkedIn, build clean prospect lists, and run automated email and WhatsApp campaigns — all in one powerful platform.</p>
      <div class="hero__cta"><a class="btn btn--gold btn--lg" href="/admin/register">Get Started Free ${ICON.arrow}</a><a class="btn btn--outline btn--lg" href="#how">See How It Works ${ICON.play}</a></div>
      <ul class="trust"><li>${ICON.check}${FREE} Free Leads</li><li>${ICON.card}No Credit Card</li><li>${ICON.bolt}Set Up in Minutes</li></ul>
    </div>
    ${mockup(site)}
  </div>
</section>
<section class="strip"><div class="wrap strip__in">${strip.map(([m, t, d]) => `<div class="strip__item">${m}<div><h2>${t}</h2><p>${d}</p></div></div>`).join("")}</div></section>
<section class="section" id="how">
  <div class="wrap">
    <div class="section__head">${tag("How it works")}<h2>From Search to Conversation in 3 Simple Steps</h2><p>Find, save and reach business leads in just a few clicks.</p></div>
    <ol class="steps">${steps.map(([icon, t, d], i) => `<li class="step"><span class="step__ic">${icon}</span><div><span class="step__n">${i + 1}</span><h3>${t}</h3><p>${d}</p></div></li>`).join("")}</ol>
  </div>
</section>
<section class="section section--tight" id="features">
  <div class="wrap">
    <div class="section__head">${tag("Features")}<h2>Everything You Need to Build Better Prospect Lists</h2><p>A complete lead generation and outreach platform for sales, marketing and growth teams.</p></div>
    <div class="fcards">${FEATURES.slice(0, 6).map((f) => `<article class="fcard"><span class="fcard__ic">${f.icon}</span><div><h3>${f.title}</h3><p>${f.short}</p></div></article>`).join("")}</div>
  </div>
</section>
${plans()}
<section class="section section--tight" id="faq">
  <div class="wrap narrow">
    <div class="section__head">${tag("FAQ")}<h2>Frequently Asked Questions</h2></div>
    ${faqList(FAQS)}
  </div>
</section>
${cta()}`;
  return layout(site, {
    path: "/",
    title: "Google Maps & LinkedIn lead generation with email and WhatsApp outreach",
    description: `${site.brandName} helps you collect business leads from Google Maps and LinkedIn, keep clean de-duplicated lists, and reach them by email and WhatsApp. First ${FREE_LEADS} leads free, then ${PRICE} per lead.`,
    body,
    structuredData: [
      {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: site.brandName,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web, Chrome",
        description: "Lead generation from Google Maps and LinkedIn with email and WhatsApp outreach.",
        offers: { "@type": "Offer", price: PRICE_PER_LEAD_INR.toFixed(2), priceCurrency: "INR", description: `Per lead after the first ${FREE_LEADS} free leads` },
      },
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: FAQS.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
      },
    ],
  });
}

function pageHead(label: string, title: string, lead: string): string {
  return `<section class="page-head"><div class="wrap"><p class="badge">${label}</p><h1>${title}</h1><p class="hero__lead">${lead}</p></div></section>`;
}

export function featuresPage(site: SiteInfo): string {
  const body = `
${pageHead("Features", "Everything from the first lead to the first reply", "Find, organise and reach business leads in one place.")}
<section class="section"><div class="wrap">
  <div class="fcards">${FEATURES.map((f) => `<article class="fcard"><span class="fcard__ic">${f.icon}</span><div><h2 class="fcard__h">${f.title}</h2><p>${f.text}</p></div></article>`).join("")}</div>
</div></section>
<section class="section section--alt"><div class="wrap narrow">
  <div class="section__head">${tag("Good to know")}<h2>You stay in control</h2></div>
  ${ticks([
    "The extensions only read pages you open yourself and save what is visible to you. You stay in control of every search.",
    "Campaigns go out from your own email and WhatsApp accounts, with pacing and daily limits you set.",
    "Every email has an unsubscribe link; WhatsApp messages go only to leads who opted in.",
    "Export your leads to CSV or Excel at any time.",
  ])}
</div></section>
${cta()}`;
  return layout(site, {
    path: "/features",
    title: "Features",
    description: `Google Maps and LinkedIn lead collection, de-duplicated lists, email and WhatsApp campaigns, AI Inbox and built-in opt-outs — all features of ${site.brandName}.`,
    body,
  });
}

export function pricingPage(site: SiteInfo): string {
  const body = `
${pageHead("Pricing", "Simple pricing. Pay only for new leads.", `Your first ${FREE} leads are free. After that each new lead costs ${PRICE}.`)}
${plans()}
<section class="section section--tight"><div class="wrap narrow">
  <p class="center muted small">Email and WhatsApp messages are billed by your own provider (for example Resend or Meta), not by us.</p>
  <div class="section__head">${tag("FAQ")}<h2>Questions about pricing</h2></div>
  ${faqList([
    { q: "What counts as a lead?", a: "Each new business from Google Maps or person from LinkedIn saved to your account. Saving one you already have again is free." },
    { q: "What happens when my balance runs out?", a: "New leads are not saved until you recharge. Your existing leads, exports and campaigns keep working." },
    { q: "How do I recharge?", a: 'Open Billing in your account and pay online with UPI, card or netbanking (Razorpay). Prefer a bank transfer? <a href="/contact">Contact us</a> and we add the amount to your account.' },
  ])}
</div></section>
${cta()}`;
  return layout(site, {
    path: "/pricing",
    title: "Pricing",
    description: `First ${FREE_LEADS} leads free, then ${PRICE} per new lead. Duplicates are free. ${site.brandName} pricing for Google Maps and LinkedIn leads.`,
    body,
  });
}

export function aboutPage(site: SiteInfo): string {
  const b = esc(site.brandName);
  const body = `
${pageHead("About us", `About ${b}`, "We help growing businesses find the right customers and start real conversations.")}
<section class="section"><div class="wrap narrow prose">
  <h2>What we do</h2>
  <p>${b} brings lead collection and outreach together. Save businesses from Google Maps and people from LinkedIn with our Chrome extensions, keep them in one clean, de-duplicated list, and reach them by email and WhatsApp from your own accounts.</p>
  <h2>How we work</h2>
  <p>You stay in control: the extensions only save what you can see on pages you open yourself, campaigns are paced with limits you choose, and every opt-out is respected automatically.</p>
  <h2>Talk to us</h2>
  <p>Want a demo or have a question? <a href="/contact">Contact us</a> — we are happy to help.</p>
</div></section>
${cta()}`;
  return layout(site, { path: "/about", title: "About us", description: `About ${site.brandName}: Google Maps and LinkedIn lead generation with email and WhatsApp outreach.`, body });
}

export interface ContactForm {
  name: string;
  email: string;
  phone: string;
  company: string;
  message: string;
}

export function contactPage(site: SiteInfo, state: { sent?: boolean; error?: string; values?: Partial<ContactForm> } = {}): string {
  const v = state.values ?? {};
  const field = (name: keyof ContactForm, label: string, attrs: string) =>
    `<label class="field"><span>${label}</span><input name="${name}" ${attrs} value="${esc(v[name] ?? "")}"></label>`;
  const details = [
    site.contactPhone && `<li><span class="fcard__ic">${ICON.phone}</span><div><b>Call us</b><a href="tel:${esc(tel(site.contactPhone))}">${esc(site.contactPhone)}</a></div></li>`,
    site.whatsapp && `<li><span class="fcard__ic">${ICON.whatsapp}</span><div><b>WhatsApp</b><a href="https://wa.me/${esc(site.whatsapp.replace(/\D/g, ""))}" rel="noopener">${esc(site.whatsapp)}</a></div></li>`,
    site.contactEmail && `<li><span class="fcard__ic">${ICON.mail}</span><div><b>Email</b><a href="mailto:${esc(site.contactEmail)}">${esc(site.contactEmail)}</a></div></li>`,
    site.address && `<li><span class="fcard__ic">${ICON.pin}</span><div><b>Address</b><span>${esc(site.address)}</span></div></li>`,
  ]
    .filter(Boolean)
    .join("");
  const body = `
${pageHead("Contact us", "Let's talk", "Questions, a demo, or help with recharge? Write to us and we will get back to you.")}
<section class="section"><div class="wrap contact">
  <div class="box">
    ${state.sent ? '<p class="notice notice--ok" role="status">Thank you! Your message has been sent. We will reply soon.</p>' : ""}
    ${state.error ? `<p class="notice notice--err" role="alert">${esc(state.error)}</p>` : ""}
    <form class="form" method="post" action="/contact">
      <div class="form__row">${field("name", "Your name", 'required maxlength="100" autocomplete="name"')}${field("email", "Email", 'type="email" required maxlength="254" autocomplete="email"')}</div>
      <div class="form__row">${field("phone", "Phone (optional)", 'type="tel" maxlength="20" autocomplete="tel"')}${field("company", "Company (optional)", 'maxlength="150" autocomplete="organization"')}</div>
      <label class="field"><span>Message</span><textarea name="message" required minlength="5" maxlength="3000" rows="6">${esc(v.message ?? "")}</textarea></label>
      <label class="hp" aria-hidden="true">Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label>
      <button class="btn btn--gold btn--lg" type="submit">Send message ${ICON.arrow}</button>
      <p class="muted small">We use your details only to answer you. See our <a href="/privacy">privacy policy</a>.</p>
    </form>
  </div>
  ${details ? `<aside class="box box--dark"><h2>Reach us directly</h2><ul class="contact__list">${details}</ul></aside>` : ""}
</div></section>`;
  return layout(site, {
    path: "/contact",
    title: "Contact us",
    description: `Contact ${site.brandName} for questions, a demo or help with your account.${site.contactPhone ? ` Call ${site.contactPhone}.` : ""}`,
    body,
  });
}

function legalPage(site: SiteInfo, path: string, title: string, description: string, sections: [string, string][]): string {
  const body = `
${pageHead("Legal", title, `Last updated: ${new Date().toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })}`)}
<section class="section"><div class="wrap narrow prose">${sections.map(([h, p]) => `<h2>${h}</h2><p>${p}</p>`).join("")}</div></section>`;
  return layout(site, { path, title, description, body });
}

export function privacyPage(site: SiteInfo): string {
  const b = esc(site.brandName);
  const email = site.contactEmail ? ` at <a href="mailto:${esc(site.contactEmail)}">${esc(site.contactEmail)}</a>` : "";
  return legalPage(site, "/privacy", "Privacy policy", `How ${site.brandName} collects, uses and protects your data.`, [
    ["What we collect", `When you create an account we store your email, phone number, user id and an encrypted password. When you use ${b} we store the leads, contacts, templates and campaigns you create, and the settings you enter.`],
    ["How we use it", "To run your account and the services you use, to answer your messages, and to keep the service secure. We do not sell your data."],
    ["Your keys and passwords", "API keys, tokens and passwords you enter for your own email, WhatsApp, AI or social accounts are stored encrypted and are never shown again in the panel."],
    ["People you contact", "You are responsible for contacting people lawfully. Every email carries an unsubscribe link and opt-outs are kept on a suppression list that campaigns respect."],
    ["Keeping and deleting data", `Your data stays in your account until you delete it or ask us to delete your account. Contact us${email} for a copy or deletion of your data.`],
    ["Cookies", "We use one essential cookie to keep you signed in. We do not use advertising cookies."],
    ["Contact", `Questions about privacy? Write to us${email} or use the <a href="/contact">contact form</a>.`],
  ]);
}

export function termsPage(site: SiteInfo): string {
  const b = esc(site.brandName);
  return legalPage(site, "/terms", "Terms of service", `The terms for using ${site.brandName}.`, [
    ["The service", `${b} provides tools to collect business leads that you can see on Google Maps and LinkedIn, organise them, and contact them from your own email and WhatsApp accounts.`],
    ["Your account", "Accounts are approved by our team. Keep your password safe; you are responsible for activity in your account. We may suspend accounts that misuse the service."],
    ["Fair and lawful use", "Use the service only for lawful business purposes. Respect the terms of the websites you use, the privacy of the people you contact, anti-spam rules (including TRAI rules in India) and every opt-out request."],
    ["Pricing and balance", `Your first ${FREE} leads are free; after that each new lead costs ${PRICE} from your balance. Charges of your own email, WhatsApp or AI providers are billed by them.`],
    ["Availability", "We work to keep the service available but cannot guarantee it will be uninterrupted. Export your data regularly."],
    ["Changes", "We may update these terms; the date above shows the latest version. Continuing to use the service means you accept them."],
  ]);
}

export function sitemap(site: SiteInfo): string {
  const base = site.baseUrl ?? "";
  const urls = SITE_PAGES.map((p) => `<url><loc>${esc(base + p.path)}</loc><changefreq>${p.path === "/" ? "weekly" : "monthly"}</changefreq><priority>${p.path === "/" ? "1.0" : "0.7"}</priority></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>\n`;
}

export function robots(site: SiteInfo): string {
  return `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\n${site.baseUrl ? `Sitemap: ${site.baseUrl}/sitemap.xml\n` : ""}`;
}

export const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#14a06a"/><text x="16" y="21" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="#fff" text-anchor="middle">LP</text></svg>`;

// Public website pages, rendered on the server as plain HTML (no JavaScript): fast to load and
// fully readable by search engines. Texts that change per installation (brand, contact details)
// come from SiteSettings and are always escaped.

export interface SiteInfo {
  brandName: string;
  tagline: string;
  contactEmail: string;
  contactPhone: string;
  whatsapp: string;
  address: string;
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

export const SITE_PAGES = [
  { path: "/", label: "Home" },
  { path: "/features", label: "Features" },
  { path: "/pricing", label: "Pricing" },
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

const ICON = {
  map: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"/></svg>',
  person: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2c-4.4 0-8 2.2-8 5v2h16v-2c0-2.8-3.6-5-8-5Z"/></svg>',
  mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm9 7.2L4.2 7H4v.4l8 5.3 8-5.3V7h-.2L12 12.2Z"/></svg>',
  chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 1-2Zm3 6v2h10V9H7Zm0 4v2h7v-2H7Z"/></svg>',
  spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2Z"/></svg>',
  table: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h18v16H3V4Zm2 4v4h6V8H5Zm8 0v4h6V8h-6Zm-8 6v4h6v-4H5Zm8 0v4h6v-4h-6Z"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Zm-1.2 14L7 12.2l1.4-1.4 2.4 2.4 4.8-4.8L17 9.8 10.8 16Z"/></svg>',
  team: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM9 13c-4 0-7 2-7 4.5V20h14v-2.5C16 15 13 13 9 13Zm8 0c-.6 0-1.2.1-1.8.2 1.1.9 1.8 2.1 1.8 3.3V20h5v-2.5c0-2.3-2.2-4.5-5-4.5Z"/></svg>',
};

function layout(site: SiteInfo, o: PageOptions): string {
  const url = site.baseUrl ? `${site.baseUrl}${o.path === "/" ? "/" : o.path}` : null;
  const title = o.path === "/" ? `${site.brandName} – ${o.title}` : `${o.title} | ${site.brandName}`;
  const nav = SITE_PAGES.filter((p) => ["/features", "/pricing", "/contact"].includes(p.path))
    .map((p) => `<a href="${p.path}"${p.path === o.path ? ' aria-current="page"' : ""}>${p.label}</a>`)
    .join("");
  const contact = [
    site.contactEmail && `<a href="mailto:${esc(site.contactEmail)}">${esc(site.contactEmail)}</a>`,
    site.contactPhone && `<a href="tel:${esc(site.contactPhone.replace(/[^\d+]/g, ""))}">${esc(site.contactPhone)}</a>`,
    site.address && `<span>${esc(site.address)}</span>`,
  ]
    .filter(Boolean)
    .join("<br>");
  const data = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: site.brandName,
      ...(site.baseUrl ? { url: `${site.baseUrl}/` } : {}),
      ...(site.contactEmail ? { email: site.contactEmail } : {}),
      ...(site.contactPhone ? { telephone: site.contactPhone } : {}),
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
<meta name="theme-color" content="#1a73e8">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/site.css">
<script type="application/ld+json">${ld(data)}</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <div class="wrap top__in">
    <a class="brand" href="/" aria-label="${esc(site.brandName)} home"><span class="brand__logo">LP</span><span>${esc(site.brandName)}</span></a>
    <nav class="nav" aria-label="Main">${nav}</nav>
    <div class="top__cta"><a class="btn btn--text" href="/admin/">Sign in</a><a class="btn btn--primary" href="/admin/register">Get started</a></div>
  </div>
</header>
<main id="main">
${o.body}
</main>
<footer class="foot">
  <div class="wrap foot__in">
    <div>
      <a class="brand" href="/"><span class="brand__logo">LP</span><span>${esc(site.brandName)}</span></a>
      <p class="muted">${esc(site.tagline)}</p>
    </div>
    <div>
      <h2 class="foot__h">Product</h2>
      <a href="/features">Features</a><a href="/pricing">Pricing</a><a href="/admin/register">Create an account</a><a href="/admin/">Sign in</a>
    </div>
    <div>
      <h2 class="foot__h">Company</h2>
      <a href="/contact">Contact us</a><a href="/privacy">Privacy policy</a><a href="/terms">Terms of service</a>
    </div>
    ${contact ? `<div><h2 class="foot__h">Get in touch</h2><p class="foot__contact">${contact}</p></div>` : ""}
  </div>
  <div class="wrap foot__legal muted">© ${new Date().getFullYear()} ${esc(site.brandName)}. All rights reserved.</div>
</footer>
</body>
</html>`;
}

const FEATURES = [
  {
    icon: ICON.map,
    title: "Google Maps leads",
    text: "Search Google Maps for any business type and city. The Chrome extension saves the listing details that Maps shows publicly: name, category, phone, website, address and rating.",
  },
  {
    icon: ICON.person,
    title: "LinkedIn leads",
    text: "Save LinkedIn profiles you open, including the contact info you are allowed to see. Or import your own Connections export in one go.",
  },
  {
    icon: ICON.table,
    title: "Clean, de-duplicated lists",
    text: "Phone numbers and websites are normalised and duplicates are skipped automatically. Filter by city, category or keyword and export to CSV or Excel.",
  },
  {
    icon: ICON.mail,
    title: "Email campaigns",
    text: "Send personalised emails from your own Resend or SMTP account, with pacing, daily limits, open and click tracking, and a working unsubscribe link in every mail.",
  },
  {
    icon: ICON.chat,
    title: "WhatsApp campaigns",
    text: "Send approved WhatsApp template messages through your own Meta WhatsApp Business account, only to leads who opted in. STOP replies are respected automatically.",
  },
  {
    icon: ICON.spark,
    title: "AI Inbox",
    text: "Telegram, Facebook and Instagram chats in one place. AI drafts replies from your business information; you decide what is sent on its own and what waits for you.",
  },
  {
    icon: ICON.shield,
    title: "Opt-outs built in",
    text: "Unsubscribes, STOP replies and spam reports go to a suppression list that every campaign checks, even for leads collected again later.",
  },
  {
    icon: ICON.team,
    title: "Your own private account",
    text: "Every account has its own leads, campaigns, senders and settings. Nobody else sees your data.",
  },
];

const FAQS = [
  {
    q: "What does this website do?",
    a: "It helps you find business leads on Google Maps and LinkedIn, keeps them in one clean list, and lets you contact them by email and WhatsApp from your own accounts, with opt-outs handled for you.",
  },
  {
    q: "How do I start?",
    a: "Create an account and wait for approval. Then download the Chrome extension from your dashboard, open Google Maps, and start saving leads.",
  },
  {
    q: "How much does it cost?",
    a: `Your first ${FREE_LEADS.toLocaleString("en-IN")} leads are free. After that every new lead costs ₹${PRICE_PER_LEAD_INR.toFixed(2)}. Duplicates you already have are not charged.`,
  },
  {
    q: "Do I need my own email and WhatsApp accounts?",
    a: "Yes. Campaigns are sent from your own Resend/SMTP email and your own Meta WhatsApp Business account, so your messages carry your name and you stay in control of costs and limits.",
  },
  {
    q: "Is my data private?",
    a: "Yes. Each account is separate: your leads, campaigns and keys are visible only to you (and the platform administrator for support). Keys and passwords you enter are stored encrypted.",
  },
];

function cta(): string {
  return `<section class="band"><div class="wrap band__in"><div><h2>Start with ${FREE_LEADS.toLocaleString("en-IN")} free leads</h2><p>Create your account in a minute. No card needed.</p></div><a class="btn btn--light" href="/admin/register">Create a free account</a></div></section>`;
}

export function homePage(site: SiteInfo): string {
  const steps = [
    ["Search", "Open Google Maps or LinkedIn and search for the businesses or people you want to reach."],
    ["Save", "The Chrome extension saves the details into your private, de-duplicated lead list."],
    ["Reach out", "Send email and WhatsApp campaigns from your own accounts, or export the list."],
  ];
  const body = `
<section class="hero">
  <div class="wrap hero__in">
    <div>
      <p class="eyebrow">Lead generation for growing businesses</p>
      <h1>Find business leads on Google&nbsp;Maps and LinkedIn. Reach them in minutes.</h1>
      <p class="lead">${esc(site.tagline)} Clean, de-duplicated lists, and campaigns from your own accounts.</p>
      <div class="hero__cta"><a class="btn btn--primary btn--lg" href="/admin/register">Get started free</a><a class="btn btn--outline btn--lg" href="/features">See how it works</a></div>
      <p class="muted small">First ${FREE_LEADS.toLocaleString("en-IN")} leads free · then ₹${PRICE_PER_LEAD_INR.toFixed(2)} per lead</p>
    </div>
    <div class="preview" aria-hidden="true">
      <div class="preview__bar"><span></span><span></span><span></span></div>
      <div class="preview__search">${ICON.map}<span>hospitals in Lucknow</span></div>
      <ul class="preview__list">
        <li><b>City Care Hospital</b><span>Hospital · ★ 4.5 · +91 98xxx xxx10</span></li>
        <li><b>Sunrise Clinic</b><span>Medical clinic · ★ 4.3 · sunriseclinic.in</span></li>
        <li><b>Green Valley Diagnostics</b><span>Diagnostic centre · ★ 4.7 · +91 97xxx xxx42</span></li>
      </ul>
      <div class="preview__foot">3 new leads saved · 1 duplicate skipped</div>
    </div>
  </div>
</section>
<section class="section">
  <div class="wrap">
    <h2 class="section__h">How it works</h2>
    <ol class="steps">${steps.map(([t, d], i) => `<li><span class="steps__n">${i + 1}</span><h3>${t}</h3><p>${d}</p></li>`).join("")}</ol>
  </div>
</section>
<section class="section section--alt">
  <div class="wrap">
    <h2 class="section__h">Everything you need to find and reach customers</h2>
    <div class="cards">${FEATURES.slice(0, 6).map((f) => `<article class="card">${f.icon}<h3>${f.title}</h3><p>${f.text}</p></article>`).join("")}</div>
    <p class="center"><a class="btn btn--outline" href="/features">All features</a></p>
  </div>
</section>
<section class="section">
  <div class="wrap narrow">
    <h2 class="section__h">Frequently asked questions</h2>
    ${FAQS.map((f) => `<details class="faq"><summary>${f.q}</summary><p>${f.a}</p></details>`).join("")}
  </div>
</section>
${cta()}`;
  return layout(site, {
    path: "/",
    title: "Google Maps & LinkedIn lead generation with email and WhatsApp outreach",
    description: `${site.brandName} helps you collect business leads from Google Maps and LinkedIn, keep clean de-duplicated lists, and reach them by email and WhatsApp. First ${FREE_LEADS} leads free.`,
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

export function featuresPage(site: SiteInfo): string {
  const body = `
<section class="page-head"><div class="wrap"><h1>Features</h1><p class="lead">From finding a lead to the first reply, in one place.</p></div></section>
<section class="section"><div class="wrap">
  <div class="cards">${FEATURES.map((f) => `<article class="card">${f.icon}<h2 class="card__h">${f.title}</h2><p>${f.text}</p></article>`).join("")}</div>
</div></section>
<section class="section section--alt"><div class="wrap narrow">
  <h2 class="section__h">Good to know</h2>
  <ul class="ticks">
    <li>The extensions only read pages you open yourself and save what is visible to you. You stay in control of every search.</li>
    <li>Campaigns go out from your own email and WhatsApp accounts, with pacing and daily limits you set.</li>
    <li>Every email has an unsubscribe link; WhatsApp messages go only to leads who opted in.</li>
    <li>Export your leads to CSV or Excel at any time.</li>
  </ul>
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
<section class="page-head"><div class="wrap"><h1>Simple pricing</h1><p class="lead">Pay only for the new leads you collect.</p></div></section>
<section class="section"><div class="wrap">
  <div class="plans">
    <article class="plan">
      <h2>Free start</h2>
      <p class="plan__price">₹0</p>
      <p class="muted">Your first ${FREE_LEADS.toLocaleString("en-IN")} leads</p>
      <ul class="ticks"><li>Google Maps and LinkedIn leads combined</li><li>All features included</li><li>No card needed</li></ul>
      <a class="btn btn--outline" href="/admin/register">Create an account</a>
    </article>
    <article class="plan plan--main">
      <h2>Pay per lead</h2>
      <p class="plan__price">₹${PRICE_PER_LEAD_INR.toFixed(2)}<span> / new lead</span></p>
      <p class="muted">After the free leads</p>
      <ul class="ticks"><li>Duplicates you already have are free</li><li>Recharge your balance whenever you need</li><li>Email and WhatsApp sending through your own accounts</li></ul>
      <a class="btn btn--primary" href="/admin/register">Get started</a>
    </article>
  </div>
  <p class="center muted small">Email and WhatsApp messages are billed by your own provider (for example Resend or Meta), not by us.</p>
</div></section>
<section class="section section--alt"><div class="wrap narrow">
  <h2 class="section__h">Questions about pricing</h2>
  <details class="faq"><summary>What counts as a lead?</summary><p>Each new business from Google Maps or person from LinkedIn saved to your account. Saving one you already have again is free.</p></details>
  <details class="faq"><summary>What happens when my balance runs out?</summary><p>New leads are not saved until you recharge. Your existing leads, exports and campaigns keep working.</p></details>
  <details class="faq"><summary>How do I recharge?</summary><p><a href="/contact">Contact us</a> and we add the amount to your account.</p></details>
</div></section>
${cta()}`;
  return layout(site, {
    path: "/pricing",
    title: "Pricing",
    description: `First ${FREE_LEADS} leads free, then ₹${PRICE_PER_LEAD_INR.toFixed(2)} per new lead. Duplicates are free. ${site.brandName} pricing for Google Maps and LinkedIn leads.`,
    body,
  });
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
    site.contactEmail && `<li>${ICON.mail}<a href="mailto:${esc(site.contactEmail)}">${esc(site.contactEmail)}</a></li>`,
    site.contactPhone && `<li>${ICON.chat}<a href="tel:${esc(site.contactPhone.replace(/[^\d+]/g, ""))}">${esc(site.contactPhone)}</a></li>`,
    site.whatsapp && `<li>${ICON.chat}<a href="https://wa.me/${esc(site.whatsapp.replace(/\D/g, ""))}" rel="noopener">WhatsApp ${esc(site.whatsapp)}</a></li>`,
    site.address && `<li>${ICON.map}<span>${esc(site.address)}</span></li>`,
  ]
    .filter(Boolean)
    .join("");
  const body = `
<section class="page-head"><div class="wrap"><h1>Contact us</h1><p class="lead">Questions, a demo, or help with recharge? Write to us and we will get back to you.</p></div></section>
<section class="section"><div class="wrap contact">
  <div>
    ${state.sent ? '<p class="notice notice--ok" role="status">Thank you! Your message has been sent. We will reply soon.</p>' : ""}
    ${state.error ? `<p class="notice notice--err" role="alert">${esc(state.error)}</p>` : ""}
    <form class="form" method="post" action="/contact">
      ${field("name", "Your name", 'required maxlength="100" autocomplete="name"')}
      ${field("email", "Email", 'type="email" required maxlength="254" autocomplete="email"')}
      ${field("phone", "Phone (optional)", 'type="tel" maxlength="20" autocomplete="tel"')}
      ${field("company", "Company (optional)", 'maxlength="150" autocomplete="organization"')}
      <label class="field"><span>Message</span><textarea name="message" required minlength="5" maxlength="3000" rows="6">${esc(v.message ?? "")}</textarea></label>
      <label class="hp" aria-hidden="true">Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label>
      <button class="btn btn--primary btn--lg" type="submit">Send message</button>
      <p class="muted small">We use your details only to answer you. See our <a href="/privacy">privacy policy</a>.</p>
    </form>
  </div>
  ${details ? `<aside class="card"><h2 class="card__h">Reach us directly</h2><ul class="contact__list">${details}</ul></aside>` : ""}
</div></section>`;
  return layout(site, {
    path: "/contact",
    title: "Contact us",
    description: `Contact ${site.brandName} for questions, a demo or help with your account.`,
    body,
  });
}

function legalPage(site: SiteInfo, path: string, title: string, description: string, sections: [string, string][]): string {
  const body = `
<section class="page-head"><div class="wrap"><h1>${title}</h1><p class="muted">Last updated: ${new Date().toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })}</p></div></section>
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
    ["Pricing and balance", `Your first ${FREE_LEADS.toLocaleString("en-IN")} leads are free; after that each new lead costs ₹${PRICE_PER_LEAD_INR.toFixed(2)} from your balance. Charges of your own email, WhatsApp or AI providers are billed by them.`],
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

export const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#1a73e8"/><text x="16" y="21" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="#fff" text-anchor="middle">LP</text></svg>`;

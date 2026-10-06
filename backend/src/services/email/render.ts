// Deterministic template rendering. Templates are plain text with {{variables}};
// HTML is generated from that text, so lead data (scraped, untrusted) is always escaped.

export const TEMPLATE_VARIABLES = ["name", "category", "city", "state", "country", "website", "phone"] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

export type TemplateData = Partial<Record<TemplateVariable, string | null>>;

// {{ name }} or {{ city | your city }} (fallback when the value is empty)
const VARIABLE = /\{\{\s*([a-zA-Z_]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g;

/** Variable names used in a text, in order of first use. */
export function variablesIn(text: string): string[] {
  return [...new Set([...text.matchAll(VARIABLE)].map((m) => m[1]!))];
}

/** Each variable once, in order of first use, with the fallback written at that first use. */
export function variableUses(text: string): { name: string; fallback: string | null }[] {
  const seen = new Map<string, string | null>();
  for (const m of text.matchAll(VARIABLE)) {
    if (!seen.has(m[1]!)) seen.set(m[1]!, m[2]?.trim() || null);
  }
  return [...seen].map(([name, fallback]) => ({ name, fallback }));
}

export function unknownVariables(...texts: string[]): string[] {
  const known = new Set<string>(TEMPLATE_VARIABLES);
  return [...new Set(texts.flatMap(variablesIn))].filter((v) => !known.has(v));
}

export function substitute(text: string, data: TemplateData): string {
  return text.replace(VARIABLE, (_m, name: string, fallback?: string) => {
    const value = data[name as TemplateVariable]?.trim();
    return value || fallback?.trim() || "";
  });
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** http(s) links in already-escaped text become clickable. */
function linkify(escaped: string): string {
  return escaped.replace(/\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)]/g, (url) => `<a href="${url}">${url}</a>`);
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function renderEmail(
  template: { subject: string; body: string },
  data: TemplateData,
  footer: { unsubscribeUrl: string },
): RenderedEmail {
  // Line breaks in a subject could inject extra mail headers.
  const subject = substitute(template.subject, data).replace(/[\r\n]+/g, " ").trim();
  const body = substitute(template.body, data).replace(/\r\n/g, "\n").trim();

  const textFooter = `\n\n--\nIf you would rather not receive these emails, unsubscribe here: ${footer.unsubscribeUrl}`;
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => `<p>${linkify(escapeHtml(p)).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
  const htmlFooter =
    `<p style="margin-top:24px;color:#6b7280;font-size:12px">If you would rather not receive these emails, ` +
    `<a href="${escapeHtml(footer.unsubscribeUrl)}">unsubscribe here</a>.</p>`;

  return {
    subject,
    text: body + textFooter,
    html: `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111827">\n${paragraphs}\n${htmlFooter}\n</body></html>`,
  };
}

/** Lead → template data. */
export function leadTemplateData(lead: Partial<Record<TemplateVariable, string | null>>): TemplateData {
  return Object.fromEntries(TEMPLATE_VARIABLES.map((v) => [v, lead[v] ?? null])) as TemplateData;
}

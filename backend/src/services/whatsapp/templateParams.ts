// WhatsApp template bodies are stored with lead variables ({{name}}, {{city|your city}}).
// Meta's approved template has numbered ({{1}}, {{2}}) or named ({{name}}) parameters;
// this maps one to the other deterministically: the n-th distinct variable is {{n}}.

import type { TemplateParam } from "../../providers/whatsapp/index.js";
import { substitute, variableUses, type TemplateData, type TemplateVariable } from "../email/render.js";

export type ParamFormat = "positional" | "named";

export interface WhatsAppRendered {
  /** Parameters to send, in order. */
  params: TemplateParam[];
  /** The message as the recipient will read it (for preview and history). */
  text: string;
  /** Variables with no value and no fallback: WhatsApp rejects empty parameters. */
  missing: string[];
}

/** The body as it must look in WhatsApp Manager, e.g. "Hello {{1}}" or "Hello {{name}}". */
export function providerBody(body: string, format: ParamFormat): string {
  const index = new Map(variableUses(body).map((v, i) => [v.name, i + 1]));
  return body.replace(/\{\{\s*([a-zA-Z_]+)\s*(?:\|[^}]*)?\}\}/g, (_m, name: string) => `{{${format === "named" ? name : index.get(name)}}}`);
}

/** Parameter text may not contain line breaks, tabs or long runs of spaces. */
function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function renderWhatsApp(template: { body: string; paramFormat: string | null }, data: TemplateData): WhatsAppRendered {
  const format: ParamFormat = template.paramFormat === "named" ? "named" : "positional";
  const params: TemplateParam[] = [];
  const missing: string[] = [];
  const values: TemplateData = {};
  for (const { name, fallback } of variableUses(template.body)) {
    const value = clean(data[name as TemplateVariable] ?? "") || clean(fallback ?? "");
    if (!value) missing.push(name);
    values[name as TemplateVariable] = value;
    params.push(format === "named" ? { name, value } : { value });
  }
  return { params, text: substitute(template.body, values).trim(), missing };
}

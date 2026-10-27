// SMS and LinkedIn message templates. Plain text with {{variables}} filled from a contact of an
// uploaded sheet: {{first_name}}, {{name}}, {{company}}, {{designation}}, {{email}}, {{phone}}.
// A fallback can follow a bar: {{company|your company}}.

import type { ContactRecord, Repositories, TemplateRecord } from "../../database/repositories/index.js";
import { Errors } from "../../utils/errors.js";

export type ContactTemplateChannel = "sms" | "linkedin" | "instagram";

export const CONTACT_VARIABLES = ["first_name", "name", "company", "designation", "email", "phone"] as const;
export type ContactVariable = (typeof CONTACT_VARIABLES)[number];

/** LinkedIn's limit for one message; SMS is long enough for 10 concatenated parts. */
export const BODY_LIMIT: Record<ContactTemplateChannel, number> = { linkedin: 8000, sms: 1600, instagram: 1000 };

const VARIABLE = /\{\{\s*([a-zA-Z_]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g;

export const SAMPLE_CONTACT = {
  name: "Priya Sharma",
  company: "Example Pvt Ltd",
  designation: "HR Manager",
  email: "priya@example.com",
  phone: "+91 98765 43210",
};

export function contactData(c: Pick<ContactRecord, "name" | "company" | "designation" | "email" | "phone">): Record<ContactVariable, string | null> {
  const first = c.name.trim().split(/\s+/)[0] ?? "";
  // "Dr. Priya Sharma" → "Priya"
  const firstName = /^(dr|mr|mrs|ms|prof|er|ca)\.?$/i.test(first) ? (c.name.trim().split(/\s+/)[1] ?? first) : first;
  return { first_name: firstName, name: c.name, company: c.company, designation: c.designation, email: c.email, phone: c.phone };
}

export function unknownContactVariables(text: string): string[] {
  const known = new Set<string>(CONTACT_VARIABLES);
  return [...new Set([...text.matchAll(VARIABLE)].map((m) => m[1]!))].filter((v) => !known.has(v));
}

export function renderContactText(text: string, data: Record<ContactVariable, string | null>): string {
  return text
    .replace(VARIABLE, (_m, name: string, fallback?: string) => data[name as ContactVariable]?.trim() || fallback?.trim() || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/** GSM-7 text fits 160 characters per SMS (153 when split); anything else (Hindi, emoji) 70 (67). */
export function smsParts(text: string): { encoding: "GSM-7" | "Unicode"; characters: number; parts: number } {
  const gsm = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/.test(text);
  const extended = gsm ? (text.match(/[\^{}\\[~\]|€]/g) ?? []).length : 0;
  const characters = gsm ? text.length + extended : [...text].length;
  const [single, multi] = gsm ? [160, 153] : [70, 67];
  return { encoding: gsm ? "GSM-7" : "Unicode", characters, parts: characters === 0 ? 0 : characters <= single ? 1 : Math.ceil(characters / multi) };
}

export interface ContactTemplateInput {
  name: string;
  body: string;
}

export class ChannelTemplateService {
  constructor(private readonly repos: Repositories) {}

  private check(channel: ContactTemplateChannel, body: string) {
    const unknown = unknownContactVariables(body);
    if (unknown.length) {
      throw Errors.badRequest(`Unknown variable ${unknown.map((v) => `{{${v}}}`).join(", ")}. Available: ${CONTACT_VARIABLES.map((v) => `{{${v}}}`).join(" ")}`);
    }
    const noun = channel === "sms" ? "an SMS" : channel === "instagram" ? "an Instagram message" : "a LinkedIn message";
    if (body.length > BODY_LIMIT[channel]) throw Errors.badRequest(`At most ${BODY_LIMIT[channel]} characters for ${noun}`);
  }

  list(channel: ContactTemplateChannel) {
    return this.repos.templates.list(channel);
  }

  async get(id: string, channel?: ContactTemplateChannel): Promise<TemplateRecord & { channel: ContactTemplateChannel }> {
    const t = await this.repos.templates.findById(id);
    if (!t || (t.channel !== "sms" && t.channel !== "linkedin" && t.channel !== "instagram") || (channel && t.channel !== channel)) throw Errors.notFound("Template not found");
    return t as TemplateRecord & { channel: ContactTemplateChannel };
  }

  create(channel: ContactTemplateChannel, input: ContactTemplateInput) {
    this.check(channel, input.body);
    return this.repos.templates.create({ channel, name: input.name, subject: null, body: input.body });
  }

  async update(id: string, input: Partial<ContactTemplateInput>) {
    const current = await this.get(id);
    if (input.body !== undefined) this.check(current.channel, input.body);
    const updated = await this.repos.templates.update(id, input);
    if (!updated) throw Errors.notFound("Template not found");
    return updated;
  }

  async delete(id: string) {
    await this.get(id);
    if ((await this.repos.templates.countCampaigns(id)) > 0) {
      throw Errors.conflict("TEMPLATE_IN_USE", "This template is used by a campaign and cannot be deleted");
    }
    await this.repos.templates.delete(id);
  }

  async preview(channel: ContactTemplateChannel, body: string, contactId?: string) {
    this.check(channel, body);
    let contact: Pick<ContactRecord, "name" | "company" | "designation" | "email" | "phone"> = SAMPLE_CONTACT;
    let label = `${SAMPLE_CONTACT.name} (sample)`;
    if (contactId) {
      const found = await this.repos.contacts.findById(contactId);
      if (!found) throw Errors.notFound("Contact not found");
      contact = found;
      label = found.name;
    }
    const text = renderContactText(body, contactData(contact));
    return { contact: label, text, ...(channel === "sms" ? { sms: smsParts(text) } : {}), characters: text.length, limit: BODY_LIMIT[channel] };
  }
}

import type { Repositories, TemplateRecord } from "../../database/repositories/index.js";
import { Errors } from "../../utils/errors.js";
import { leadTemplateData, renderEmail, unknownVariables, TEMPLATE_VARIABLES, type RenderedEmail } from "./render.js";

export interface TemplateInput {
  name: string;
  subject: string;
  body: string;
}

/** Shown in previews when no lead is chosen. */
export const SAMPLE_LEAD = {
  name: "ERA University",
  category: "University",
  city: "Lucknow",
  state: "Uttar Pradesh",
  country: "India",
  website: "http://www.erauniversity.in/",
  phone: "+91 89579 26677",
};

function checkVariables(...texts: string[]) {
  const unknown = unknownVariables(...texts);
  if (unknown.length) {
    throw Errors.badRequest(`Unknown variable ${unknown.map((v) => `{{${v}}}`).join(", ")}. Available: ${TEMPLATE_VARIABLES.map((v) => `{{${v}}}`).join(" ")}`);
  }
}

export class TemplateService {
  constructor(private readonly repos: Repositories) {}

  list() {
    return this.repos.templates.list("email");
  }

  async get(id: string): Promise<TemplateRecord> {
    const t = await this.repos.templates.findById(id);
    if (!t || t.channel !== "email") throw Errors.notFound("Template not found");
    return t;
  }

  create(input: TemplateInput) {
    checkVariables(input.subject, input.body);
    return this.repos.templates.create({ channel: "email", name: input.name, subject: input.subject, body: input.body });
  }

  async update(id: string, input: Partial<TemplateInput>) {
    const current = await this.get(id);
    checkVariables(input.subject ?? current.subject ?? "", input.body ?? current.body);
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

  /** Renders a (possibly unsaved) template for one lead, or for sample data. */
  async preview(template: { subject: string; body: string }, leadId?: string): Promise<RenderedEmail & { lead: string }> {
    checkVariables(template.subject, template.body);
    let data = leadTemplateData(SAMPLE_LEAD);
    let label = `${SAMPLE_LEAD.name} (sample)`;
    if (leadId) {
      const lead = await this.repos.leads.findById(leadId);
      if (!lead) throw Errors.notFound("Lead not found");
      data = leadTemplateData(lead);
      label = lead.name;
    }
    return { ...renderEmail(template, data, { unsubscribeUrl: "https://example.com/u/preview" }), lead: label };
  }
}

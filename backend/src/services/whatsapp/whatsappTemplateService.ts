import type { Repositories, TemplateRecord } from "../../database/repositories/index.js";
import { Errors } from "../../utils/errors.js";
import { leadTemplateData, TEMPLATE_VARIABLES, unknownVariables } from "../email/render.js";
import { SAMPLE_LEAD } from "../email/templateService.js";
import { providerBody, renderWhatsApp, type ParamFormat } from "./templateParams.js";

export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "paused", "disabled"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export const TEMPLATE_CATEGORIES = ["marketing", "utility", "authentication"] as const;

export interface WhatsAppTemplateInput {
  /** The template name in WhatsApp Manager, e.g. "website_intro" */
  name: string;
  language: string;
  category: (typeof TEMPLATE_CATEGORIES)[number];
  paramFormat: ParamFormat;
  body: string;
  externalTemplateId?: string | null;
  approvalStatus: ApprovalStatus;
}

function checkBody(body: string) {
  const numbered = body.match(/\{\{\s*\d+\s*\}\}/);
  if (numbered) {
    throw Errors.badRequest(`Write a lead variable such as {{name}} where WhatsApp Manager shows ${numbered[0]}; the numbers are worked out from their order`);
  }
  const unknown = unknownVariables(body);
  if (unknown.length) {
    throw Errors.badRequest(`Unknown variable ${unknown.map((v) => `{{${v}}}`).join(", ")}. Available: ${TEMPLATE_VARIABLES.map((v) => `{{${v}}}`).join(" ")}`);
  }
}

export class WhatsAppTemplateService {
  constructor(
    private readonly repos: Repositories,
    private readonly providerName: string,
  ) {}

  list() {
    return this.repos.templates.list("whatsapp");
  }

  async get(id: string): Promise<TemplateRecord> {
    const t = await this.repos.templates.findById(id);
    if (!t || t.channel !== "whatsapp") throw Errors.notFound("Template not found");
    return t;
  }

  async create(input: WhatsAppTemplateInput) {
    checkBody(input.body);
    const created = await this.repos.templates.create({
      channel: "whatsapp",
      subject: null,
      provider: this.providerName,
      ...input,
      externalTemplateId: input.externalTemplateId ?? null,
    });
    await this.logStatus(created, null);
    return created;
  }

  async update(id: string, input: Partial<WhatsAppTemplateInput>) {
    const current = await this.get(id);
    if (input.body !== undefined) checkBody(input.body);
    const updated = await this.repos.templates.update(id, input);
    if (!updated) throw Errors.notFound("Template not found");
    await this.logStatus(updated, current.approvalStatus);
    return updated;
  }

  private async logStatus(t: TemplateRecord, before: string | null) {
    if (t.approvalStatus === before) return;
    await this.repos.agentLogs.create({
      jobId: null,
      action: "whatsapp_template_status",
      status: t.approvalStatus === "approved" ? "success" : "info",
      message: `"${t.name}" (${t.language}): ${before ?? "new"} → ${t.approvalStatus}`,
    });
  }

  async delete(id: string) {
    await this.get(id);
    if ((await this.repos.templates.countCampaigns(id)) > 0) {
      throw Errors.conflict("TEMPLATE_IN_USE", "This template is used by a campaign and cannot be deleted");
    }
    await this.repos.templates.delete(id);
  }

  /** The message for one lead (or sample data), plus the body as WhatsApp Manager must show it. */
  async preview(template: { body: string; paramFormat: ParamFormat }, leadId?: string) {
    checkBody(template.body);
    let data = leadTemplateData(SAMPLE_LEAD);
    let label = `${SAMPLE_LEAD.name} (sample)`;
    if (leadId) {
      const lead = await this.repos.leads.findById(leadId);
      if (!lead) throw Errors.notFound("Lead not found");
      data = leadTemplateData(lead);
      label = lead.name;
    }
    const rendered = renderWhatsApp(template, data);
    return { ...rendered, providerBody: providerBody(template.body, template.paramFormat), lead: label };
  }
}

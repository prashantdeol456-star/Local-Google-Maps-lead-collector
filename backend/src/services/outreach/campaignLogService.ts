// One view over every channel's campaigns and messages (email, WhatsApp, LinkedIn).

import type { AttemptStatus, Channel, Repositories } from "../../database/repositories/index.js";

export type LogChannel = Channel | "linkedin" | "instagram";

export interface CampaignSummary {
  id: string;
  channel: LogChannel;
  name: string;
  status: string;
  statusReason: string | null;
  mode: string | null;
  templateId: string;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  lastSentAt: Date | null;
  counts: Partial<Record<AttemptStatus, number>>;
  total: number;
}

const PER_CHANNEL = 100;

export class CampaignLogService {
  constructor(private readonly repos: Repositories) {}

  /** Newest campaigns of each channel with their message counts. */
  async campaigns(channel?: LogChannel): Promise<CampaignSummary[]> {
    const out: CampaignSummary[] = [];
    for (const ch of ["email", "whatsapp"] as const) {
      if (channel && channel !== ch) continue;
      const { items } = await this.repos.campaigns.list({ channel: ch, skip: 0, take: PER_CHANNEL });
      for (const c of items) {
        const counts = await this.repos.attempts.countByStatus(c.id);
        out.push({ ...pick(c), channel: ch, mode: null, counts, total: sum(counts) });
      }
    }
    if (!channel || channel === "linkedin" || channel === "instagram") {
      const { items } = await this.repos.linkedinOutreach.listCampaigns({ skip: 0, take: PER_CHANNEL, ...(channel ? { platform: channel } : {}) });
      for (const c of items) {
        const counts = await this.repos.linkedinOutreach.countByStatus(c.id);
        out.push({ ...pick(c), channel: c.platform === "instagram" ? "instagram" : "linkedin", mode: c.mode, counts, total: sum(counts) });
      }
    }
    return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  messages(query: { channel?: LogChannel; status?: AttemptStatus; campaignId?: string; q?: string; skip: number; take: number }) {
    return this.repos.campaignLogs.list(query);
  }

  events(take = 50) {
    return this.repos.campaignLogs.events(take);
  }
}

function pick(c: {
  id: string;
  name: string;
  status: string;
  statusReason: string | null;
  templateId: string;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  lastSentAt: Date | null;
}) {
  const { id, name, status, statusReason, templateId, createdAt, startedAt, completedAt, lastSentAt } = c;
  return { id, name, status, statusReason, templateId, createdAt, startedAt, completedAt, lastSentAt };
}

const sum = (counts: Partial<Record<string, number>>) => Object.values(counts).reduce<number>((a, b) => a + (b ?? 0), 0);

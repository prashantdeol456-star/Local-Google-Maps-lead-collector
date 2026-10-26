import type { DbClient, PrismaClient } from "../client.js";
import { PrismaAdminUserRepository } from "./prisma/PrismaAdminUserRepository.js";
import { PrismaAgentLogRepository } from "./prisma/PrismaAgentLogRepository.js";
import { PrismaApiTokenRepository } from "./prisma/PrismaApiTokenRepository.js";
import { PrismaJobItemRepository, PrismaJobRepository } from "./prisma/PrismaJobRepository.js";
import { PrismaLeadRepository } from "./prisma/PrismaLeadRepository.js";
import {
  PrismaAttemptRepository,
  PrismaCampaignRepository,
  PrismaEmailEventRepository,
  PrismaTrackedLinkRepository,
  PrismaPreferenceRepository,
  PrismaTemplateRepository,
  PrismaWhatsAppEventRepository,
  PrismaSuppressionRepository,
} from "./prisma/PrismaOutreachRepository.js";
import { PrismaLinkedInRepository } from "./prisma/PrismaLinkedInRepository.js";
import { PrismaCampaignLogRepository, PrismaContactRepository, PrismaLinkedInOutreachRepository } from "./prisma/PrismaContactOutreachRepository.js";
import { PrismaSessionRepository } from "./prisma/PrismaSessionRepository.js";
import { PrismaWebhookRepository } from "./prisma/PrismaWebhookRepository.js";
import type { Repositories } from "./types.js";

function build(db: DbClient, transaction: Repositories["transaction"]): Repositories {
  return {
    adminUsers: new PrismaAdminUserRepository(db),
    sessions: new PrismaSessionRepository(db),
    apiTokens: new PrismaApiTokenRepository(db),
    leads: new PrismaLeadRepository(db),
    jobs: new PrismaJobRepository(db),
    jobItems: new PrismaJobItemRepository(db),
    agentLogs: new PrismaAgentLogRepository(db),
    templates: new PrismaTemplateRepository(db),
    campaigns: new PrismaCampaignRepository(db),
    attempts: new PrismaAttemptRepository(db),
    preferences: new PrismaPreferenceRepository(db),
    emailEvents: new PrismaEmailEventRepository(db),
    trackedLinks: new PrismaTrackedLinkRepository(db),
    whatsappEvents: new PrismaWhatsAppEventRepository(db),
    suppressions: new PrismaSuppressionRepository(db),
    webhooks: new PrismaWebhookRepository(db),
    linkedinLeads: new PrismaLinkedInRepository(db),
    contacts: new PrismaContactRepository(db),
    linkedinOutreach: new PrismaLinkedInOutreachRepository(db),
    campaignLogs: new PrismaCampaignLogRepository(db),
    transaction,
  };
}

export function createRepositories(db: PrismaClient): Repositories {
  return build(db, (fn) =>
    db.$transaction((tx) => {
      // Inside a transaction, a nested transaction() call reuses the same one.
      const txRepos: Repositories = build(tx, (inner) => inner(txRepos));
      return fn(txRepos);
    }),
  );
}

export * from "./types.js";

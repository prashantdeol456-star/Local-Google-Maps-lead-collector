import type { Repositories } from "../database/repositories/index.js";
import { ownerScope } from "../database/ownerScope.js";
import { startOfDayInZone } from "../utils/time.js";

export class StatsService {
  constructor(
    private readonly repos: Repositories,
    private readonly timeZone: string,
  ) {}

  async get(now = new Date()) {
    const todayStart = startOfDayInZone(now, this.timeZone);
    const [totalLeads, todayLeads, totalDuplicates, totalCollections, completedJobs, activeJob, emailsSent, whatsappSent] = await Promise.all([
      this.repos.leads.count(),
      this.repos.leads.countCreatedSince(todayStart),
      this.repos.jobItems.countByResult("duplicate"),
      this.repos.jobs.count(),
      this.repos.jobs.count("completed"),
      this.repos.jobs.findLatestActive(),
      this.repos.attempts.countSentTotal("email"),
      this.repos.attempts.countSentTotal("whatsapp"),
    ]);
    // Campaigns are not separated per user yet: a customer sees no sending totals.
    const customer = ownerScope.getStore()?.customer === true;
    return {
      totalLeads,
      todayLeads,
      totalDuplicates,
      totalCollections,
      completedJobs,
      activeJob,
      emailsSent: customer ? 0 : emailsSent,
      whatsappSent: customer ? 0 : whatsappSent,
      timeZone: this.timeZone,
      todayStartsAt: todayStart,
    };
  }
}

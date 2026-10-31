import type { DbClient } from "../../client.js";
import type { SessionRepository } from "../types.js";

export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly db: DbClient) {}

  create(data: { tokenHash: string; userId: string; expiresAt: Date }) {
    return this.db.session.create({ data });
  }

  findByTokenHash(tokenHash: string) {
    return this.db.session.findUnique({ where: { tokenHash } });
  }

  async deleteByTokenHash(tokenHash: string) {
    await this.db.session.deleteMany({ where: { tokenHash } });
  }

  async deleteExpired(now: Date) {
    const { count } = await this.db.session.deleteMany({ where: { expiresAt: { lt: now } } });
    return count;
  }

  async deleteByUser(userId: string) {
    const { count } = await this.db.session.deleteMany({ where: { userId } });
    return count;
  }
}

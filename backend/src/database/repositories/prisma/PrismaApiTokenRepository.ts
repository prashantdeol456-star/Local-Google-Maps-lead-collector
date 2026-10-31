import type { DbClient } from "../../client.js";
import type { ApiTokenRepository } from "../types.js";

export class PrismaApiTokenRepository implements ApiTokenRepository {
  constructor(private readonly db: DbClient) {}

  create(data: { name: string; prefix: string; tokenHash: string; userId: string; expiresAt: Date | null; scope?: string }) {
    return this.db.apiToken.create({ data });
  }

  findByTokenHash(tokenHash: string) {
    return this.db.apiToken.findUnique({ where: { tokenHash } });
  }

  listActiveByUser(userId: string, now: Date) {
    return this.db.apiToken.findMany({
      where: { userId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      orderBy: { createdAt: "desc" },
    });
  }

  async revoke(id: string, userId: string, at: Date) {
    const { count } = await this.db.apiToken.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: at },
    });
    return count > 0;
  }

  async touchLastUsed(id: string, at: Date) {
    await this.db.apiToken.update({ where: { id }, data: { lastUsedAt: at } });
  }

  async revokeAllByUser(userId: string, at: Date) {
    const { count } = await this.db.apiToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: at } });
    return count;
  }
}

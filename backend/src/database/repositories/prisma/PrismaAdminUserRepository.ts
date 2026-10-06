import type { DbClient } from "../../client.js";
import type { AdminUserRepository } from "../types.js";

export class PrismaAdminUserRepository implements AdminUserRepository {
  constructor(private readonly db: DbClient) {}

  count() {
    return this.db.adminUser.count();
  }

  findByEmail(email: string) {
    return this.db.adminUser.findUnique({ where: { email } });
  }

  findById(id: string) {
    return this.db.adminUser.findUnique({ where: { id } });
  }

  create(data: { email: string; name?: string | null; passwordHash: string }) {
    return this.db.adminUser.create({ data });
  }

  async touchLastLogin(id: string, at: Date) {
    await this.db.adminUser.update({ where: { id }, data: { lastLoginAt: at } });
  }
}

import { containsInsensitive, type DbClient } from "../../client.js";
import type { AdminUserRecord, AdminUserRepository, UserRole, UserStatus } from "../types.js";

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

  findByUsername(username: string) {
    return this.db.adminUser.findUnique({ where: { username } });
  }

  create(data: Parameters<AdminUserRepository["create"]>[0]) {
    return this.db.adminUser.create({ data });
  }

  async touchLastLogin(id: string, at: Date) {
    await this.db.adminUser.update({ where: { id }, data: { lastLoginAt: at } });
  }

  list(query: { status?: UserStatus; q?: string }) {
    return this.db.adminUser.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.q
          ? { OR: [{ email: containsInsensitive(query.q) }, { username: containsInsensitive(query.q) }, { phone: containsInsensitive(query.q) }, { name: containsInsensitive(query.q) }] }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
  }

  update(id: string, data: Partial<Pick<AdminUserRecord, "status" | "approvedAt" | "passwordHash" | "name" | "phone">>) {
    return this.db.adminUser.update({ where: { id }, data });
  }

  countByRole(role: UserRole, status?: UserStatus) {
    return this.db.adminUser.count({ where: { role, ...(status ? { status } : {}) } });
  }
}

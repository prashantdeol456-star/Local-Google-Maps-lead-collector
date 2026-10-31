import type { AdminUserRecord, Repositories, UserStatus } from "../../database/repositories/index.js";
import { Errors } from "../../utils/errors.js";
import { hashPassword } from "./password.js";

// User accounts: public registration (waits for approval) and management by super admins.

export const MIN_PASSWORD_LENGTH = 10;
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export interface PublicUser {
  id: string;
  email: string;
  username: string | null;
  phone: string | null;
  name: string | null;
  role: string;
  status: string;
  approvedAt: Date | null;
  createdAt: Date;
  lastLoginAt: Date | null;
}

export function toPublicUser(u: AdminUserRecord): PublicUser {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    phone: u.phone,
    name: u.name,
    role: u.role,
    status: u.status,
    approvedAt: u.approvedAt,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
  };
}

export interface RegistrationInput {
  email: string;
  phone: string;
  username: string;
  password: string;
  name?: string | null;
}

export class UserService {
  constructor(private readonly repos: Repositories) {}

  /** Creates a customer account in "pending" status; a super admin must approve it. */
  async register(input: RegistrationInput): Promise<PublicUser> {
    const email = input.email.trim().toLowerCase();
    const username = input.username.trim().toLowerCase();
    if (!USERNAME_PATTERN.test(username)) {
      throw Errors.badRequest("User id: 3–32 characters, letters, digits, dot, dash or underscore, starting with a letter or digit");
    }
    if (input.password.length < MIN_PASSWORD_LENGTH) throw Errors.badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    if (await this.repos.adminUsers.findByEmail(email)) throw Errors.conflict("EMAIL_TAKEN", "An account with this email already exists");
    if (await this.repos.adminUsers.findByUsername(username)) throw Errors.conflict("USERNAME_TAKEN", "This user id is already taken");
    const user = await this.repos.adminUsers.create({
      email,
      username,
      phone: input.phone.trim(),
      name: input.name?.trim() || null,
      passwordHash: await hashPassword(input.password),
      role: "customer",
      status: "pending",
    });
    return toPublicUser(user);
  }

  async list(query: { status?: UserStatus; q?: string }) {
    const users = (await this.repos.adminUsers.list(query)).map(toPublicUser);
    const pending = await this.repos.adminUsers.list({ status: "pending" });
    return { items: users, pendingCount: pending.length };
  }

  private async get(id: string) {
    const user = await this.repos.adminUsers.findById(id);
    if (!user) throw Errors.notFound("User not found");
    return user;
  }

  /** Signs the user out everywhere (admin panel sessions and extension tokens). */
  private async signOut(id: string) {
    await this.repos.sessions.deleteByUser(id);
    await this.repos.apiTokens.revokeAllByUser(id, new Date());
  }

  async approve(id: string) {
    const user = await this.get(id);
    if (user.status === "active") return toPublicUser(user);
    return toPublicUser(await this.repos.adminUsers.update(id, { status: "active", approvedAt: user.approvedAt ?? new Date() }));
  }

  async disable(id: string, actingUserId: string) {
    const user = await this.get(id);
    if (id === actingUserId) throw Errors.badRequest("You cannot disable your own account");
    if (user.role === "super_admin" && (await this.repos.adminUsers.countByRole("super_admin", "active")) <= 1) {
      throw Errors.badRequest("The last active super admin cannot be disabled");
    }
    const updated = await this.repos.adminUsers.update(id, { status: "disabled" });
    await this.signOut(id);
    return toPublicUser(updated);
  }

  async enable(id: string) {
    await this.get(id);
    return toPublicUser(await this.repos.adminUsers.update(id, { status: "active" }));
  }

  /** Sets a new password and signs the user out everywhere. */
  async resetPassword(id: string, password: string) {
    await this.get(id);
    if (password.length < MIN_PASSWORD_LENGTH) throw Errors.badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    const updated = await this.repos.adminUsers.update(id, { passwordHash: await hashPassword(password) });
    await this.signOut(id);
    return toPublicUser(updated);
  }
}

import bcrypt from "bcryptjs";

const ROUNDS = 12;

// Compared against when the email does not exist, so response time
// does not reveal whether an account exists.
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", ROUNDS);

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export function verifyPassword(plain: string, hash: string | null): Promise<boolean> {
  return bcrypt.compare(plain, hash ?? DUMMY_HASH);
}

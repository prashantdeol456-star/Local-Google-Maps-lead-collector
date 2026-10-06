// Encrypts secrets the backend must be able to read back (e.g. webhook signing secrets)
// before they are stored in the database. AES-256-GCM with a key derived (HKDF) from
// SESSION_SECRET, so no extra setting is needed. If SESSION_SECRET changes, stored secrets
// can no longer be read and have to be rotated.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const VERSION = "v1";

export class SecretBox {
  private readonly key: Buffer;

  constructor(masterSecret: string, purpose: string) {
    this.key = Buffer.from(hkdfSync("sha256", masterSecret, "lead-platform", purpose, 32));
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
  }

  /** Throws if the value was changed or sealed with another key. */
  open(sealed: string): string {
    const [version, iv, tag, data] = sealed.split(".");
    if (version !== VERSION || !iv || !tag || data === undefined) throw new Error("Unknown secret format");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  }
}

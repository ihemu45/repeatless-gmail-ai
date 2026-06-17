import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { env } from "./env";

/**
 * AES-256-GCM encryption for data at rest.
 *
 * Used to protect Google OAuth refresh tokens before they are stored in
 * Supabase. Even with read access to the database, a refresh token is useless
 * without ENCRYPTION_KEY. The stored format is:
 *
 *     base64(iv).base64(authTag).base64(ciphertext)
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM standard nonce length

function getKey(): Buffer {
  const key = Buffer.from(env.encryptionKey, "base64");
  if (key.length !== 32) {
    throw new Error(
      "ENCRYPTION_KEY must decode to exactly 32 bytes. " +
        "Generate one with: openssl rand -base64 32",
    );
  }
  return key;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64"),
  ].join(".");
}

const AUTH_TAG_LENGTH = 16; // GCM tag is 128 bits

export function decrypt(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed encrypted payload");
  }
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  // Reject truncated IV/tag: a short GCM tag weakens forgery resistance, so we
  // refuse to even attempt decryption with one.
  if (iv.length !== IV_LENGTH) {
    throw new Error("Malformed encrypted payload: bad IV length");
  }
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error("Malformed encrypted payload: bad auth tag length");
  }
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

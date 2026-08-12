import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM envelope encryption under an environment master key.
 *
 * This is the interim stand-in for the CMEK-per-tenant control in datastore
 * §12.3, because Garage has no KMS integration and data model open question 1
 * has not yet chosen between pgcrypto and GCP KMS. Sealed values live in
 * Postgres; the master key does not, so a database dump alone does not open
 * them. Replacing the key lookup below with a KMS decrypt call is the intended
 * follow-up.
 *
 * Layout: [12-byte iv][16-byte auth tag][ciphertext]
 */
const IV_BYTES = 12;
const TAG_BYTES = 16;

function masterKey(): Buffer {
  const hex = process.env.SNAPSHOT_MASTER_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("SNAPSHOT_MASTER_KEY must be 64 hex characters (32 bytes)");
  }
  return Buffer.from(hex, "hex");
}

export function sealSecret(plaintext: string | Uint8Array): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const body = Buffer.concat([
    cipher.update(
      typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : Buffer.from(plaintext),
    ),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function openSecret(sealed: Uint8Array): Buffer {
  const buf = Buffer.from(sealed);
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), buf.subarray(0, IV_BYTES));
  decipher.setAuthTag(buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  // GCM authentication means a tampered ciphertext throws here rather than
  // decrypting to plausible garbage.
  return Buffer.concat([decipher.update(buf.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
}

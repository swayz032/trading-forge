import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

export type EncryptedBrokerCredential = {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
};

function masterKey(): Buffer {
  const raw = process.env.BROKER_CREDENTIAL_MASTER_KEY?.trim();
  if (raw) {
    const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
    if (key.length !== 32) throw new Error("broker credential vault key must be 32 bytes");
    return key;
  }
  // Stable, domain-separated fallback for existing Slumhouse deployments. This never uses the
  // session secret directly as an encryption key; HKDF derives an independent 256-bit key.
  const sessionSecret = process.env.SLUMHOUSE_SESSION_SECRET;
  if (!sessionSecret || sessionSecret.length < 32) throw new Error("broker credential vault unavailable");
  return Buffer.from(hkdfSync(
    "sha256", Buffer.from(sessionSecret, "utf8"),
    Buffer.from("trading-forge-broker-vault-v1", "utf8"),
    Buffer.from("member-broker-credential", "utf8"), 32,
  ));
}

export function brokerCredentialVaultReady(): boolean {
  try { masterKey(); return true; } catch { return false; }
}

export function encryptBrokerCredential(plaintext: string): EncryptedBrokerCredential {
  if (typeof plaintext !== "string" || plaintext.length < 16 || plaintext.length > 4096) {
    throw new Error("invalid broker credential length");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: 1,
  };
}

export function decryptBrokerCredential(row: EncryptedBrokerCredential): string {
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(row.iv, "base64"));
  decipher.setAuthTag(Buffer.from(row.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(row.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

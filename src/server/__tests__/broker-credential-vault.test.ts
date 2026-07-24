import { afterEach, describe, expect, it } from "vitest";
import {
  brokerCredentialVaultReady,
  decryptBrokerCredential,
  encryptBrokerCredential,
} from "../lib/broker-credential-vault.js";

const oldMaster = process.env.BROKER_CREDENTIAL_MASTER_KEY;
const oldSession = process.env.SLUMHOUSE_SESSION_SECRET;
afterEach(() => {
  if (oldMaster === undefined) delete process.env.BROKER_CREDENTIAL_MASTER_KEY;
  else process.env.BROKER_CREDENTIAL_MASTER_KEY = oldMaster;
  if (oldSession === undefined) delete process.env.SLUMHOUSE_SESSION_SECRET;
  else process.env.SLUMHOUSE_SESSION_SECRET = oldSession;
});

describe("broker credential vault", () => {
  it("round-trips with authenticated encryption without storing plaintext", () => {
    process.env.BROKER_CREDENTIAL_MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
    const secret = "real-looking-secret-material-123";
    const encrypted = encryptBrokerCredential(secret);
    expect(encrypted.ciphertext).not.toContain(secret);
    expect(decryptBrokerCredential(encrypted)).toBe(secret);
  });

  it("detects tampering", () => {
    process.env.BROKER_CREDENTIAL_MASTER_KEY = Buffer.alloc(32, 9).toString("base64");
    const encrypted = encryptBrokerCredential("credential-material-456");
    encrypted.authTag = Buffer.alloc(16).toString("base64");
    expect(() => decryptBrokerCredential(encrypted)).toThrow();
  });

  it("derives a separate stable key from an existing strong session secret", () => {
    delete process.env.BROKER_CREDENTIAL_MASTER_KEY;
    process.env.SLUMHOUSE_SESSION_SECRET = "a-strong-existing-session-secret-0123456789";
    expect(brokerCredentialVaultReady()).toBe(true);
    const encrypted = encryptBrokerCredential("credential-material-789");
    expect(decryptBrokerCredential(encrypted)).toBe("credential-material-789");
  });

  it("fails closed with no suitable deployment secret", () => {
    delete process.env.BROKER_CREDENTIAL_MASTER_KEY;
    delete process.env.SLUMHOUSE_SESSION_SECRET;
    expect(brokerCredentialVaultReady()).toBe(false);
    expect(() => encryptBrokerCredential("credential-material-000")).toThrow(/unavailable/);
  });
});

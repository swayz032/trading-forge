/**
 * Deep-scan #7 fix wave — A7 (M4 partial): optional S3_BACKUP_BUCKET override
 * for the nightly DB backup (blast-radius isolation from the data-lake bucket).
 *
 * Contract: when S3_BACKUP_BUCKET is set, backups target that bucket; when
 * unset, behavior falls back to S3_BUCKET unchanged.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../db/index.js", () => ({
  db: {
    insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) })),
  },
  client: { end: vi.fn() },
}));
vi.mock("../services/notification-service.js", () => ({
  notifyCritical: vi.fn(),
  notifyWarning: vi.fn(),
  notifyInfo: vi.fn(),
}));

import { getBackupBucket, isOfftowerConfigured } from "../services/db-backup-service.js";

const ENV_KEYS = ["S3_BACKUP_BUCKET", "S3_BUCKET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "DB_BACKUP_OFFTOWER_TARGET"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("A7 — getBackupBucket", () => {
  it("prefers S3_BACKUP_BUCKET when set (even with S3_BUCKET also set)", () => {
    process.env["S3_BACKUP_BUCKET"] = "tf-backups-isolated";
    process.env["S3_BUCKET"] = "tf-data-lake";
    expect(getBackupBucket()).toBe("tf-backups-isolated");
  });

  it("falls back to S3_BUCKET unchanged when S3_BACKUP_BUCKET is unset", () => {
    process.env["S3_BUCKET"] = "tf-data-lake";
    expect(getBackupBucket()).toBe("tf-data-lake");
  });

  it("empty-string S3_BACKUP_BUCKET falls back to S3_BUCKET (no accidental empty bucket)", () => {
    process.env["S3_BACKUP_BUCKET"] = "";
    process.env["S3_BUCKET"] = "tf-data-lake";
    expect(getBackupBucket()).toBe("tf-data-lake");
  });

  it("returns undefined when neither is set", () => {
    expect(getBackupBucket()).toBeUndefined();
  });
});

describe("A7 — isOfftowerConfigured with the backup bucket", () => {
  it("true with only S3_BACKUP_BUCKET + AWS creds (no S3_BUCKET needed)", () => {
    process.env["S3_BACKUP_BUCKET"] = "tf-backups-isolated";
    process.env["AWS_ACCESS_KEY_ID"] = "AKIA_TEST";
    process.env["AWS_SECRET_ACCESS_KEY"] = "secret";
    expect(isOfftowerConfigured()).toBe(true);
  });

  it("true with legacy S3_BUCKET + creds (backward compat unchanged)", () => {
    process.env["S3_BUCKET"] = "tf-data-lake";
    process.env["AWS_ACCESS_KEY_ID"] = "AKIA_TEST";
    process.env["AWS_SECRET_ACCESS_KEY"] = "secret";
    expect(isOfftowerConfigured()).toBe(true);
  });

  it("false when no bucket is configured at all", () => {
    process.env["AWS_ACCESS_KEY_ID"] = "AKIA_TEST";
    process.env["AWS_SECRET_ACCESS_KEY"] = "secret";
    expect(isOfftowerConfigured()).toBe(false);
  });

  it("false when creds are missing even with a bucket", () => {
    process.env["S3_BACKUP_BUCKET"] = "tf-backups-isolated";
    expect(isOfftowerConfigured()).toBe(false);
  });
});

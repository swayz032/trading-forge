/**
 * Wave 11 (2026-05-17) — n8n schema backup regression.
 *
 * Pins three invariants of scripts/backup-n8n-data.mjs:
 *   1. The backup module exports `runBackup` (scheduler imports it dynamically).
 *   2. The recovery-essential table list covers the entities that disappeared
 *      in the Wave 9 incident (workflows, credentials, users, RBAC).
 *   3. Filename pattern matches the rotation regex so old backups get pruned.
 *
 * Defense-in-depth: if these break, the daily backup silently no-ops and the
 * next destructive incident has nothing to restore from.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const SCRIPT_PATH = path.resolve(process.cwd(), "scripts/backup-n8n-data.mjs");

describe("Wave 11 — n8n data backup", () => {
  const source = fs.readFileSync(SCRIPT_PATH, "utf-8");

  it("exports runBackup", () => {
    expect(source).toMatch(/export\s+async\s+function\s+runBackup/);
  });

  it.each([
    "user",
    "user_api_keys",
    "settings",
    "credentials_entity",
    "workflow_entity",
    "shared_workflow",
    "shared_credentials",
    "webhook_entity",
    "project",
    "role",
  ])("recovery-essential table '%s' is in the backup table list", (table) => {
    const match = source.match(/const TABLES = \[([\s\S]+?)\];/);
    expect(match, "TABLES constant not found").toBeTruthy();
    const inside = match![1];
    const tables = Array.from(inside.matchAll(/"([^"]+)"/g)).map((m) => m[1]);
    expect(tables).toContain(table);
  });

  it("filename pattern in script matches rotation regex", () => {
    const filenamePattern = /n8n-data-\$\{isoDate\(\)\}\.json\.gz/;
    expect(source).toMatch(filenamePattern);
    const rotationRegex = /\/\^n8n-data-\\d\{4\}-\\d\{2\}-\\d\{2\}\\\.json\\\.gz\$\//;
    expect(source).toMatch(rotationRegex);
  });

  it("retention is 14 days", () => {
    expect(source).toMatch(/const RETENTION_DAYS = 14/);
  });
});

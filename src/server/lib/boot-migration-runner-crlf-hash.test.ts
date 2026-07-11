import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// Regression test for the 2026-07-09 incident: boot-migration-runner's hash
// function (via readUtf8StripBom) was sensitive to CRLF vs LF line endings.
// This tower's git checkout has core.autocrlf=true, which silently converts
// LF (git's canonical stored form) to CRLF on disk. A migration's tracked
// hash in drizzle.__drizzle_migrations was stamped from LF content; reading
// the CRLF on-disk file produced a DIFFERENT hash, so the runner concluded
// the migration was never applied and tried to re-run it — colliding with
// tables the ORIGINAL apply already created ("relation already exists" on
// 0000_previous_nuke.sql → fail-closed boot → NSSM crash-loop, ~9000
// restarts, unrate-limited Discord CRITICAL spam).
//
// readUtf8StripBom is a pure fs.readFileSync wrapper — testing it directly
// against real temp files (not mocked) is both simpler and more faithful
// than mocking fs for a bug that is specifically about byte-level content.
// Importing the module still transitively pulls in db/index.ts (throws
// without DATABASE_URL) and logger.ts — mock both, neither is exercised here.
vi.mock("../db/index.js", () => ({ db: {} }));
vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { readUtf8StripBom } = await import("./boot-migration-runner.js");

describe("readUtf8StripBom — CRLF/LF hash-stability regression", () => {
  const tmpFiles: string[] = [];

  afterEach(() => {
    for (const f of tmpFiles) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* already gone */
      }
    }
    tmpFiles.length = 0;
  });

  function writeTemp(name: string, content: Buffer): string {
    const p = path.join(os.tmpdir(), `${name}-${crypto.randomUUID()}.sql`);
    fs.writeFileSync(p, content);
    tmpFiles.push(p);
    return p;
  }

  it("produces IDENTICAL content (and hash) for CRLF vs LF versions of the same SQL", () => {
    const lfContent = 'CREATE TABLE "alerts" (\n  "id" uuid PRIMARY KEY\n);\n';
    const crlfContent = lfContent.replace(/\n/g, "\r\n");

    const lfPath = writeTemp("lf", Buffer.from(lfContent, "utf8"));
    const crlfPath = writeTemp("crlf", Buffer.from(crlfContent, "utf8"));

    const lfRead = readUtf8StripBom(lfPath);
    const crlfRead = readUtf8StripBom(crlfPath);

    expect(crlfRead).toBe(lfRead);

    const lfHash = crypto.createHash("sha256").update(lfRead).digest("hex");
    const crlfHash = crypto.createHash("sha256").update(crlfRead).digest("hex");
    expect(crlfHash).toBe(lfHash);
  });

  it("reproduces the exact incident: a raw sha256 of CRLF bytes differs from LF, but readUtf8StripBom output does not", () => {
    const lfContent = 'CREATE TABLE "alerts" (\n  "id" uuid PRIMARY KEY\n);\n';
    const crlfContent = lfContent.replace(/\n/g, "\r\n");

    // Prove the bug would exist WITHOUT normalization (raw byte hash on disk).
    const rawLfHash = crypto.createHash("sha256").update(Buffer.from(lfContent, "utf8")).digest("hex");
    const rawCrlfHash = crypto
      .createHash("sha256")
      .update(Buffer.from(crlfContent, "utf8"))
      .digest("hex");
    expect(rawCrlfHash).not.toBe(rawLfHash); // the raw-byte mismatch that caused the incident

    // Prove readUtf8StripBom closes it.
    const crlfPath = writeTemp("crlf2", Buffer.from(crlfContent, "utf8"));
    const normalizedHash = crypto
      .createHash("sha256")
      .update(readUtf8StripBom(crlfPath))
      .digest("hex");
    expect(normalizedHash).toBe(rawLfHash);
  });

  it("still strips a leading BOM (existing behavior preserved)", () => {
    const content = "﻿" + 'CREATE TABLE "x" ();\r\n';
    const p = writeTemp("bom", Buffer.from(content, "utf8"));
    const result = readUtf8StripBom(p);
    expect(result.charCodeAt(0)).not.toBe(0xfeff);
    expect(result).toBe('CREATE TABLE "x" ();\n');
  });

  it("matches the live incident file's known tracked hash after normalization", () => {
    // The exact migration + hash from the 2026-07-09 production incident.
    const migrationPath = path.join(
      process.cwd(),
      "src/server/db/migrations/0000_previous_nuke.sql",
    );
    if (!fs.existsSync(migrationPath)) return; // defensive — path may differ in CI checkout
    const normalized = readUtf8StripBom(migrationPath);
    const hash = crypto.createHash("sha256").update(normalized).digest("hex");
    // The hash tracked in drizzle.__drizzle_migrations for this migration's
    // journal `when` (1773101512065), verified live 2026-07-09.
    expect(hash).toBe("0a984566447c25a4efdc0d5d6603f133e3a57e911161814f926cbb1b8888bf3e");
  });
});

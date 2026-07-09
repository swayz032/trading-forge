// deepscan15 C1: the boot-migration runner's `JSON.parse(_journal.json)` was
// unguarded — a corrupt journal (bad merge / partial write / rebase conflict
// markers) threw a raw SyntaxError BEFORE any Discord/audit/crash-loop
// escalation could fire, silently bricking the API in an NSSM respawn loop with
// zero operator signal (a 30-day-vacation dark-bot class). This covers the new
// `readJournalOrAlert` guard: valid JSON parses; corrupt JSON fires a CRITICAL
// alert + audit row + crash-loop escalation, THEN rethrows (fail-closed boot).
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATABASE_URL ||= "postgres://ci:ci@localhost:5432/ci_deepscan15";

let readJournalOrAlert: (
  journalPath: string,
  correlationId: string,
  deps?: {
    notify?: (title: string, message: string) => Promise<void>;
    audit?: (row: Record<string, unknown>) => Promise<void>;
    incrementFailure?: () => number;
  },
) => Promise<{ entries: Array<{ idx: number; tag: string }> }>;

beforeAll(async () => {
  ({ readJournalOrAlert } = await import("../lib/boot-migration-runner.js"));
});

function writeJournal(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ds15-journal-"));
  const p = path.join(dir, "_journal.json");
  fs.writeFileSync(p, contents, "utf8");
  return p;
}

describe("deepscan15 C1 — boot-migration journal parse guard", () => {
  it("returns the parsed journal for valid JSON", async () => {
    const p = writeJournal(
      '{"version":"7","dialect":"postgresql","entries":[{"idx":1,"version":"7","when":1,"tag":"0001_x","breakpoints":true}]}',
    );
    const journal = await readJournalOrAlert(p, "cid-valid");
    expect(journal.entries).toHaveLength(1);
    expect(journal.entries[0].tag).toBe("0001_x");
  });

  it("fires a CRITICAL alert + audit row and rethrows on a corrupt journal (no silent crash-loop)", async () => {
    // e.g. an unresolved rebase left `<<<<<<< HEAD` markers inside the JSON
    const p = writeJournal('{ "entries": [ <<<<<<< HEAD not valid json ');
    const notified: Array<[string, string]> = [];
    const audited: Array<Record<string, unknown>> = [];

    await expect(
      readJournalOrAlert(p, "cid-corrupt", {
        notify: async (title, message) => {
          notified.push([title, message]);
        },
        audit: async (row) => {
          audited.push(row);
        },
        incrementFailure: () => 1, // attempt 1 → escalation cadence fires
      }),
    ).rejects.toThrow(/journal/i);

    // At least one CRITICAL alert fired BEFORE the rethrow (the whole point).
    expect(notified.length).toBeGreaterThanOrEqual(1);
    expect(notified.some(([title]) => /journal|boot blocked/i.test(title))).toBe(true);
    // An audit row was written so the failure is reconstructable post-incident.
    expect(audited.some((r) => r.action === "migration.journal_parse_failed")).toBe(true);
  });

  // Deep-scan #16 E-5: the raw file READ (as opposed to the JSON.parse above)
  // used to sit OUTSIDE any try/catch — a TOCTOU race (file removed/replaced
  // after runPendingMigrations' existsSync check), an AV-scanner lock, or a
  // permissions error propagated straight past this function's alerting and
  // crash-looped the boot with zero Discord/audit signal. Passing a directory
  // path (instead of a file) reliably reproduces a file-I/O read failure
  // (EISDIR) cross-platform without needing real file-lock races.
  it("fires a CRITICAL alert + audit row and rethrows when the journal file itself cannot be READ (not just parsed)", async () => {
    const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), "ds16-e5-journal-unreadable-"));
    const notified: Array<[string, string]> = [];
    const audited: Array<Record<string, unknown>> = [];

    await expect(
      // Pass the directory itself as the "journal path" — reading a directory
      // as a file throws (EISDIR), simulating the file-read failure class.
      readJournalOrAlert(dirPath, "cid-unreadable", {
        notify: async (title, message) => {
          notified.push([title, message]);
        },
        audit: async (row) => {
          audited.push(row);
        },
        incrementFailure: () => 1,
      }),
    ).rejects.toThrow(/journal/i);

    expect(notified.length).toBeGreaterThanOrEqual(1);
    expect(notified.some(([title]) => /journal|boot blocked/i.test(title))).toBe(true);
    // Same audit action as the parse-failure branch — both are "we could not
    // determine the pending migration set" failures, reconstructable via one
    // audit-action query regardless of which phase (read vs parse) failed.
    expect(audited.some((r) => r.action === "migration.journal_parse_failed" && r.input && (r.input as Record<string, unknown>)["phase"] === "file_read")).toBe(true);
  });
});

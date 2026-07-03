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
});

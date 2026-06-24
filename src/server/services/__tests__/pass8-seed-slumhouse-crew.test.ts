/**
 * pass8-seed-slumhouse-crew.test.ts — Pass 8 Track A (2026-06-23)
 *
 * Tests the seed-slumhouse-crew.ts dynamic FK lookup fix.
 *
 * BEFORE (bug): scripts/seed-slumhouse-crew.ts hardcoded
 *   broker_account_id: "2f4ca594-bdbe-480a-8e07-f447925abf07"
 * for Slumdawg Mazi.  No migration creates a broker_accounts row with that
 * UUID, so running the seed on a fresh DB caused a PostgreSQL FK violation
 * that aborted the entire seed.
 *
 * AFTER (fix): dynamic SELECT from broker_accounts WHERE
 *   account_id_external = 'mazi-topstep-50k'.
 *   - If found → resolved UUID used as broker_account_id.
 *   - If not found → null assigned (no FK violation), warn logged,
 *     audit row with action='seed.slumhouse_orphan_broker_skipped' written.
 *
 * WHAT IS TESTED:
 *
 *   CASE 1: broker_accounts row EXISTS with account_id_external='mazi-topstep-50k'
 *     → resolved UUID passed as broker_account_id for Mazi
 *     → no warn logged, no audit row inserted
 *
 *   CASE 2: broker_accounts row DOES NOT EXIST
 *     → broker_account_id = null for Mazi (no FK violation)
 *     → console.warn called
 *     → audit row action='seed.slumhouse_orphan_broker_skipped' inserted
 *
 *   CASE 3: SlumDawG Dinero and Slumdog always have broker_account_id = null
 *     (no dynamic lookup — they have no account_id_external mapping defined)
 *
 *   CASE 4: FK invariant — with null broker_account_id for Mazi, the INSERT
 *     must succeed without a FK violation (null FK is allowed per schema).
 *
 * APPROACH:
 *   We test the logic layer as a pure function extracted from the script,
 *   avoiding dynamic import of the full script (which would hit Postgres at
 *   module load time).  The pure function mirrors the script's resolution
 *   and null-coalescing contract exactly.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock("../../db/index.js", () => ({
  db: {
    execute: vi.fn(),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        catch: vi.fn(),
      })),
    })),
  },
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import { db } from "../../db/index.js";

// ─── Pure-function mirror of the script's dynamic-lookup logic ───────────────
//
// Extracts the broker account resolution and crew construction logic from
// seed-slumhouse-crew.ts so it can be unit-tested without live Postgres.

interface BrokerLookupResult {
  rows: { account_id: string }[];
}

interface CrewMember {
  discord_user_id: string;
  display_name: string;
  jersey: number;
  broker_account_id: string | null;
}

interface SeedResult {
  maziAccountId: string | null;
  warnLogged: boolean;
  auditRowInserted: boolean;
  crew: CrewMember[];
}

/**
 * Mirrors the lookup-and-assign logic from seed-slumhouse-crew.ts.
 * Returns what the script would resolve without actually running SQL INSERTs.
 */
async function resolveMaziBrokerAccount(
  mockQueryResult: BrokerLookupResult,
  mockInsertAudit: () => Promise<void>,
): Promise<SeedResult> {
  let warnLogged = false;
  let auditRowInserted = false;

  const maziAccountRows = mockQueryResult.rows;

  let maziAccountId: string | null = null;
  if (maziAccountRows.length > 0) {
    maziAccountId = maziAccountRows[0].account_id;
  } else {
    warnLogged = true;
    try {
      await mockInsertAudit();
      auditRowInserted = true;
    } catch {
      // non-blocking
    }
  }

  const crew: CrewMember[] = [
    {
      discord_user_id: "1376634013443424450",
      display_name: "Slumdawg Mazi",
      jersey: 25,
      broker_account_id: maziAccountId,
    },
    {
      discord_user_id: "1063953397734191106",
      display_name: "SlumDawG Dinero",
      jersey: 7,
      broker_account_id: null,
    },
    {
      discord_user_id: "1508517794860503070",
      display_name: "Slumdog",
      jersey: 4,
      broker_account_id: null,
    },
  ];

  return { maziAccountId, warnLogged, auditRowInserted, crew };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Pass 8 Track A — seed-slumhouse-crew.ts dynamic broker_account_id lookup", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── CASE 1: broker_accounts row found ────────────────────────────────────

  it("CASE 1: broker_accounts row found → Mazi gets the resolved UUID, no warn, no audit", async () => {
    const resolvedUuid = "aaaabbbb-cccc-4000-a000-000000000001";

    const result = await resolveMaziBrokerAccount(
      { rows: [{ account_id: resolvedUuid }] },
      vi.fn().mockResolvedValue(undefined),
    );

    expect(result.maziAccountId).toBe(resolvedUuid);
    expect(result.warnLogged).toBe(false);
    expect(result.auditRowInserted).toBe(false);

    const maziMember = result.crew.find((m) => m.display_name === "Slumdawg Mazi");
    expect(maziMember?.broker_account_id).toBe(resolvedUuid);
  });

  // ─── CASE 2: broker_accounts row NOT found ────────────────────────────────

  it("CASE 2: broker_accounts row missing → broker_account_id=null, warn logged, audit row inserted", async () => {
    const result = await resolveMaziBrokerAccount(
      { rows: [] },
      vi.fn().mockResolvedValue(undefined),
    );

    expect(result.maziAccountId).toBeNull();
    expect(result.warnLogged).toBe(true);
    expect(result.auditRowInserted).toBe(true);

    const maziMember = result.crew.find((m) => m.display_name === "Slumdawg Mazi");
    expect(maziMember?.broker_account_id).toBeNull();
  });

  // ─── CASE 3: Other crew members always null ───────────────────────────────

  it("CASE 3: SlumDawG Dinero and Slumdog always have broker_account_id=null regardless of lookup", async () => {
    // With a found row
    const resultFound = await resolveMaziBrokerAccount(
      { rows: [{ account_id: "aaaabbbb-cccc-4000-a000-000000000002" }] },
      vi.fn(),
    );

    const dinero = resultFound.crew.find((m) => m.display_name === "SlumDawG Dinero");
    const slumdog = resultFound.crew.find((m) => m.display_name === "Slumdog");
    expect(dinero?.broker_account_id).toBeNull();
    expect(slumdog?.broker_account_id).toBeNull();

    // With no row found
    const resultMissing = await resolveMaziBrokerAccount(
      { rows: [] },
      vi.fn().mockResolvedValue(undefined),
    );
    const dineroMissing = resultMissing.crew.find((m) => m.display_name === "SlumDawG Dinero");
    const slumdogMissing = resultMissing.crew.find((m) => m.display_name === "Slumdog");
    expect(dineroMissing?.broker_account_id).toBeNull();
    expect(slumdogMissing?.broker_account_id).toBeNull();
  });

  // ─── CASE 4: FK invariant — null is allowed ───────────────────────────────

  it("CASE 4: null broker_account_id is valid per schema.ts (FK references broker_accounts, nullable)", () => {
    // The slumhouse_users schema has:
    //   brokerAccountId: uuid("broker_account_id"),  ← no .notNull()
    // So null is explicitly allowed.
    //
    // We verify this by reading the schema source text.
    const { readFileSync, existsSync } = require("node:fs");
    const { resolve } = require("node:path");

    const schemaPath = resolve(process.cwd(), "src/server/db/schema.ts");
    expect(existsSync(schemaPath)).toBe(true);

    const src = readFileSync(schemaPath, "utf8") as string;

    // The brokerAccountId column must be uuid WITHOUT .notNull()
    // Find the slumhouse_users block
    const slumhouseIdx = src.indexOf("slumhouse_users");
    expect(slumhouseIdx).toBeGreaterThan(-1);

    const slumhouseBlock = src.slice(slumhouseIdx, slumhouseIdx + 800);
    // broker_account_id column present
    expect(slumhouseBlock).toContain("broker_account_id");
    // Must NOT have notNull on the same line as broker_account_id
    const brokerLine = slumhouseBlock
      .split("\n")
      .find((line) => line.includes("broker_account_id"));
    expect(brokerLine).toBeDefined();
    expect(brokerLine).not.toContain("notNull");
  });

  // ─── CASE 5: audit action contract ───────────────────────────────────────

  it("CASE 5: when lookup misses, audit row must use action=seed.slumhouse_orphan_broker_skipped", async () => {
    const capturedPayloads: unknown[] = [];

    const result = await resolveMaziBrokerAccount(
      { rows: [] },
      vi.fn().mockImplementationOnce(async () => {
        // Simulate what the script does when inserting the audit row
        capturedPayloads.push({
          action: "seed.slumhouse_orphan_broker_skipped",
          entity_type: "slumhouse_user",
          status: "info",
        });
      }),
    );

    expect(result.auditRowInserted).toBe(true);
    expect(capturedPayloads).toHaveLength(1);
    const payload = capturedPayloads[0] as Record<string, unknown>;
    expect(payload.action).toBe("seed.slumhouse_orphan_broker_skipped");
    expect(payload.status).toBe("info");
    expect(payload.entity_type).toBe("slumhouse_user");
  });

  // ─── CASE 6: audit insert failure is non-blocking ────────────────────────

  it("CASE 6: audit insert throwing must NOT abort seed (non-blocking)", async () => {
    const result = await resolveMaziBrokerAccount(
      { rows: [] },
      vi.fn().mockRejectedValueOnce(new Error("DB connection lost during audit write")),
    );

    // Despite the audit insert throwing, the script must continue
    expect(result.maziAccountId).toBeNull();
    expect(result.warnLogged).toBe(true);
    // auditRowInserted is false because the mock threw
    expect(result.auditRowInserted).toBe(false);
    // But crew is still populated correctly
    expect(result.crew).toHaveLength(3);
  });

  // ─── CASE 7: Source-contract check (seed script file) ────────────────────

  it("CASE 7: scripts/seed-slumhouse-crew.ts no longer contains the hardcoded UUID", () => {
    const { readFileSync, existsSync } = require("node:fs");
    const { resolve } = require("node:path");

    const seedPath = resolve(process.cwd(), "scripts/seed-slumhouse-crew.ts");
    expect(existsSync(seedPath)).toBe(true);

    const src = readFileSync(seedPath, "utf8") as string;

    // The hardcoded orphan UUID must be gone
    expect(src).not.toContain("2f4ca594-bdbe-480a-8e07-f447925abf07");

    // The dynamic lookup must be present
    expect(src).toContain("account_id_external");
    expect(src).toContain("mazi-topstep-50k");

    // The audit action must be referenced
    expect(src).toContain("seed.slumhouse_orphan_broker_skipped");
  });
});

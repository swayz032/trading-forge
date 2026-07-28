/**
 * hmac-secret-pair-binding.test.ts — R-394: pin the property, not the mechanism.
 *
 * WHY THIS EXISTS. Item 3's queue entry was named "server-derived `strategy_id`",
 * which implies a trust defect: `strategy_id` arrives in the client payload
 * (`tradingview-webhook.ts`, `z.string().uuid()`) and is therefore attacker-chosen.
 * Investigation (AR-358) found the premise false and R-394 sustained it — the field
 * is attacker-CHOSEN but not attacker-USEFUL, because `lookupHmacSecret` resolves the
 * signing secret with a JOINT key:
 *
 *     WHERE account_id = $accountId AND strategy_id = $strategyId
 *
 * A forged or swapped `strategy_id` therefore resolves a DIFFERENT secret (or none),
 * and the caller's signature cannot verify. Deriving the field server-side would have
 * hardened nothing.
 *
 * ★ So the correct output is a REGRESSION TEST pinning the property that already
 * holds, not a redesign. The property, stated so it stays falsifiable:
 *
 *     A forged or swapped `strategy_id` cannot authenticate.
 *
 * WHAT THIS TEST DELIBERATELY DOES NOT DO. It does not re-implement the lookup's
 * WHERE clause and assert the re-implementation agrees — that would be an instrument
 * grading a copy of itself, and it would still pass after the real query was broken.
 * It calls the REAL `lookupHmacSecret` against a real Postgres (PGlite) and asserts on
 * returned secrets.
 *
 * RED-PROOF (the mutation this is built to catch — verified to BITE before landing).
 * Drop `strategy_id` from the WHERE clause, leaving `WHERE account_id = $1 ... LIMIT 1`:
 *   - "same account, DIFFERENT strategy" FAILS (returns S1's secret — LIMIT 1 takes
 *     whichever row comes first, so the caller silently signs with the wrong pair)
 *   - "a strategy_id with NO assignment" FAILS (returns a real secret for an unassigned
 *     strategy — this is the forgery case, and it is the one that matters)
 * A mutation that no assertion catches is not covered, so both are asserted.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb } from "../../__tests__/helpers/pglite-db.js";
import type { TestDb } from "../../__tests__/helpers/pglite-db.js";

let injectedDb: TestDb["db"] | null = null;

vi.mock("../../db/index.js", () => ({
  get db() {
    return injectedDb;
  },
}));

vi.mock("../../lib/logger.js", () => ({
  logger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
}));

// Imported AFTER mock registration (the DB-injection pattern used by
// spec-onboarding-service.test.ts and fade-the-losers-service.test.ts).
import { lookupHmacSecret } from "../tradingview-marker-service.js";

// account_strategy_assignments is NOT in the pglite helper's CORE_DDL — the service
// reaches it by raw SQL precisely because it is absent from the Drizzle snapshot.
// Only the columns the query actually touches are declared.
const ASSIGNMENTS_DDL = `
CREATE TABLE IF NOT EXISTS account_strategy_assignments (
  account_id            UUID NOT NULL,
  strategy_id           UUID NOT NULL,
  hmac_secret           TEXT,
  hmac_secret_encrypted BYTEA,
  PRIMARY KEY (account_id, strategy_id)
);
`;

const ACCOUNT_A = randomUUID();
const ACCOUNT_B = randomUUID();
const STRATEGY_1 = randomUUID();
const STRATEGY_2 = randomUUID();
const UNASSIGNED_STRATEGY = randomUUID();

const SECRET_A1 = "a1".repeat(32);
const SECRET_A2 = "a2".repeat(32);
const SECRET_B1 = "b1".repeat(32);

describe("lookupHmacSecret — the (account_id, strategy_id) pair binding (R-394)", () => {
  let harness: TestDb;

  beforeAll(async () => {
    harness = await createTestDb();
    injectedDb = harness.db;
    await harness.pg.exec(ASSIGNMENTS_DDL);

    // Same ACCOUNT, two strategies, DIFFERENT secrets — this is what makes the
    // account-only mutation observable. With one row per account the broken query
    // returns the right answer by accident and the test proves nothing.
    for (const [acct, strat, secret] of [
      [ACCOUNT_A, STRATEGY_1, SECRET_A1],
      [ACCOUNT_A, STRATEGY_2, SECRET_A2],
      [ACCOUNT_B, STRATEGY_1, SECRET_B1],
    ] as const) {
      await harness.pg.query(
        `INSERT INTO account_strategy_assignments (account_id, strategy_id, hmac_secret)
         VALUES ($1::uuid, $2::uuid, $3)`,
        [acct, strat, secret],
      );
    }

    // HMAC_ENCRYPTION_KEY unset → the plaintext branch of the F-3 fork, which is the
    // branch the tower runs today. The encrypted branch keys on the same two columns.
    delete process.env.HMAC_ENCRYPTION_KEY;
  });

  afterAll(async () => {
    injectedDb = null;
    await harness.close();
  });

  // ── POSITIVE CONTROL — without this, every assertion below is satisfied by a
  //    function that always returns null, and the suite would pass while proving nothing.
  it("CONTROL: resolves the correct secret for a real (account, strategy) pair", async () => {
    await expect(lookupHmacSecret(ACCOUNT_A, STRATEGY_1)).resolves.toBe(SECRET_A1);
  });

  // ── THE PROPERTY, first direction: the strategy half of the key is load-bearing.
  it("★ same account, DIFFERENT strategy → that strategy's OWN secret, not the account's first row", async () => {
    const secret = await lookupHmacSecret(ACCOUNT_A, STRATEGY_2);
    expect(secret).toBe(SECRET_A2);
    // Stated explicitly: this is the assertion an account-only WHERE clause fails.
    expect(secret).not.toBe(SECRET_A1);
  });

  // ── THE PROPERTY, second direction: the account half is load-bearing too.
  it("★ same strategy, DIFFERENT account → that account's OWN secret", async () => {
    const secret = await lookupHmacSecret(ACCOUNT_B, STRATEGY_1);
    expect(secret).toBe(SECRET_B1);
    expect(secret).not.toBe(SECRET_A1);
  });

  // ── THE FORGERY CASE — the one the whole item was really about.
  it("★★ a strategy_id with NO assignment for this account resolves NOTHING (forged id cannot authenticate)", async () => {
    await expect(lookupHmacSecret(ACCOUNT_A, UNASSIGNED_STRATEGY)).resolves.toBeNull();
  });

  it("★★ a real strategy_id belonging to a DIFFERENT account resolves NOTHING (swapped id cannot authenticate)", async () => {
    // STRATEGY_2 is assigned to ACCOUNT_A only. ACCOUNT_B claiming it must get nothing.
    await expect(lookupHmacSecret(ACCOUNT_B, STRATEGY_2)).resolves.toBeNull();
  });

  it("an unknown account resolves NOTHING", async () => {
    await expect(lookupHmacSecret(randomUUID(), STRATEGY_1)).resolves.toBeNull();
  });

  // ── Callers depend on null meaning "refuse" (tradingview-webhook.ts:256 → 401
  //    hmac_secret_not_found; live-order.ts:449 → 401 token_invalid). A row that
  //    exists but carries no secret must NOT be reported as a usable credential.
  it("an assignment row with a NULL secret resolves null, never an empty-string credential", async () => {
    const acct = randomUUID();
    await harness.pg.query(
      `INSERT INTO account_strategy_assignments (account_id, strategy_id, hmac_secret)
       VALUES ($1::uuid, $2::uuid, NULL)`,
      [acct, STRATEGY_1],
    );
    const secret = await lookupHmacSecret(acct, STRATEGY_1);
    expect(secret).toBeNull();
    expect(secret).not.toBe("");
  });
});

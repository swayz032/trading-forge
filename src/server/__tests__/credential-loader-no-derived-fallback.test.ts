/**
 * credential-loader-no-derived-fallback.test.ts — R-362 queue item 3 (2026-07-28)
 *
 * loadBrokerCredentials() used to fall back to a DERIVED env var name when an
 * account had no explicit vault ref: `${firmId.toUpperCase()}_API_KEY`. That
 * meant the system INVENTED credential slots — for any firm_id there existed a
 * plausibly-named variable that, if set by anyone for any reason, silently armed
 * every account carrying that firm. Nobody ever wrote those names down.
 *
 * The seeded A/B rows carry firm_id='paper', so the name it manufactured was
 * PAPER_API_KEY — which reads like the safe practice key and is not: setting it
 * would have armed the boot probe to POST it to the live TradersPost endpoint.
 *
 * RED-PROOF: the first test sets PAPER_API_KEY and requires the loader to REFUSE
 * it. Restore the `?? \`${firmId}_API_KEY\`` fallback and that test goes RED,
 * because the loader would resolve the very variable it must now ignore.
 * The second test is the discrimination control — an EXPLICIT ref still resolves,
 * so the refusal above is a real refusal and not a loader that never works.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockSelect } = vi.hoisted(() => ({ mockSelect: vi.fn() }));

vi.mock("../db/index.js", () => ({ db: { select: mockSelect } }));
vi.mock("../db/schema.js", () => ({ brokerAccounts: {}, brokerCredentialVault: {} }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn((c: unknown, v: unknown) => ({ c, v })) }));
vi.mock("../lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../lib/broker-credential-vault.js", () => ({
  decryptBrokerCredential: vi.fn(() => "decrypted-key"),
}));

/** db.select({...}).from(x).where(y).limit(1) -> rows */
function selectReturns(rows: unknown[]): void {
  mockSelect.mockReturnValue({
    from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }),
  });
}

describe("loadBrokerCredentials — no derived <FIRM>_API_KEY fallback (R-362 item 3)", () => {
  const saved = process.env.PAPER_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.PAPER_API_KEY;
    else process.env.PAPER_API_KEY = saved;
  });

  it("RED-PROOF: a null vault ref REFUSES even when PAPER_API_KEY is set in the environment", async () => {
    // The exact trap: firm_id='paper' (the seeded A/B rows) + an innocuous-looking
    // variable someone set believing it was the safe practice key.
    process.env.PAPER_API_KEY = "someone-set-this-thinking-it-was-safe";
    selectReturns([{ apiKeyVaultRef: null, firmId: "paper" }]);

    const { loadBrokerCredentials } = await import("../lib/credential-loader.js");

    await expect(loadBrokerCredentials("acct-paper-1")).rejects.toThrow(
      /api_key_vault_ref is null/,
    );
  });

  it("DISCRIMINATES: an EXPLICIT env-name vault ref still resolves", async () => {
    process.env.TF_TEST_EXPLICIT_BROKER_KEY = "explicit-key-value";
    selectReturns([{ apiKeyVaultRef: "TF_TEST_EXPLICIT_BROKER_KEY", firmId: "mffu" }]);

    const { loadBrokerCredentials } = await import("../lib/credential-loader.js");
    const creds = await loadBrokerCredentials("acct-mffu-1");

    expect(creds.apiKey).toBe("explicit-key-value");
    delete process.env.TF_TEST_EXPLICIT_BROKER_KEY;
  });

  it("a missing broker_account still throws its own distinct error", async () => {
    selectReturns([]);
    const { loadBrokerCredentials } = await import("../lib/credential-loader.js");
    await expect(loadBrokerCredentials("nope")).rejects.toThrow(/broker_account not found/);
  });
});

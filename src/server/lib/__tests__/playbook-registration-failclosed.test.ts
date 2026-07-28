/**
 * playbook-registration-failclosed.test.ts — R-313 §5 acceptance suite.
 *
 * The defect these guard: `registerStrategiesInPlaybook` decides whether a name
 * is "already registered" from a REGEX SCRAPE of all 4 category lists. Every way
 * that scrape can come back SHORT causes an already-registered name to be
 * re-inserted into a SECOND category, which WIDENS `playbook.allowed_strategies`
 * and makes `eligibility_gate` check #2 stop SKIPping a strategy in a regime it
 * was never bucketed for. Permissive direction, on a write path.
 *
 * Every fixture here is a TEMP COPY. The real
 * `src/engine/context/playbook_router.py` is never opened by this suite.
 *
 * Each guard is RED-PROVED (a mutation that fires it) and DISCRIMINATES (a
 * control that does not) — a guard proven only by passing on good input is not
 * proven at all.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  registerStrategiesInPlaybook,
  readAllRegisteredNames,
  parseRegistry,
  PlaybookRegistryReadError,
} from "../playbook-registration.js";

/** Mirrors the real file's shape: single-line, double-quoted, comma-separated. */
const CLEAN = `"""Playbook Router fixture."""

CONTINUATION_STRATS = ["ote", "ict_swing", "propulsion"]
REVERSAL_STRATS = ["breaker", "eqhl_raid"]
MEAN_REV_STRATS = ["ny_lunch_reversal", "midnight_open"]
ORB_STRATS = ["iofed", "ict_scalp"]
ALL_STRATS = CONTINUATION_STRATS + REVERSAL_STRATS + MEAN_REV_STRATS + ORB_STRATS
`;

describe("playbook-registration — fail-closed read (R-313 §5a)", () => {
  let dir: string;
  let filePath: string;
  const write = (src: string) => writeFileSync(filePath, src, "utf-8");
  const read = () => readFileSync(filePath, "utf-8");

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "playbook-failclosed-"));
    filePath = join(dir, "playbook_router_fixture.py");
    write(CLEAN);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  // ---- CONTROL: the guards must let legitimate work through ---------------
  it("CONTROL: a clean file registers normally (the guards discriminate)", () => {
    const r = registerStrategiesInPlaybook(filePath, ["vwap_reversal_mes_5m"], "CONTINUATION_STRATS");
    expect(r.ok).toBe(true);
    expect(r.added).toEqual(["vwap_reversal_mes_5m"]);
    const cont = parseRegistry(read()).byCategory.get("CONTINUATION_STRATS")!;
    expect(cont.has("vwap_reversal_mes_5m")).toBe(true);
  });

  // ---- (a) MISSING HEADER — the count check that was ordered ---------------
  it("RED-PROOF (a): a renamed NON-TARGET header aborts the write (registry_read_incomplete)", () => {
    // REVERSAL_STRATS holds "breaker". Rename its header so the scrape cannot
    // see it; registering "breaker" into CONTINUATION would then duplicate it.
    write(CLEAN.replace("REVERSAL_STRATS = [", "REVERSAL_STRATS: list[str] = ["));
    const before = read();

    const r = registerStrategiesInPlaybook(filePath, ["breaker"], "CONTINUATION_STRATS");

    expect(r.ok).toBe(false);
    expect(r.reason).toContain("registry_read_incomplete");
    expect(read()).toBe(before); // refused, not half-applied
  });

  it("(a) proves the DUPLICATE it prevents: the same input under a scrape that cannot see REVERSAL", () => {
    const mutated = CLEAN.replace("REVERSAL_STRATS = [", "REVERSAL_STRATS: list[str] = [");
    write(mutated);
    // The union the OLD (non-throwing) reader would have returned omits "breaker",
    // which is precisely why it would have been re-inserted into CONTINUATION.
    const partial = parseRegistry(mutated);
    expect(partial.missing).toEqual(["REVERSAL_STRATS"]);
    const union = new Set([...partial.byCategory.values()].flatMap((s) => [...s]));
    expect(union.has("breaker")).toBe(false); // <- the short read, made visible
    // "breaker" is nonetheless plainly in the file.
    expect(mutated).toContain('"breaker"');
  });

  // ---- (c) TRUNCATED BODY — NOT covered by the ordered count check ---------
  it("RED-PROOF (c-truncated): a nested bracket in a NON-TARGET list aborts the write", () => {
    write(CLEAN.replace('REVERSAL_STRATS = ["breaker", "eqhl_raid"]', 'REVERSAL_STRATS = ["breaker", ["eqhl_raid"]]'));
    const before = read();

    const r = registerStrategiesInPlaybook(filePath, ["x_new"], "CONTINUATION_STRATS");

    expect(r.ok).toBe(false);
    expect(r.reason).toContain("registry_read_truncated");
    expect(read()).toBe(before);
  });

  it("(c-truncated) is INVISIBLE to the ordered count check — all 4 headers still match", () => {
    // This is why "count matched categories" alone is not sufficient: the header
    // matched, so a count-only guard reports 4/4 and returns a SHORT list.
    const mutated = CLEAN.replace(
      'REVERSAL_STRATS = ["breaker", "eqhl_raid"]',
      'REVERSAL_STRATS = ["breaker", ["eqhl_raid"]]',
    );
    const read1 = parseRegistry(mutated);
    expect(read1.missing).toEqual([]); // count check sees 4/4 — clean, by its lights
    expect(read1.truncated).toEqual(["REVERSAL_STRATS"]); // exactness check catches it
    expect(read1.byCategory.get("REVERSAL_STRATS")!.has("eqhl_raid")).toBe(false);
  });

  // ---- (c) MALFORMED TOKEN -------------------------------------------------
  it("RED-PROOF (c-malformed): an inline comment inside a list aborts the write", () => {
    write(
      CLEAN.replace(
        'MEAN_REV_STRATS = ["ny_lunch_reversal", "midnight_open"]',
        'MEAN_REV_STRATS = [\n    "ny_lunch_reversal",  # the lunch fade\n    "midnight_open",\n]',
      ),
    );
    const before = read();

    const r = registerStrategiesInPlaybook(filePath, ["y_new"], "ORB_STRATS");

    expect(r.ok).toBe(false);
    expect(r.reason).toContain("registry_read_malformed");
    expect(read()).toBe(before);
  });

  // ---- THE FOUNDING TEST CASE: EFFECT 3 -----------------------------------
  it("FOUNDING CASE (effect 3): a nested bracket in the TARGET list is refused, not spliced", () => {
    // Effect 3 is the worst of the three: the name is spliced INSIDE the nested
    // sub-list, so it never becomes a top-level ALL_STRATS member, the overlay
    // is bypassed for it — and because NO DUPLICATE is created, the exhaustive
    // CI duplicate-guard is structurally blind to it.
    const target = 'CONTINUATION_STRATS = ["ote", ["ict_swing", "propulsion"]]';
    write(CLEAN.replace('CONTINUATION_STRATS = ["ote", "ict_swing", "propulsion"]', target));
    const before = read();

    const r = registerStrategiesInPlaybook(filePath, ["founding_case_mes_5m"], "CONTINUATION_STRATS");

    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/registry_read_truncated|verify_failed/);
    // The decisive assertion: the name is NOWHERE in the file. `ok:false` while
    // leaving the splice on disk would be the same defect with a worse label.
    expect(read()).toBe(before);
    expect(read()).not.toContain("founding_case_mes_5m");
  });

  it("FOUNDING CASE control: the post-write verifier REJECTS the exact byte-state effect 3 produces", () => {
    // The spliced state, constructed literally — what the pre-fix code wrote.
    const spliced = CLEAN.replace(
      'CONTINUATION_STRATS = ["ote", "ict_swing", "propulsion"]',
      'CONTINUATION_STRATS = ["ote", ["ict_swing", "propulsion", "founding_case_mes_5m"]]',
    );
    const r = parseRegistry(spliced);

    // ★ THE SUBTLETY THAT DECIDES WHICH CHECK IS LOAD-BEARING: the TS token scan
    // DOES see the name — after the last comma it is a well-formed literal — so a
    // post-write check that merely asked "is the name present in the target list?"
    // would PASS on effect 3 and let it through. PYTHON does not see it: python
    // parses the real nested list, where the name is an element of the SUB-list,
    // so it never joins ALL_STRATS and the overlay is bypassed. The two runtimes
    // disagree about this file, which is the whole bug.
    const union = new Set([...r.byCategory.values()].flatMap((s) => [...s]));
    expect(union.has("founding_case_mes_5m")).toBe(true); // TS sees it...
    expect(spliced).toContain('["ict_swing", "propulsion", "founding_case_mes_5m"]'); // ...nested

    // So presence is NOT the discriminator — EXACTNESS is. Only the truncation
    // check refuses this state, which is why the ordered count-only guard (all 4
    // headers still match here) could not have closed effect 3.
    expect(r.missing).toEqual([]);
    expect(r.truncated).toEqual(["CONTINUATION_STRATS"]);
    expect(() => {
      const f = join(dir, "spliced.py");
      writeFileSync(f, spliced, "utf-8");
      readAllRegisteredNames(f);
    }).toThrow(PlaybookRegistryReadError);
  });

  // ---- The reader's own contract ------------------------------------------
  it("readAllRegisteredNames THROWS rather than returning a short list", () => {
    write(CLEAN.replace("ORB_STRATS = [", "ORB_STRATS_RENAMED = ["));
    expect(() => readAllRegisteredNames(filePath)).toThrow(PlaybookRegistryReadError);
    try {
      readAllRegisteredNames(filePath);
    } catch (err) {
      expect((err as PlaybookRegistryReadError).code).toBe("registry_read_incomplete");
    }
  });

  it("readAllRegisteredNames returns the exact union on a clean file", () => {
    const names = readAllRegisteredNames(filePath);
    expect([...names].sort()).toEqual(
      ["breaker", "eqhl_raid", "ict_scalp", "ict_swing", "iofed", "midnight_open", "ny_lunch_reversal", "ote", "propulsion"].sort(),
    );
  });

  // ---- The `$` replacement hazard -----------------------------------------
  it("a name containing $& is written literally, not expanded as a capture reference", () => {
    const weird = 'weird$&name';
    const r = registerStrategiesInPlaybook(filePath, [weird], "ORB_STRATS");
    expect(r.ok).toBe(true);
    const orb = parseRegistry(read()).byCategory.get("ORB_STRATS")!;
    expect(orb.has(weird)).toBe(true);
    expect(read()).not.toContain("ORB_STRATS = [\"iofed\", \"ict_scalp\"]\"");
  });
});

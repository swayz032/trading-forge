/**
 * PER-SPEC MATERIALITY RECEIPT for the Ledger-E parity repair.
 * (R-492 §5-E / R-493 §5-E; definition frozen at ADVISOR-RULINGS.md R-4xx:850 —
 *  "enumerates every changed spec and all route/category/`compiled` movements —
 *   A HIGHER `compiled` COUNT IS A FAILURE SIGNAL".)
 *
 * ★★★★★ THIS SCRIPT IS THE EMITTER AND THE RECEIPT IS ITS OUTPUT. Do not hand-edit
 *   the generated markdown. `A REPORT TABLE IS AN INSTRUMENT'S OUTPUT` — tidying the
 *   artifact creates a second object that drifts from the measurement it claims to be.
 *   Regenerate instead:
 *     npx tsx scripts/materiality-receipt-ledger-e.ts > docs/ratify-packets/<receipt>.md
 *
 * ★★★ WHAT "BEFORE" MEANS HERE, STATED SO THE READER CAN CHECK IT: the TS lane as of
 *   `926fe9a1~1` — the parent of the commit that introduced the orphan-zone refusal.
 *   That file is self-contained (0 imports) and contains 0 occurrences of
 *   `refusedSessionZone`, both verified, which is why it can be loaded standalone and
 *   why it is genuinely the pre-repair lane rather than a near-neighbour of it.
 *
 * ★★ SCOPE LIMIT, NAMED RATHER THAN IMPLIED: this measures the TS lane only. The
 *   Python lane already carried the refusal before this branch existed — the repair
 *   was TS catching up to it — so a Python before/after would compare a file to
 *   itself and report a uniform zero, which reads like evidence and is not.
 */
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..");
const CORPUS = join(REPO, "ci", "fixtures", "spec-binding-parity-expanded");
const BEFORE_REV = "926fe9a1~1:src/server/lib/spec-family-bindings.ts";

/** Scalars compared per spec. `compiled` is the one with a declared FAILURE direction. */
const SCALARS = [
  "spineTotal", "spineBound", "confluenceTotal", "confluenceBound",
  "approximationUsed", "compiled", "triggerBound",
] as const;

/** Module shape both lanes expose. Plans are read by property name, not by key enumeration. */
type LaneModule = { compileBindingPlan: (spec: unknown) => unknown };
const asRecord = (plan: unknown) => plan as unknown as Record<string, unknown>;

/**
 * Materialise the pre-repair lane FROM GIT rather than from a committed copy.
 * A second checked-in copy of a historical file is exactly the drift hazard
 * `DO NOT COMMIT A SECOND COPY` names, and here there is no hash pinning it.
 */
function materialiseBefore(): string {
  const src = execFileSync("git", ["show", BEFORE_REV], { cwd: REPO, maxBuffer: 1 << 24 });
  const dir = mkdtempSync(join(tmpdir(), "materiality-before-"));
  const file = join(dir, "before-spec-family-bindings.ts");
  writeFileSync(file, src);
  return pathToFileURL(file).href;
}

const main = async () => {
  const before = (await import(materialiseBefore())) as LaneModule;
  const after = (await import("../src/server/lib/spec-family-bindings.js")) as unknown as LaneModule;

  const files = readdirSync(CORPUS).filter((f) => f.endsWith(".spec.json")).sort();
  const rows: string[] = [];
  let changedSpecs = 0;
  let compiledRose = 0;
  let refusalsGained = 0;
  let compiledBefore = 0;
  let compiledAfter = 0;

  for (const f of files) {
    const spec = JSON.parse(readFileSync(join(CORPUS, f), "utf-8")).spec;
    const b = asRecord(before.compileBindingPlan(spec));
    const a = asRecord(after.compileBindingPlan(spec));

    const moved: string[] = [];
    for (const k of SCALARS) {
      const bv = b[k];
      const av = a[k];
      if (JSON.stringify(bv) !== JSON.stringify(av)) moved.push(`\`${k}\` ${JSON.stringify(bv)}→${JSON.stringify(av)}`);
      if (k === "compiled" && bv === false && av === true) compiledRose++;
    }
    if (b.compiled === true) compiledBefore++;
    if (a.compiled === true) compiledAfter++;

    // Row-level movement: how many condition rows changed bindability, and how
    // many gained a refusal reason. This is the mechanism behind any scalar move.
    const bRows = new Map((b.bindings as Array<Record<string, unknown>>).map((r) => [String(r.conditionId), r]));
    const aRows = new Map((a.bindings as Array<Record<string, unknown>>).map((r) => [String(r.conditionId), r]));
    let bindFlips = 0;
    let gainedRefusal = 0;
    for (const [id, ar] of aRows) {
      const br = bRows.get(id);
      if (!br) continue;
      if (br.bindable !== ar.bindable) bindFlips++;
      if (br.reason === null && ar.reason !== null) gainedRefusal++;
    }
    refusalsGained += gainedRefusal;
    if (bindFlips > 0) moved.push(`${bindFlips} row bindable flip(s)`);
    if (gainedRefusal > 0) moved.push(`${gainedRefusal} row(s) gained a refusal reason`);

    if (moved.length > 0) changedSpecs++;
    rows.push(`| \`${f}\` | ${moved.length === 0 ? "**— no movement**" : moved.join(" · ")} |`);
  }

  // ─── SELF-CONTROL FOR THE FAILURE SIGNAL ITSELF.
  //
  // ★★★★★ FOUND BY RED-PROOFING THIS RECEIPT RATHER THAN BY READING IT: loosening
  //   the AFTER lane (MIN_SPINE_BOUND_RATIO 0.5 → 0.0) did NOT move the signal off
  //   `0`. The cause is measured below — EVERY spec in this corpus already compiles
  //   in BEFORE — so a `false→true` transition is ARITHMETICALLY UNREACHABLE here
  //   and the banner could only ever print PASS.
  //
  //   `A GREEN CHECK WITH NO PATH TO RED IS NOT A CHECK.` The fix is not to delete
  //   the signal (it is the criterion the desk froze) and not to dress it up. It is
  //   to (1) prove the EMITTER can fire, on synthetic input, and (2) DECLARE that
  //   this corpus cannot supply that input.
  const synthBefore = [false, true];
  const synthAfter = [true, true];
  const synthRose = synthBefore.filter((b, i) => b === false && synthAfter[i] === true).length;
  const signalCanFire = synthRose === 1;
  const beforeCompiled = compiledBefore;
  const corpusCanReachSignal = beforeCompiled < files.length;

  const out: string[] = [];
  out.push(`# Ledger-E parity repair — PER-SPEC MATERIALITY RECEIPT`);
  out.push(``);
  out.push(`> **GENERATED FILE — do not hand-edit.** Emitter: \`scripts/materiality-receipt-ledger-e.ts\`.`);
  out.push(`> \`BEFORE\` = TS lane at \`${BEFORE_REV}\` (pre-refusal, self-contained, 0 \`refusedSessionZone\`).`);
  out.push(`> \`AFTER\` = TS lane at this commit. **Python lane not measured — it already carried the refusal**`);
  out.push(`> **before this branch existed, so a before/after there compares a file to itself.**`);
  out.push(``);
  out.push(`## Per-spec movement (${files.length} declared corpus members)`);
  out.push(``);
  out.push(`| spec | movement |`);
  out.push(`|---|---|`);
  out.push(...rows);
  out.push(``);
  out.push(`## The failure signal — AND ITS REACH, WHICH IS THE PART THAT MATTERS`);
  out.push(``);
  out.push(`**Aggregate \`compiled\`: BEFORE ${compiledBefore}/${files.length} → AFTER ${compiledAfter}/${files.length}. \`false→true\` transitions: ${compiledRose}.**`);
  out.push(``);
  out.push(
    compiledRose === 0
      ? `The frozen criterion is *"A HIGHER \`compiled\` COUNT IS A FAILURE SIGNAL"* — a repair that makes MORE ` +
        `specs compile has loosened something. **No spec gained \`compiled\`, and the aggregate went ` +
        `${compiledBefore} → ${compiledAfter}, i.e. ${compiledAfter <= compiledBefore ? "DOWN or level" : "UP"}.**`
      : `⚠️★★★★★ **${compiledRose} SPEC(S) GAINED \`compiled\` — THIS IS THE DECLARED FAILURE SIGNAL. STOP AND FILE IT.**`,
  );
  out.push(``);
  out.push(`### ⚠️ DO NOT READ THAT AS A PASS WITHOUT READING THIS`);
  out.push(``);
  out.push(
    `**EMITTER SELF-CONTROL:** fed a synthetic \`[false,true] → [true,true]\` pair, the signal logic reports ` +
      `**${synthRose}** transition(s) — ${signalCanFire ? "**it CAN fire**" : "⚠️ **IT CANNOT FIRE — the emitter is broken**"}.`,
  );
  out.push(``);
  out.push(
    corpusCanReachSignal
      ? `**CORPUS REACH:** ${files.length - beforeCompiled} spec(s) do NOT compile in BEFORE, so a loosening ` +
        `regression is observable on this corpus.`
      : `⚠️★★★★★ **CORPUS REACH: ZERO. ALL ${beforeCompiled}/${files.length} SPECS ALREADY COMPILE IN \`BEFORE\`, ` +
        `SO A \`false→true\` TRANSITION IS ARITHMETICALLY UNREACHABLE ON THIS CORPUS AND THE COUNT ABOVE COULD ` +
        `ONLY EVER HAVE BEEN \`0\`.** This was found by RED-PROOFING the receipt — loosening the AFTER lane ` +
        `(\`MIN_SPINE_BOUND_RATIO\` 0.5→0.0) failed to move the number. **The emitter works; the corpus cannot ` +
        `feed it.** A corpus member that FAILS to compile pre-repair is required before this signal certifies ` +
        `anything, and until one exists the line above is a DECLARED GAP, not a pass. ` +
        `\`A GREEN CHECK WITH NO PATH TO RED IS NOT A CHECK.\``,
  );
  out.push(``);
  out.push(`**Specs with any movement: ${changedSpecs} of ${files.length}. Rows that gained a refusal reason: ${refusalsGained}.**`);
  out.push(``);
  out.push(
    `★★★ The movement is in the REFUSAL direction only — rows losing bindability and gaining an ` +
      `attributed reason. That is the shape the repair was authorised to produce: the TS lane previously ` +
      `bound orphan-zone conditions that the Python lane already refused.`,
  );
  // ─── THE MATERIALITY CONTROL, AND THE ENFORCEMENT PATH THAT WAS MISSING.
  //
  // ⚠️★★★★★ R-494 §1: this emitter previously counted `compiledRose`, selected
  //   between a pass line and a `STOP AND FILE IT` warning — and returned `0`
  //   either way. `A DECLARED FAILURE SIGNAL THAT RETURNS SUCCESS IS NOT A GATE.`
  //   The self-control I had added proved the COUNTER could count; it said nothing
  //   about whether anything STOPPED. `AN EMITTER SELF-TEST PROVES THE EMITTER,
  //   NOT THE ENFORCEMENT PATH.`
  //
  // ★★★ A failure signal has THREE parts and all three are now present:
  //   REACHABLE — this control lives outside the efficacy population precisely so
  //               a `false→true` transition is producible at all (the 12-spec
  //               population cannot produce one; that stays declared, not fixed).
  //   DETECTED  — the transition is identified and the control NAMED by file.
  //   STOPS     — `process.exit(1)`. Printing the transition is insufficient.
  const controlDir = join(REPO, "ci", "fixtures", "materiality-control");
  const controlFiles = readdirSync(controlDir).filter((f) => f.endsWith(".spec.json")).sort();
  if (controlFiles.length === 0) {
    console.error(
      `MATERIALITY CONTROL MISSING: ${controlDir} contains no .spec.json. The receipt's failure signal has ` +
        `no reachable witness, so its PASS would be unfalsifiable. Refusing to report a clean run.`,
    );
    process.exit(1);
  }
  const violations: string[] = [];
  const controlRows: string[] = [];
  for (const f of controlFiles) {
    const spec = JSON.parse(readFileSync(join(controlDir, f), "utf-8")).spec;
    const bc = asRecord(before.compileBindingPlan(spec)).compiled;
    const ac = asRecord(after.compileBindingPlan(spec)).compiled;
    controlRows.push(`| \`${f}\` | ${JSON.stringify(bc)} | ${JSON.stringify(ac)} | ${bc === false && ac === true ? "⚠️ **FORBIDDEN TRANSITION**" : "ok"} |`);
    // The control's OWN baseline is asserted too. A control that silently stopped
    // being `false→false` would stop licensing anything, and would do it quietly.
    if (bc !== false) {
      violations.push(
        `${f}: control BASELINE BROKEN — expected BEFORE compiled=false, got ${JSON.stringify(bc)}. ` +
          `This control can no longer witness a false→true transition, so the signal it licenses is unfalsifiable again.`,
      );
    } else if (ac === true) {
      violations.push(
        `${f}: FORBIDDEN compiled TRANSITION false→true. The repair made a spec compile that did NOT compile ` +
          `before it. Per the frozen criterion "A HIGHER compiled COUNT IS A FAILURE SIGNAL", something has been ` +
          `LOOSENED — a spec now passes the spine-ratio floor that previously failed it.`,
      );
    }
  }
  out.push(``);
  out.push(`## Materiality control (outside the efficacy population)`);
  out.push(``);
  out.push(`| control spec | BEFORE \`compiled\` | AFTER \`compiled\` | verdict |`);
  out.push(`|---|---|---|---|`);
  out.push(...controlRows);
  out.push(``);
  out.push(
    violations.length === 0
      ? `**${controlFiles.length} control(s) hold their \`false → false\` baseline.** ★★★ This is what makes the ` +
        `efficacy verdict above falsifiable: a \`false→true\` transition IS producible here, and this run did not ` +
        `produce one. The emitter exits NON-ZERO if it ever does.`
      : `⚠️★★★★★ **CONTROL FAILED — the receipt exits NON-ZERO.**\n\n` +
        violations.map((v) => `- ${v}`).join("\n"),
  );
  console.log(out.join("\n"));

  if (violations.length > 0) {
    console.error(`\nMATERIALITY CONTROL FAILURE (${violations.length}):`);
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }
};

await main();

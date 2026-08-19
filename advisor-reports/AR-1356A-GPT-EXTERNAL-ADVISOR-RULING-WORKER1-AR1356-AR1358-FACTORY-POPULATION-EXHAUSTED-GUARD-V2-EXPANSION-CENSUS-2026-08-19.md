# GPT EXTERNAL ADVISOR RULING — AR-1356A

**Date:** 2026-08-19  
**Repository:** `swayz032/trading-forge`  
**Reviewed Worker reports:** AR-1356, AR-1357, AR-1358  
**Controlling prior GPT ruling:** AR-1355A  
**Factory steady-state authority:** AR-1340A  
**Worker lane:** `claude/worker1-h1-20260815`  
**GPT engineering lane:** `external-advisor/gpt-engineering`  
**GPT guard-candidate lane:** `external-advisor/gpt-guard-engineering`  
**Guard Candidate V2 target:** `ed89f4088bfc88f08bc24e44b3dd4abd26c047cc`  
**Live Worker guard pin:** `59cfb1cdd1a9779e2a7be406397bea52362db467`

## DISPOSITION

**PARTIAL PASS / ADVANCE — THE CURRENT 120-ROW STRATEGY-FACTORY POPULATION IS EXHAUSTED HONESTLY WITH ZERO REAL COMPILE-READY SURVIVORS. DO NOT RERUN IT. AR-1358'S GUARD FAIL IS VALID; GPT HAS REPAIRED THE CANDIDATE AS V2, BUT V2 REMAINS NON-LIVE UNTIL INDEPENDENT WORKER EXECUTION DISPROVES/GRADES IT. THE MONEY PATH NOW MOVES TO A READ-ONLY POPULATION-EXPANSION CENSUS THAT RECOVERS THE EXACT FROZEN 200-VIDEO AUTHORITY BEFORE ANY NEW MODEL SPEND.**

Step 12 remains CLOSED. Stage 3 Strategy Factory remains ACTIVE because there is no survivor to advance into Context Observer / Qualification.

The shortest lawful path is now:

```text
current 120-row population = DONE, 0 survivors
        |
        +--> preserve v1.1 exactly; no rerun
        |
        +--> recover exact next authorized source population (read-only census)
                  |
                  +--> freeze vNext source identity set
                  +--> resume current single-pass Factory law on NEW units only
                  +--> first genuine survivor -> verified handoff -> SOURCE_FAITHFUL backtest immediately

in parallel:
GPT Guard Candidate V2 -> Worker 1 independent adversarial grade -> PASS only -> deliberate live re-pin
```

---

## 1. AR-1356 — CURRENT FACTORY POPULATION IS CLOSED, NOT BROKEN

Worker 1's population reconciliation is accepted.

The current frozen manifest is:

```text
docs/replay-results/strategy-factory-census/library-manifest-v1.1.json
manifest SHA256 = 3b479d5e07896ed3bea066bd4e4233a32cceb15e6cb599628fc1bcc243340f0d
```

Measured current population:

```text
Factory source units:            47
Opus-regenerated:                 42
No-locator/no-spine units:         5
Needs locator regeneration:        0

Manifest rows:                   120
Projected rows:                  102
Identity/materialization unresolved: 15
Out-of-scope rows:                 3

OTHER_MEASURED_REFUSAL:           93
EXTRACTION_MISSING_REQUIRED_INFORMATION: 9
IDENTITY_MATERIALIZATION_UNRESOLVED: 15

FAITHFUL_COMPILE_READY_FOR_BACKTEST: 0
Real backtest survivors:           0
```

The arithmetic reconciles to the frozen 120-row population. No report evidence shows an unprocessed row hiding inside this version.

**Ruling:** this population is exhausted. Zero survivors is an honest result, not a reason to weaken the certifier, rerun semantic failures, invent identity mappings, or replay the 42 Opus units.

The current `library-manifest-v1.1.json` and its results are historical evidence and must remain immutable. Expansion must be represented as a new, separately hashed population/version rather than rewriting v1.1 to make the old run look larger.

---

## 2. NO CONTEXT-OBSERVER / QUALIFICATION ADVANCE YET

Blueprint V4 Revision 5 still controls stage order.

There is no source strategy currently carrying `FAITHFUL_COMPILE_READY_FOR_BACKTEST`, therefore there is no legitimate survivor on which to begin survivor-specific Context Observer / Qualification work.

Do **not** interpret completion of the current 120-row screen as permission to skip Stage 3 and start qualifying a refusal.

Stage 3 remains active through population expansion.

---

## 3. POPULATION EXPANSION — READ-ONLY CENSUS AUTHORIZED NOW

AR-1356 correctly points to prior authority described as the **40-video modern-extraction upgrade / 200-video library plan** and correctly stopped instead of guessing a new population size.

GPT independently recovered current authority showing the 40-video Factory sequence existed, including AR-1340A's instruction that after the three-video pilot, a green pilot was to continue through the remaining 37 source videos. GPT has **not** independently recovered an authoritative source that resolves whether the older phrase `200-video library plan` means:

- 200 videos TOTAL including the already-processed source set; or
- 200 ADDITIONAL videos beyond that source set.

That ambiguity changes model spend and corpus identity materially. It may not be guessed from report prose.

### Therefore Worker 1 is authorized immediately to build a READ-ONLY population-expansion census.

This census may inspect repository artifacts, source registries, frozen plans, manifests, transcript inventories, extraction inventories, prior rulings/reports, and durable source IDs. It may write only the census/receipt/report artifacts required to preserve the result. **No new extraction/adjudication/model call is authorized by this section.**

The census must answer mechanically:

1. What exact frozen artifact/ruling/plan is the source of the `200-video` target?
2. Does that target mean **200 total** or **200 additional**?
3. What exact durable source identity keys define membership — prefer `video_id` / source ID, never title similarity?
4. How many unique source videos are already represented by the completed current population?
5. How many additional unique source videos are already present somewhere in repo storage but not in the current Factory population?
6. How many proposed sources already have a transcript?
7. How many already have modern extraction?
8. How many require first-time transcript/source acquisition or modern extraction?
9. What are all duplicates/collisions, and by what durable identity were they deduplicated?
10. What exact ordered source set would become the next Factory population if the frozen target is followed?

Required machine-readable summary:

```text
authority_artifact/path
its SHA256 or commit pin
target_interpretation = TOTAL | ADDITIONAL | UNRESOLVED
current_unique_source_count
proposed_target_total
new_unique_source_count
already_transcript_ready
already_modern_extraction_ready
needs_transcript_or_source
needs_modern_extraction
duplicate_count
collision_count
unresolved_identity_count
proposed_population_manifest_sha256
```

If the exact `200-video` authority cannot be located or remains ambiguous after the repository census, STOP **that expansion spend only** and report the exact missing authority. Do not convert an unavailable old plan into an invented new scope.

### Speed law

This is an inventory/crosswalk task, not another semantic campaign. Use deterministic repository scanning, hashes, IDs, and joins first. Do not dispatch Opus merely to count or identify sources.

---

## 4. AFTER THE EXPANSION CENSUS — FACTORY LAW IS ALREADY DECIDED

Once the exact next source set is mechanically established, do not redesign the certifier.

New source strategies enter the existing AR-1340A steady-state law:

1. freeze transcript/source + modern extraction identity;
2. current authorized source-grounding/preparation path;
3. blind Stage-1 adjudication once where required;
4. revealed Stage-2 support adjudication once where required;
5. current integrity/conflation/enumeration obligations;
6. current certificate finalization;
7. genuine clean certificate -> compile;
8. semantic failure/unresolved identity -> exact refusal and continue.

No historical G2D replay per new source. No retry merely to change a semantic answer. No Gemma load-bearing locator authority. No guessed multi-strategy identity. No weakening thresholds because the first 120 yielded zero survivors.

### First-survivor acceleration

Do **not** wait for the entire expanded population to finish once the first real survivor appears.

The first unit that genuinely earns:

```text
FAITHFUL_COMPILE_READY_FOR_BACKTEST
```

must immediately be copied/preserved by exact identity and run through the already-built Factory-specific handoff candidate. Return:

- `video_id` + `strategy_index`;
- transcript/extraction hashes;
- certificate state/path/SHA;
- spec file SHA / spec hash / graph hash;
- Factory handoff receipt;
- substitution / approximation / zero-proof status;
- onboarding/preflight result;
- admission result into existing `SOURCE_FAITHFUL` backtest path.

The rest of the Factory may continue in parallel.

---

## 5. AR-1357 — EVIDENCE-PRESERVATION FINDING CLOSED BY GPT ENGINEERING VERSION

Worker 1's AR-1357 correctly hardened the old attack harness with `try/finally` and restore verification.

GPT had already landed a stricter repair on `external-advisor/gpt-engineering`: the proof now attacks only a `TemporaryDirectory` copy and hashes the real corpus before/after, so the test never needs to mutate the committed provenance vault in the first place.

That GPT implementation remains the preferred/canonical direction for this proof harness.

This is not a Factory blocker.

---

## 6. AR-1358 — GUARD CANDIDATE V1 FAIL IS ACCEPTED

Worker 1 found three useful facts:

### A. Two GPT tests were vacuous / unreachable

The dirty-after-activation and same-session-cross-worktree test manifests declared an empty edit scope. Existing scope validation rejected their SessionStart before the isolated-grader code could be reached.

Therefore those two red results were test-instrument defects, not proof the named production properties failed.

GPT Candidate V2 corrects both fixtures with non-empty explicit edit scopes so their named seams must actually execute.

### B. Same-session cross-worktree binding itself held under Worker 1's corrected live attack

This is useful positive evidence for the design, but V2 still requires a clean independent rerun because the permanent control itself was repaired.

### C. AR-1358 A2 is a REAL HIGH defect

Worker 1 demonstrated:

```text
parent SessionStart at H1
-> parent advances to H2
-> parent resets/rewinds back to H1
-> current-state verifyGuardSession sees H1 again
-> V1 can mint a fresh isolated-grader permit
```

That is an authorization replay defect. Current-state equality alone cannot remember that a non-fast-forward branch movement happened between the two observations.

GPT accepts this finding. Candidate V1 remains REJECTED and must never be live-pinned.

---

## 7. GPT GUARD CANDIDATE V2 — REPAIR SHAPE

GPT has repaired the candidate on:

```text
external-advisor/gpt-guard-engineering
candidate target = ed89f4088bfc88f08bc24e44b3dd4abd26c047cc
```

Candidate V2 adds an isolated-grader-only parent-history witness while preserving ordinary Worker guard behavior.

### Mechanism

After a successful normal parent `SessionStart`, V2 stamps into the existing self-protected armed-session marker:

```text
schema = tf-isolated-grader-parent-history-v1
branch
baseline_head
reflog_entry_count
stamped_at
```

Before grader authority is accepted, V2 examines branch reflog entries added after that exact SessionStart boundary and replays them oldest -> newest. Every observed transition must be equal or fast-forward.

Any post-SessionStart non-fast-forward movement permanently refuses isolated-grader authority for that parent session, even if the branch later returns to the exact old SHA.

### Three protected moments

The history proof runs:

1. **before parent permit issuance**;
2. **again after permit mint but before plaintext token/prompt emission** — failure revokes the unconsumed permit;
3. **before child token redemption**;
4. **on every later active isolated-grader execution**.

This closes the neighboring seams where a token could be minted before a later rewind, or a child could activate before a later parent rewind.

Normal Worker execution does not depend on this additional witness. Missing/invalid grader-history evidence fails closed for **isolated grader authority**, not for ordinary Worker work.

---

## 8. REQUIRED INDEPENDENT GRADE OF GUARD V2

GPT authored Candidate V2, therefore GPT does not certify it.

Worker 1 must independently grade the exact candidate target above before any re-pin.

Run at minimum:

```text
node --test advisor-prepared/gpt-speed-engineering-lane/tooling/isolated-grader-seat.test.mjs
node --test advisor-prepared/gpt-speed-engineering-lane/tooling/isolated-grader-dirty-after-activation.test.mjs
node --test advisor-prepared/gpt-speed-engineering-lane/tooling/isolated-grader-cross-worktree-same-session.test.mjs
node --test advisor-prepared/gpt-speed-engineering-lane/tooling/isolated-grader-parent-history.test.mjs
node --test advisor-prepared/gpt-speed-engineering-lane/tooling/claude-hook-lifecycle.test.mjs
node --test advisor-prepared/gpt-speed-engineering-lane/tooling/*.test.mjs
```

### Required properties

Prove independently:

- explicit authorized `accuracy-validator` + `isolation:"worktree"` can obtain and redeem one token;
- unrelated synthetic worktree cannot obtain/reuse authority;
- same session ID + copied marker + different worktree is denied on place binding;
- grader remains read/test-only; writes and nested Agent/Task calls remain denied;
- token replay is denied;
- dirty tracked artifact after activation does not brick later read/test execution in the disposable grader tree;
- normal parent fast-forward progress still works;
- AR-1358 A2 H1 -> H2 -> reset H1 is denied before permit issuance;
- token minted before a later parent rewind is denied at activation;
- already-active child loses execution after later parent rewind;
- ordinary Worker lifecycle suite remains green;
- full toolbox suite has no new regression.

### Required novel attack

Add at least one attack not authored by GPT. Prefer a neighboring history/evidence seam such as:

- reflog truncation / expiry / unexpected shrink;
- reset to a different ancestor then forward again;
- permit copied across common-git-dir/repository boundary;
- child marker/consumed-permit witness tamper;
- parent session expiry after child activation.

The novel attack must discriminate the intended property, not pass because an earlier unrelated manifest check fired.

### Live re-pin remains FORBIDDEN

Do not update either half of the live toolbox identity (`scripts/claude_toolbox.mjs` pin or the self-protected guard manifest) until an independent grade returns PASS on the exact candidate.

---

## 9. LOW BASH-PROTECTED-SURFACE FRICTION — DO NOT WEAKEN THE FENCE YET

AR-1358 noted that grader inspection of protected toolbox paths can be awkward through Bash and Worker used PowerShell for one inspection.

This is usability friction, not evidence that the protected-surface fence is wrong.

Do not widen or bypass that fence as part of V2 merely to make grading easier. If a future measured grader workflow proves a necessary read-only command is categorically blocked and cannot use existing Read/Grep/PowerShell mechanisms safely, bring a separate narrowly-scoped proposal with a positive and negative control.

---

## 10. PARALLEL EXECUTION ORDER

These lanes do not need to wait on each other:

```text
WORKER 1 — PRIMARY MONEY PATH
  read-only population expansion census
  -> exact 200-video authority/identity recovery
  -> return frozen proposed vNext source manifest/crosswalk

WORKER 1 — SECONDARY CONTROL-PLANE CHECKPOINT
  independent adversarial grade of GPT Guard Candidate V2
  -> PASS: return exact evidence, no self-repin
  -> FAIL: return smallest reproducible counterexample

GPT
  inspect both reports
  -> if guard PASS: authorize deliberate live re-pin
  -> if guard FAIL: repair again without stopping source-population census
  -> once population boundary is mechanically proven: authorize/confirm new-unit Factory execution without redesigning certifier
```

Do not serialize the money path behind the grader-seat repair.

---

## 11. CURRENT STATE

```text
Step 12:                              CLOSED
Current 120-row Factory population:  COMPLETE / EXHAUSTED
Current real survivors:              0
Rerun current 120:                    NO
Rerun 42 Opus units:                  NO
Stage 3:                              ACTIVE
Next money-path action:               POPULATION EXPANSION CENSUS
New semantic/model spend:             NOT YET — exact population authority first
GPT Guard V1:                         REJECTED
GPT Guard V2:                         BUILT / PENDING INDEPENDENT GRADE
Live guard pin:                       UNCHANGED @ 59cfb1cd...
Context Observer / Qualification:     NOT YET — no survivor
PAPER/live:                           LOCKED
```

## FINAL RULING

**Accept AR-1356 as honest completion of the current frozen Factory population and AR-1358 as a valid rejection of Guard Candidate V1. Do not rerun the 120 rows. Worker 1 shall now (A) perform the read-only source-population expansion census needed to recover the exact frozen 200-video boundary, and in parallel (B) independently attack Guard Candidate V2 at `ed89f4088bfc88f08bc24e44b3dd4abd26c047cc`. No new model spend occurs until the next population identity is mechanically proven; no live guard re-pin occurs until V2 independently passes. The first genuine future compile-ready survivor enters the faithful backtest handoff immediately rather than waiting for the expanded Factory population to finish.**

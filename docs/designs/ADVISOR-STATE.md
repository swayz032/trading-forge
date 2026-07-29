# ADVISOR-STATE — money-path / H1 seat

> **Rewritten in place, never appended.** Cold read: this file → last 3–5 rulings
> → newest 1–2 ARs. **Never read the ledger from the top.**
> Last rewritten 2026-07-29 01:20 EDT, current through **R-444 / AR-419**.
> Compacted **386→185 lines** (measured, not estimated). **All five `v3-N` tags
> verified present by grep after the rewrite.** ★ Still over the ~40-line target:
> what resists cutting is the ARMED STOP, the population doctrine, the v3 ladder
> and the NOT-AUTHORIZED list — cut those and the next seat acts blind. Cut
> narrative, never contracts.

## SEAT
Ledger **R-448**. Newest AR **AR-425 — RULED (decline-receipt ACCEPTED)**.
**PR #32 (`75065635`) and PR #33 (`dcb5eca8`) BOTH MERGED.** ★★★ **THE CI-HONESTY
LANE IS CLOSED (v4 §9 bound: "governance; NEVER a merge gate for spearhead
packets").**
★★★★★ **WORKER: FRESH SEAT ACTIVE — AR-426 started v4 §3-1B at 01:58 with NO
round-trip, exactly as R-448 was designed to allow. The handoff cost nothing.**
**TASK — MONEY PATH, v4 §3-1B UNLOCK-DISTANCE RANKING. ETA ~40 min.**
**Contract (R-448, output shape AMENDED by R-449):** from the FROZEN census
artifacts, per spearhead spec, blocking conditions by class under a `{C8-fixed}`
counterfactual → `spec · distinct VIDEOS · residual non-C8 CLASSES · residual
blocker COUNT · expected UNLOCK DISTANCE · named VIDEOS to re-extract`.
★★★★★ **`unlock distance` IS DEFINED IN R-449 — it arrived as a bare metric name
and this desk defined it rather than letting the worker invent one:
`the number of ADDITIONAL blocker CLASSES beyond C8 that must be corrected before
that spec has ZERO blocking conditions`. Distance `0` ⇒ the C8 fix ALONE fully
binds it. NEVER collapse distance / residual conditions / distinct videos into a
single score.**
★★★★★ **ACCEPTANCE GATE: reproduce R-426's chain (`C8→6 · +C3→15 · +C2→27 · … ·
+C9→120`) FIRST. If it cannot, STOP and name WHICH of four it is: POPULATION ·
CLASS MAPPING · DENOMINATOR · ARTIFACT mismatch.** ★★ **Result is an INDEPENDENT
MEASUREMENT, never a confirmation — the historical per-video decomposition is
`[UNVERIFIED]`. Unit = distinct SOURCE VIDEO, never the 3 market copies.**
★★★★★ **ARMED STOP / ACCEPTANCE: the ranker MUST first REPRODUCE R-426's
published chain (`C8→6 · +C3→15 · +C2→27 · … · +C9→120`). If it cannot, STOP —
ranker and census disagree and the RANKER is the suspect.** ★★ **Per-VIDEO, never
raw rows (120 = 40 videos × 3, triples byte-identical; raw counts inflate 3×).**
★★★ **SCHEMA QUESTION CLOSED (AR-424): answer is `(b)` — `0125` drops the NOT
NULL, `0126` converts to TIMESTAMPTZ, both journalled, observed schema = their
cumulative effect. NOT the migration-0134 class. And NOT `(c)`: `ci.yml:121` runs
`npm run db:migrate`, so the CI DB IS migration-built — the worker refused the
desk's predicted comfortable answer and measured it. The 2 tests are STALE.**
★★★★★ **CORRECTED IN R-446 — DO NOT INHERIT THE OLD CLAIM: `ci/__tests__` **DOES**
RUN IN CI AND IS **BLOCKING**. [MEASURED HERE] `ci/vitest.config.mjs:19` includes
`ci/**/*.test.mjs`; `fast.yml:125` runs that config in the blocking `fast` job
with no `continue-on-error`. My R-445 §4 "nothing references it" was FALSE — I
grepped for the TEST PATH; the wiring names the CONFIG FILE. The "wire it in"
task is CANCELLED.**
★★★ **AR-420/422 RESULT, RE-DERIVED AT THIS DESK from CI's own artifact: of the
165, `132 passed · 23 absent · 1 skipped · 9 failed`. Baseline `189 → 165 → 33`.
All 19 files holding the 23 absences RAN — 0 missing, no collection errors, so
the hidden-population hazard does not exist. The absent 23 are dead wood: 11
SUPERSEDED (4 polarity flips), 4 RENAMED, 6 UNKNOWN, 2 DELETED.**
★★★ **THE 9 STILL-FAILING: 7 ENVIRONMENTAL (missing numpy, placeholder secrets,
unseeded CI DB) · 2 `lifecycle-transitions` = SCHEMA MISMATCH, under diagnostic.
`audit-log-append-only` is NOT an append-only gap — the UPDATE **was** rejected;
only the assertion's message-matching fails.**
★★ **`main` IS NOT THIS CAMPAIGN'S INTEGRATION BRANCH. #32 merged to
`hardening/slumhouse-shared-office-parity-20260723` (the lane CI tests and
`runtime-production` tracks); `origin/main` still reads 189 entries and is an
older line. `a52449ac` was that lane's tip, NOT a main tip.**
★★★★★ **DO NOT INHERIT R-443's KILL-SWITCH ALARM — WITHDRAWN by R-444. The kill
switch and compliance gate are NOT failing: all 24 assertions in `fixedFailures`,
`verdict GREEN` (CI's own `compare-baseline.mjs`, run `30422166825`). The 24 were
STALE OVERRIDES on a WORKING sensor — governance defect, not a safety hole.**

## OPEN INCIDENT — Python suite RED on Linux, REPORTS GREEN
**[MEASURED]** pytest step exits `1` in all 8 recent `ci.yml` runs; jobs show
`success` only because of `continue-on-error: true`. 7 source-contract failures
(`test_fix3_cpcv_default.py` ×5, `test_fix4_adaptive_symbol_dst.py` ×2). Tree
truncates at **44%** — >56% has never run in CI; 9 quantum tests skip on Linux.
★★★ **`continue-on-error` STAYS until the tree is green on Linux — a blocking
gate over a red tree blocks every push.** Blocking target = the FULL TREE.
★★★ **STANDING: no ruling may cite "CI green/red" as evidence about Python — cite
a named suite, its command, and its EXIT CODE.** Severity: governance, not
trading-safety (`backtests = 0`, nothing live).

## THE PLAN — money-path ladder (**BLUEPRINT v4, ADOPTED R-445**)
★★★★★ **v4 IS THE OPERATIVE PLAN (operator-directed, adopted R-445). CANONICAL
TEXT: `docs/designs/BLUEPRINT-V4-DRAFT.md` (rev 2, `161f11dc`) — RED-TEAMED by
`accuracy-validator`, all nine findings F1–F9 resolved. Its external-GPT read
(leg 2) is [UNPROVEN] — no tool in this seat.**
★★★★★ **CARRIER-DISCIPLINE RULE (v4 §2.5, now binding): duplicate the LADDER
VERBATIM and POINT at the blueprint for detail. NEVER re-paraphrase — paraphrase
is what eroded this block TWICE (3 of 5 upgrades lost 2026-07-28; the fourth
attribution bin lost by 2026-07-29 and caught only by v4).**
★★★★★ **A TAG-PRESENCE CHECK IS NOT A CONTENT CHECK — R-445's lesson, earned
here: this desk verified "all five `v3-N` tags survived" the compaction and had
silently dropped a bin from INSIDE one of them. Verify the payload, not the label.**
★ **v4 §2.4: the `v3-N` tags exist only in the carriers, never in the ledger
(R-061 numbers them 1..5). A ledger grep for `v3-` returning zero is EXPECTED.**
**READ BEFORE ANSWERING "what phase are we in."**
- **Phase 1 — SPEC COMPILATION (WE ARE HERE).** Exit: ≥1 tier-A spec compiles with
  ALL load-bearing conditions concretely bound AND the compile-fidelity forensics
  gate passes calibration. Pinned before-figure (R-401, cite exactly): `0/16 specs
  fully bound. Flags-off: 0 of 155 bound_and_concrete. Flags-on hypothetical: 6 of
  155. Source: dual-denominator-remeasure-2026-07-21.json, frozen, refresh BLOCKED
  by REVIVAL_FAMILY.` ★★★ **R-409: NOT exitable on corpus_A; dies at BINDING.**
- **Phase 2 — BATTERY / WAVE.** ★★★★★ **v3-1 FAILURE-ATTRIBUTION READ — FOUR
  BINS, NOT THREE**, pre-registered before any verdict is interpreted:
  **{edge-absent · compile-fidelity-loss (approximation residue) ·
  OVERLAY-CONFLICT (house exits vs taught-exit edge) · `gate-artifact`}**
  — **[MEASURED HERE, `ADVISOR-RULINGS.md:6625`, R-061 §1 verbatim].**
  ★★★ **`gate-artifact` = "the instrument lied", and it was DROPPED from both
  carriers until v4 caught it. It is the MODAL real-world failure: four false
  greens in one session, a CI step with no path to red, two advisor exit-1s that
  were not test results. RESTORED R-445 — do not lose it again.**
  ★ **v3-2 OVERLAY A/B**, taught-exit strategies ONLY: pre-registered dual-arm,
  house Style-C exits vs taught exits. ★★ **Trials counted honestly —
  "effective-N tuples distinguish arms" (R-061 §2 verbatim), the anti-double-count
  law for EVERY dual-arm read. Also dropped from the carriers; RESTORED R-445.**
  ★★ **Phase-2 ENTRY now carries a checklist (v4 §4), incl. BATTERY-RIG
  NULL-CALIBRATION: the wave rig has never fired (`backtests = 0`), so before the
  first real wave it must go RED on a planted compile-infidelity and a planted rig
  defect. A rig that has never gone red is not an instrument.**
- **Phase 3 — CONVEYOR, not a queue.** Internal-paper + shadow-accumulation run
  CONCURRENTLY per strategy. ★ **v3-3 EVAL-ODDS PRE-COMPUTE** at pre-flight: aim
  B14/survival at the EVAL's own parameters (Combine trailing DD, profit target)
  per survivor → per-attempt pass probability BEFORE spending an eval.
- **Phase 3→4 — ★ v3-4 DEPLOY-IN-SEASON.** Survivors deploy only when their
  forensics-named regime is LIVE; out-of-season survivors hold in paper standby.
- **Phase 3.5 — FIRST THIRTY FUNDED DAYS**, written BEFORE funding. Payout cadence
  under 20/80 reserve; advisor recommendation on record = CONSISTENCY lane.
  ★★ **v3-5 STOP-GATES SYMMETRIC TO GO-GATES:** eval failed 2× → attribution loop,
  NEVER a blind retry · funded loss-streak → pre-written post-mortem before redeploy.
- **PRE-POSITIONED LAST MILE (operator spend):** when the first real-fidelity wave
  shows promise, brief the operator to buy Combine + TopstepX API THEN (R-060).
★★★ **Five `v3-N` tags. A rewrite dropping one is a REGRESSION (3 of 5 were lost
2026-07-28). Duplicate lives in `advisor-onboarding` §1a; restore from there.**
★★★ **A `BLUEPRINT v4 DRAFT` sits at commit `9116d757` from a consulting seat —
UNREAD, UNRATIFIED, NOT the plan. Read it, red-team it, rule on it explicitly.**

## QUEUE — re-ranked by v4's critical path (R-445)
★★★ **v4 §1: the fastest honest path to Phase 2 is a FINITE, CURRENTLY-UNOWNED
list. Speed comes from aiming, owning and shipping — NEVER from loosening.**
1. ~~Rule the grade → merge PR #32~~ **DONE (R-446, `75065635`).**
2. ~~Wire `ci/__tests__` into CI~~ ★★★ **CANCELLED — the premise was FALSE; those
   tests already run and already block (R-446).** In flight instead: the
   `parseVitestJson` sanity assertion + the `lifecycle-transitions` schema
   diagnostic. ★★★ **THE CI LANE CLOSES ON THOSE TWO — then the money path.**
3. ★★★★★ **v4 §3-1A — THE SEVEN C8 PREREQUISITES, ALL SEVEN OPEN WITH NO OWNER.
   A prerequisite assigned to nobody is a stall order. #2 (two-arm ablation
   pre-registration, incl. the pre-registered trap "conditions-per-strategy WILL
   DROP and that is the fix working") and #3 (name `accuracy-validator` in the
   authorizing ruling) are THIS SEAT'S and are the ratification milestone; #1,
   #4–#7 are the worker's.** ★★ **#1 = the ≥3-quota consumer census: compute the
   TRANSITIVE CLOSURE, not the grep, and publish surfaces + exclusions.**
4. ★★ **v4 §3-1B — UNLOCK-DISTANCE RANKING (cheap, do it FIRST of the build
   work): per spearhead spec, blocking conditions by class under a {C8-fixed}
   counterfactual → ranked list. Instrument-audit: the ranker must REPRODUCE
   R-426's published chain (C8→6 · +C3→15 · … · +C9→120) before its output is
   believed. This converts "re-extract and hope" into "re-extract these named
   videos, expected to fully bind spec X."**
★★★ **RE-RANKED BY v4 §9: the semantic-role-classifier migration (HOLDOUT-26
two-arm shadow, R-434/R-435) is a VALIDITY LANE, **OFF** the Phase-1 critical
path and NEVER a Phase-2 gate. It is no longer queue-position 2. The frozen
rubric stays advisor-owned and unspent; the populations below stay permanent.**
★★★★★ **v4 §12's R-409 RECONCILIATION IS DONE (R-446 seat, 2026-07-29) — ALL
THREE ITEMS DISCHARGED. v4 can stop carrying it as [UNENUMERATED]:**
- **(1) FVG fidelity check — DONE (AR-375 / R-410). Verdict PARTIAL, and the
  divergence runs the SAFE way: [MEASURED, `fvg_native.py:83-84`] the primitive
  uses `low[i] > high[i-2]` (HIGH/LOW) where `-igp`'s teacher taught CLOSE→OPEN —
  a SUBSET of the taught band, so it fires LESS. NOT a stop.** ★★★ **THE SEVEN
  CROSSINGS ARE NOT A LIABILITY, BUT FOUR ARE AN OVERSTATEMENT. Report the flag's
  Phase-1 accounting PER SPEC WITH ITS FIDELITY BASIS, never as a bare "+N
  concrete": `CLDE +3 honest` (teacher left it undefined) · `-igp +4 OVERSTATED`
  (teacher defined close→open) · `WEhm +2 GENUINELY FAITHFUL` (teacher defined
  wick-to-wick = what the primitive implements).** ★★ **FIDELITY IS A PROPERTY OF
  THE PAIR (primitive, spec), not of the primitive — the codebase stores
  `approximation=False` as a property of the binding alone. One flag, two truths.**
- **(2) Flag-yield sweep — DONE (AR-376 / R-411). ★★★★★ THE CITABLE FIGURE IS
  `0 → 10` IN `runtime-production` (the executing lane) — cite that pair.
  The campaign lane reads `1 → 11`. Δ = +10 IN BOTH; the divergence inflated both
  endpoints by one and changed no unlock count.**
  ★★★★★ **THE `1` IS NOT A PHANTOM CLASSIFICATION — CORRECTED R-447. [MEASURED,
  AR-377] it is a REAL row (`W7nlnHTUZQU__s0 [6] prim=session_windows apx=False`)
  present in the campaign lane and ABSENT in the executing lane —
  `spec_family_bindings.py` 160,049 B vs 35,046 B. R-411 and AR-377 were BOTH
  RIGHT, ABOUT DIFFERENT TREES. It is SUPERSEDED and TREE-KEYED, **NOT DELETED**:
  it is the anchor of the R-415 lane-divergence gate (v4 §3-1E). THE FIX FOR A
  NUMBER MEASURED IN THE WRONG TREE IS TO KEY IT TO ITS TREE, NEVER DELETE IT.**
  ★★ **What IS withdrawn: the `off=1` had been used to explain away a discrepancy
  against the 2026-07-21 artifact. In the executing lane there was never a
  discrepancy. An explanation offered for a discrepancy is itself a claim.**

★★★★★ **THE FIDELITY LEDGER IS THE AUTHORITATIVE RECORD — THE AGGREGATE IS
SUBORDINATE TO IT (operator directive, R-447). "UNLOCKED" ≠ "EXACT".**
| spec | n | class |
|---|---:|---|
| `WEhm…__s0` | 2 | **SOURCE-DEFINED EXACT** (teacher defined wick-to-wick = the primitive) |
| `-igp…__s0` | 4 | **SOURCE-DEFINED MISMATCH** (teacher close→open; primitive high/low; **STRICTER**) |
| `CLDE…__s0` | 3 | **CANONICAL DEFAULT** (teacher never defined the term) |
| `kFyD…__s0` | 1 | **CANONICAL DEFAULT** |
| — | 0 | **UNVERIFIED** |
★★★★★ **NO SPEC IS IN THE DANGEROUS DIRECTION (primitive LOOSER than teacher —
which manufactures trades the teacher never sanctioned). Every deviation in the
ten runs CONSERVATIVE.** ★★★ **FIDELITY IS A PROPERTY OF THE PAIR (primitive,
spec), NOT OF THE PRIMITIVE — one `compute_fvg_signal`, three truths. The DB
stores `approximation=False` on the binding ALONE, which is why a bare "+N
concrete" looked uniform.**
★★★ **REPORTING LAW (R-447): always separate `newly bindable` · `source-defined
exact` · `canonical-default` · `conservatively mismatched` · `unsafe/unresolved`.
The headline MAY say "10 newly bindable"; it MAY NOT say "10 exact" — only 2 are.**
- **(3) corpus_B charter — EXISTS and is COMMITTED:
  `docs/designs/CORPUS-B-CHARTER-2026-07-29.md` (`276b2c00`, AR-391; later scoped
  as R-424 item (1)). Status line: "CHARTER ONLY. No extraction run is authorized
  by this document." ★★ It names its tree and re-derived three sha256s itself —
  measured in `wt-preflight-blockers-20260729`, sha-identical to
  `runtime-production`, explicitly NOT the campaign tree.**
  ★ **[NOT MEASURED] whether any ruling RATIFIED it: a filename grep of the ledger
  returns 0, but that is a weak instrument (a ruling may name it as "the charter"),
  and this desk was burned by exactly that grep-shape today. Treat as UNRATIFIED
  until read, not as unratified by proof.**
★★ **Still advisor-owned and open (v4 §9): the `C2` session-role resolver yield —
RUN IT, a post-C8 multiplier · maintain `STRANDED-CAPABILITY-REGISTER.md`.**
★ **v4 §9 bound on the CI lane, which is where the worker is now: "governance;
NEVER a merge gate for spearhead packets." Do not let it grow into one.**

## POPULATIONS — PERMANENT
**`DEV-14`** — contaminated (13 of 14 straddle its own row-hashed "held-out"
split: GROUP LEAKAGE). Fixtures/debug/controls only, **never the independent
claim**. **`HOLDOUT-26`** — the valid internal holdout, **spent the moment it is
used to tune**, not a permanent benchmark. ★★★ **NEVER averaged into one
headline. Split by SOURCE VIDEO ID, never by row — the VIDEO is the independent
unit.** Success = semantic fidelity, **NEVER pass-count**; a LOWER count is
acceptable, a HIGHER one proves nothing unless every newly-droppable condition is
transcript-grounded. ★★ Fail-closed: no evidence → `CLASSIFICATION_UNAVAILABLE`;
labeller error → `CLASSIFICATION_ERROR`. **Legacy fallback may be MEASURED, never
presented as a semantic decision.**

## NOT AUTHORIZED
★★★ **Relaxing ANY refusal class — including `spine` — before a validated
type-keyed replacement exists. This migration can only ADD refusals.**
Writing classifications to the DB · tuning the labeller on HOLDOUT-26 this cycle ·
flipping `TF_SEMANTIC_ROLE_CLASSIFIER` · promoting `trigger` · remapping roles ·
mutating any stored `compiled_spec` or role field in place · `C8` implementation
(HELD on 7 prerequisites) · re-extraction · spec edits · `.env` writes ·
`runtime-production` writes · tower update · `db:generate` · editing applied
migrations · deploying the 160KB campaign binding lane (R-415) · removing
`continue-on-error` · `git checkout`/`reset` in this shared tree.

## STATE, WITH EVIDENCE GRADES
**[MEASURED HERE]** `backtests total = 0` · `strategies = 120` · **no live
execution, no connected capital.** Tower `a6f92822`; both safety releases DEPLOYED
and verified in the running tree. **LANDED ≠ RUNNING** — merging PR #31 did not deploy.
**[MEASURED HERE]** ★★★ **`role` IS TOPOLOGY, NOT SEMANTICS:** `graph-to-engine.ts:93`
`inAndGroup.has(a.id) ? "confluence" : "spine"` — reads nothing from source.
**`spine` WITHDRAWN as evidence of source-mandatory status.** The join IS proven
for `trigger` (`:141-142`). **PROVENANCE RULE: `spine + unbindable` → still REFUSE,
record `UNKNOWN_REQUIREDNESS`, NEVER "the source required this."**
**[MEASURED HERE]** `POP-120-LIVE` = **40 videos × 3, triples byte-identical** —
every raw count inflates 3×; **sizing is ALWAYS per-video.**
**[MEASURED HERE]** 1458/1458 pointers resolve (100%); `'},{'` debris 28.5%
resolves to nothing; ≈71.5% source-gradeable. ★★ **A working chain is NOT a
faithful extraction** — `'timeframe'` resolves perfectly to a real sentence.
**[RELAYED]** HOLDOUT-26: rules fire on **4.1%**, `LEGACY_FALLBACK` **95.9%**.
Flipping the flag today would stamp SEMANTIC provenance on the 96% a TOPOLOGY
heuristic decided. ★★★ **Rule expansion is FORBIDDEN until a fresh untouched
population is named FIRST — HOLDOUT-26 burns the moment anyone tunes on the 4.1%.**
**[RELAYED]** `C8` = 51.1% of blockage, the only class unlocking anything alone;
the prompt ORDERS it (`transcript-extractor.md:169`/`:171`/`:616`).
**[UNENUMERATED — OPEN]** the 156 entries individually · the 20 span
disagreements · non-flag-gated stranded capability · C2 resolver yield · DB
provenance preservation · timezone/calendar basis · Python's unrun 56%.

## KNOWN-BENIGN (do not investigate)
★★★ **THE 15-MIN WATCHDOG BAR IS SHORTER THAN THE R-446 TASK'S AUTHORIZED ~40-MIN
ETA, SO IT WILL FIRE ON A HEALTHY RUN. Do NOT widen the bar** (that blinds it to
real stalls) — read the event, then apply the discriminator.
★★★★★ **FOUR INSTRUMENT LIES IN ONE SESSION, ALL THE DESK'S OWN, NONE A DEFECT IN
THE WORK UNDER REVIEW: `| tail` masked a `gh` exit code · a scratch vitest config
resolved `vitest/config` from outside `node_modules` (exit 1 = MODULE_NOT_FOUND,
not a red suite) · a suite run in a tree that does not contain the file (`No test
files found`, exit 1 — would have reported a green suite as RED) · `comm -23`
under a locale mismatch reported 19-of-19 files missing when the true answer is
ZERO — that one would have escalated a non-incident.** ★★★ **AN EXIT CODE IS NOT
A VERDICT UNTIL YOU KNOW WHAT PRODUCED IT. A surprising result is an accusation
against your tooling FIRST; "too total to be plausible" is what caught the last
one, and implausibility is a weak guard.** ★ **DISCRIMINATOR: process ALIVE + conversation `.jsonl` STILL
GROWING ⇒ silent work · ALIVE + conversation STOPPED ⇒ external account limit
(seen 2026-07-29, an hour of silence was a usage limit) · not alive ⇒ dead.**
★★★★★ **NEW, AND IT IS A LIVE WAY FOR CI TO GO RED (PR #33, intended): if the
`fast` lane fails with `vitest_report_malformed: unrecognized assertion status
(<name>=N)`, THAT IS NOT A BROKEN SUITE — a vitest upgrade added a status value.
FIX: add it to `KNOWN_STATUSES` in `ci/compare-baseline.mjs`. One line. The error
names the offender.** ★★ **This is fail-loud replacing fail-quiet and it is the
correct trade — but it is a NEW failure mode, disclosed by the worker who shipped
it rather than discovered by a later seat at 3am.**
★★ **Merged worktrees `wt-ci-abspath-20260729` and `wt-parser-sanity-20260729`
may be removed BY EXPLICIT PATH whenever convenient — branches merged, left in
place deliberately. ★★★ `Remove-Item -Recurse` on a Windows JUNCTION deletes the
TARGET; the outgoing worker removed both junctions reparse-safely and VERIFIED
the real `node_modules` intact at 329 entries.**
`M session_windows_parity.json` phantom · a monitor event naming an OLD AR = torn
mid-write read · `.playwright-cli/` = operator tooling · **`| head`/`| tail` MASK
EXIT CODES** · `pytest-timeout` NOT installed here (`--timeout` ⇒ exit `4`).

## ★★★ THE SEAT'S OWN CONVICTED ERROR — READ BEFORE MEASURING ANYTHING
**ONE SHAPE, now six times: I measured a NEIGHBOURING OBJECT and reported it as
the one asked about.** ★★★ **THE JOIN KEY IS NOT A DETAIL OF THE QUERY — IT IS THE
CLAIM. State the key, and state what your filter EXCLUDED.**
★★★ **`NAME THE TREE` — R-444 broke it 90 min after re-copying it here: a
`grep -rn` in the CAMPAIGN tree published as a claim about the DEPLOYED lane.
WHEN THE CLAIM IS ABOUT CI, SWEEP WITH `git show <tested-sha>:<path>`, never in
whatever checkout your shell is sitting in.**
★★★ **A COMPLETION SIGNAL IS NOT A RESULT** (four false greens in one session).
**VERIFY THE ARTIFACT. Every mutation asserts its own edit TOOK.**
★★★ **MY ORDER IS NOT EVIDENCE. The worker stopped instead of obeying a wrong
order and was right. Do not damp that loop in either direction.**
★★ **A replacement that silently degrades to its predecessor reports agreement
with itself and calls it validation. Prove the new thing RAN, per item.**
★★ **A true finding is the most dangerous moment for a guard** — correct premise +
unbuilt replacement + enormous convenience is how good desks ship regressions.

## SEAT MECHANICS
★★★ **TREE: `C:/Users/tonio/Projects/wt-h1-wave4-20260712`, branch
`h1-wave4-sealed12-driver`** — NOT the primary cwd (a container of ~90 worktrees).
"Relay files missing" = wrong tree, never a vanished campaign.
★★★ **INVOKE `advisor-ruling` BEFORE EVERY RULING** (it mutates). **Every ruling
authorizing work opens with a cold-start-complete `★ WORKER — START HERE` block
(R-430); when RECORD and DISPATCH compete, the DISPATCH wins.**
★★★ **INDEPENDENT GRADES GO TO THE `accuracy-validator` AGENT** — never parked on
"the advisor seat" or "a fresh session". Route EARLY, not as a final formality.
★★★★★ **EXTERNAL REVIEW — RULED `SCOPED OUT` (R-449). The universal pre-ruling
requirement is WITHDRAWN: no ruling blocks awaiting one, because a universal rule
is structurally incompatible with the operator's "nothing waits on me" order and
would either stall the campaign or be silently skipped (it WAS, for R-445..448).
It is now OPERATOR-INVOKED BY RELAY — the operator is the mechanism; there is no
tool in this seat.** ★★★ **Every relayed read is carried as `[EXTERNAL OPINION]`,
named as an input, premises AUDITED — never `[MEASURED]`, never adopted wholesale.
Three have now arrived flawed: an "R-436" citing counts no AR had reported · an
"R-440" colliding with a live ruling · an undefined metric `unlock distance`.**
★★★★★ **STANDING BAN: no advisor report may state or imply an external review
occurred when it did not.** ★★ **Agreement between two readers is NOT evidence;
disagreement resolves by MEASUREMENT. The desk MAY flag that a decision would
have benefited from a read — as a named gap, never as a block.**
★★ **YOU DECIDE:** merges · worktree updates · deploys of verified work ·
reversible CI-gated production writes · tooling. **Reserved to operator:** real
capital · spend · irreversible destruction · unboundable blast radius.
★★ **DOCTRINE IS VERSIONED:** `.claude/` is its own git repo on
`origin ops/claude-doctrine`; the directory IS canonical, not a backup. Edit in
place; never `git init` a second copy.
**RIG (2026-07-29 01:16, one rig):** AR content-hash 2s poll (task `b8fonkiwn`) +
15-min idle watchdog (task `b8vrsg6e2`), both mine, both delivery-proven in this
conversation. ★★★ **The `ADVISOR-RULINGS.md` watcher PID 22820/7256 under
`claude.exe` 9444 is THE WORKER'S EAR — never kill it.** ★★ **Watchers inherited
from a prior conversation can be ALIVE yet absent from `TaskList` — alive ≠
delivering. Empty `TaskList` ⇒ retire and re-arm, then verify the gap is empty.**

## OPERATOR-FACING
**Nothing waits on you.** The fresh worker is seated and running (AR-426).
★★ **CLOSED: the external-review gap is no longer an open ask — R-449 ruled it
`SCOPED OUT` / operator-invoked. You invoke it when you want it; the desk never
claims one happened when it did not.**
Nothing has ever run a backtest; no capital is connected.
★★ **A correction was owed and is delivered: the earlier "your kill switch has a
hole" alarm was WRONG — the kill switch and compliance gate pass. The real issue
is 156 stale entries on a CI allow-list that could hide FUTURE breakage.**
★★ **Strategic: FIVE built-but-disabled capabilities exist, three aimed at the
three largest blockers. The bottleneck may be SHIPPING, not building** — see
`STRANDED-CAPABILITY-REGISTER.md` before commissioning any new detector work.

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
Ledger **R-445**. Newest AR **AR-420 — RULED (accepted in full)**.
**TASK (R-445):** classify the **23 baseline entries ABSENT from the report** —
`RENAMED` / `DELETED` / `COLLECTION-ERROR` / `UNKNOWN` — plus a one-line
ENVIRONMENTAL-vs-LOGIC call on each of the **9 still-failing**. ETA ~30 min.
★★★ **ARMED STOP: any of the 23 that traces to a COLLECTION ERROR means that
file's other tests are also silently not running — the absent population is then
bigger than 23. Comes to the desk immediately.**
★★★★★ **MERGE OF PR #32 IS HELD ON ONE THING: the MANDATORY independent grade of
an INSTRUMENT change (`compare-baseline.mjs`, now BLOCKING at `ci.yml:167`).
`accuracy-validator` dispatched against `af5779ef` itself. HOLD IS ASSIGNED TO A
NAMED RUNNING AGENT, not a future session.** ★★★ **WORKER MUST NOT PUSH TO #32
while the grade is in flight — a moving head voids the grade.**
★★ **PR #32 worktree: `C:/Users/tonio/Projects/wt-ci-abspath-20260729` (branch
`hardening/ci-abs-path-tests-20260729`, head `af5779ef`). The campaign tree does
NOT contain `ci/__tests__` at all — running its suite here reports a false RED.**
★★★ **AR-420 RESULT: the ran-and-passed discriminator fired on first contact —
of 156, only **132** had actually run and passed; **23 absent + 1 skipped** would
have been deleted for never having executed. Worker fixed the INSTRUMENT, not
just the data. Baseline `189 → 165 → 33`.**
★★ **[MEASURED HERE] `ci/__tests__` (22 tests, TWO files) is not matched by
`vitest.config.ts:13`'s `src/**/*.test.ts` and nothing references it — the gate
that guards every push has tests that never run in CI. QUEUED after the grade.**
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
1. **Rule the `accuracy-validator` grade → merge PR #32** (in flight).
2. **Wire `ci/__tests__` into CI** (worker, after the grade — one-line include;
   it touches the graded files, hence the ordering).
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
★★ **Also advisor-owned, parallel and cheap (v4 §9): the `C2` session-role
resolver yield — RUN IT, it is a post-C8 multiplier · maintain
`STRANDED-CAPABILITY-REGISTER.md` · reconcile R-409's authorized items (v4 §12,
[UNENUMERATED]) BEFORE any corpus_B dispatch.**
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
★★★ **THE 15-MIN WATCHDOG BAR IS SHORTER THAN AR-421's AUTHORIZED ~30-MIN ETA
(started 01:31 EDT, + a BLUEPRINT v4 read), SO IT WILL FIRE ON A HEALTHY RUN.
Expect a fire ~01:46 EDT and possibly ~02:01. Do NOT widen the bar** (that blinds
it to real stalls) — read the event, then apply the discriminator. ★ **DISCRIMINATOR: process ALIVE + conversation `.jsonl` STILL
GROWING ⇒ silent work · ALIVE + conversation STOPPED ⇒ external account limit
(seen 2026-07-29, an hour of silence was a usage limit) · not alive ⇒ dead.**
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
★★ **STANDING (operator): get an EXTERNAL (GPT) opinion BEFORE writing a ruling,
carried as `[EXTERNAL OPINION]`, never `[MEASURED]`. Agreement is not evidence;
disagreement resolves by MEASUREMENT. Audit its premises.**
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
Nothing waits on you. Nothing has ever run a backtest; no capital is connected.
★★ **A correction was owed and is delivered: the earlier "your kill switch has a
hole" alarm was WRONG — the kill switch and compliance gate pass. The real issue
is 156 stale entries on a CI allow-list that could hide FUTURE breakage.**
★★ **Strategic: FIVE built-but-disabled capabilities exist, three aimed at the
three largest blockers. The bottleneck may be SHIPPING, not building** — see
`STRANDED-CAPABILITY-REGISTER.md` before commissioning any new detector work.

# ADVISOR-STATE — money-path / H1 seat

> **Rewritten in place, never appended.** Cold-start read: this file, then the
> last 3–5 rulings, then the newest 1–2 ARs. Never read the ledger from the top.
> Last rewritten: 2026-07-28, current through **R-401**.

## SEAT
Ledger at **R-401**. Newest AR: **AR-366, RULED**. Worker: **ACTIVE on the SMC
build** (authorized R-401; first observable = a RED SMC test, ~30 min, or a
START-RECEIPT). Rig: 2s content-hash report poll + 15-min idle watchdog — **one
rig, never new-plus-old**; the `ADVISOR-RULINGS.md` watcher under the OTHER
`claude.exe` is the worker's ear, never kill it.

★★★ **INVOKE `advisor-ruling` BEFORE EVERY RULING** (skill §0.-1). Ruling from
memory collapsed §7 compliance 4.0/10 → 0.1/10, and **the skill file mutates**,
so a remembered copy is a stale copy. Enforced by hook.
★★ **YOU DECIDE** (operator-ordered): merges · worktree updates · deploys of
verified work · reversible CI-gated production writes · model/tooling choices.
Reserved to the operator, SHORT: real capital · spend beyond envelope ·
irreversible destruction · unboundable blast radius. Worker stop-and-asks route
to THIS DESK. Never answer from ignorance when `WebSearch` exists.
★★ **NAME THE JOIN KEY** (R-400): six desk errors in one day were two true things
welded by an unchecked correspondence. State the key, or grade the claim.

## THE PLAN — money-path phase ladder (BLUEPRINT, R-053..R-061)
**READ THIS BEFORE ANSWERING "what phase are we in."** It lives in the ledger's
EARLY rulings, which the cold-start order tells you never to read — so it is
invisible unless carried here. That gap cost a wrong operator answer (R-396).

- **Phase 1 — SPEC COMPILATION (WE ARE HERE). EXIT NOT MET, AND NOW MEASURED.**
  Exit: *"≥1 tier-A spec compiles with ALL load-bearing conditions concretely
  bound."* ★★★ **PINNED BEFORE-FIGURE — cite in this exact form (R-401):
  `0 / 16 specs fully bound. Flags-off: 0 of 155 conditions bound_and_concrete.
  Flags-on hypothetical: 6 of 155. Best spec 1/6 (hypothetical). Source:
  dual-denominator-remeasure-2026-07-21.json, frozen 2026-07-21, refresh BLOCKED
  by REVIVAL_FAMILY.`** Verified at this desk by re-derivation: totals
  155/6/27/128, algebra `n_taught == n_bindable + n_unbound` holds 16/16, specs
  with `bound == taught` = **0**. **Supersedes R-398's "this gate has no meter"**
  — the meter was never needed; the quantity was already on disk, ungrouped.
- **Phase 2 — BATTERY / WAVE.** Failure-attribution pre-registered BEFORE any
  verdict (edge-absent · compile-fidelity-loss · overlay-caused); overlay A/B.
- **Phase 3 — CONVEYOR, not a queue.** Internal-paper + shadow-accumulation run
  CONCURRENTLY per strategy. Pre-flight: eval-odds against the Combine's own
  trailing-DD + profit-target parameters.
- **Phase 3→4 — DEPLOY-IN-SEASON.** Survivors deploy only when their
  forensics-named regime is LIVE; out-of-season survivors hold in paper standby.
- **Phase 3.5 — FIRST THIRTY FUNDED DAYS**, written BEFORE funding. Advisor
  recommendation on record: CONSISTENCY lane. Stop-gates symmetric to go-gates.
- **PRE-POSITIONED LAST MILE (operator spend):** when the first real-fidelity
  battery wave shows promise, brief the operator to buy the Combine + TopstepX
  API THEN — adapter shakes down against practice before real capital.

★ The broker-safety chain (R-359..R-401) is **not on this ladder** — it is the
"nothing live" hardening that must hold before any phase runs with money. **It
closed and deployed today.**

## AUTHORIZED NOW (worker, in order — no round-trip needed)
1. **SMC BUILD** (R-303 §5, R-401). Allowed: the SMC family implementation + its
   tests. Red-proofed at birth. ★ **The declared primitive must actually
   EXECUTE** (R-153) — a family whose declared primitive is not the one it runs
   is the POINTER LIE, convicted 3× here. Forbidden: the four frozen
   instruments, the specs, `dual_denominator_remeasure.py`.
2. **Date-stamp `OUT_PATH`** — `dual_denominator_remeasure.py:103` hardcodes
   `dual-denominator-remeasure-2026-07-21.json`; a future publish would overwrite
   the pinned evidence of record under a false date.
3. **Diagnose the two misdirected revival probes** (`SESSION_ACKNOWLEDGMENT_
   ENTRY_WITHDRAWN`, `..._PAIR_DRIFTED`, both declared `ws_session_resolvable <=
   graded_teachings`, both observed `NO_ASSERT_FIRED`). **Report the diagnosis;
   repair only after I rule on it.**

## NOT AUTHORIZED (worker)
Real-capital actions · spend · credential decryption · `.env` writes · defaulting
`BROKER_KEY_PROBE_ENABLED` ON · weakening the F-2 or call-site guards · running
the producer **without `--draft`** · editing frozen instruments or specs.

## STATE, WITH EVIDENCE GRADES
**[MEASURED HERE]** Tower runs **`f5b5b10d`**. Both paper rows read `paper_sim`
on the LIVE DB; **zero rows of any firm remain `traderspost`** — migration 0159's
written contract is enforced in schema for the first time. Broker-egress
chokepoint live: `broker-router` has 0 `fetch(` calls, CI fails the build if any
other module reaches a broker host. Boot probe inert on import in every flag
state; derived `<FIRM>_API_KEY` fallback gone.
**[MEASURED HERE]** Phase-1 figures re-derived from the artifact (see THE PLAN).
**[MEASURED HERE]** Ledger branch `h1-wave4-sealed12-driver` is **on origin** —
before R-385 it existed on no remote at all (747 commits, on the box that
bugchecked that day).
**[RELAYED — worker, not re-run here]** The producer **runs but refuses to
publish**: `GUARD REFUSED: REVIVAL_FAMILY`, exit 2. ★ **That is a PASS** — its
red-proof machinery caught two probes that fired nothing, and it declined to
certify. **Stale by refusal, not by neglect.**
**[MEASURED — worker]** Draft mode honest: target artifact byte-identical across
3 draft runs; `publish_artifact()` refuses via `SystemExit`, not `assert` (so
`python -O` cannot strip the gate).
**[ARTIFACT-SOURCED, 7 days old]** the whole Phase-1 reading.
**[UNPROVEN]** whether the two probes are misdirected by legitimate renames or
by a real regression — item 3 above.
**[MEASURED HERE]** Suite baseline 13,440 tests / **9 known failures — a
tripwire: if it rises unexplained, something got baselined instead of fixed.**
**[MEASURED HERE]** `migrations/schema.ts:2377-2378` is **doubly stale** —
**never `db:generate`**. `0159` is permanently non-idempotent BY DESIGN.
**[MEASURED HERE]** The operator is a **THIRD WRITER** on runtime-production —
read `status -sb`, never a one-directional rev-list.
**[UNENUMERATED — OPEN]** the 0x9F bugcheck driver (`MEMORY.DMP` retained);
`npm install` at boot ≠ `npm ci`; deploy records exist only as ledger entries,
no standing mechanism; 24 untracked `docs/designs/` files (another campaign's).

## HAZARD REMOVED (R-394) — do not recreate
`wt-codex-transcript-vault/node_modules` was a **junction into the RUNNING
tower's `node_modules`** (322 pkgs). One `npm ci` there would have taken the live
API down (the 07-18 rails class). Cut non-recursively; target verified intact;
**0 junctions now point at `runtime-production`.** ~25 others point at the
campaign checkout — same shape, lower stakes.

## KNOWN-BENIGN (do not investigate)
`M src/engine/tests/fixtures/session_windows_parity.json` — phantom, verified
twice. · A monitor event naming an OLD AR number = torn mid-write read. · Three
red CI badges on one PR = one defect mirrored. · `.playwright-cli/` untracked in
runtime-production = operator tooling. · **`| tail` / `| head` MASK EXIT CODES**
— re-run unpiped before believing any exit status.

## OPERATOR-FACING
Nothing waits on you. 3am-agent decision on record: **GPT-5.6 Sol on flex**
(needs a retry + fallback tier for flex capacity misses; first nights
observe-only). `.claude/skills/` is still disk-only, no backup.

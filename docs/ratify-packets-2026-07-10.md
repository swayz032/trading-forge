# Ratify Packets — staged 2026-07-10, awaiting explicit operator go per item

Per skill `ratify-packet`: staged, not started. No code has been written for either
packet below. Landing this document is NOT authorization — each packet needs the
operator to address it by name with an explicit go before any file in "Exact change"
is touched.

---

## Packet 1 — Daily-trade-cap counts partial-close legs as separate trades

### 1. What & why now

`bookPartialClose()` (`src/server/services/paper-execution-service.ts:3543-3663`)
writes one `paper_trades` row per Style C partial leg (TP1, TP2, runner) in addition
to the position's own row. All three of this codebase's daily-trade-cap
counting sites do a bare `count(*)` over `paper_trades` with no per-entry dedup, so
a single winning trade that plays out its partials can single-handedly exhaust or
exceed `TF_MAX_TRADES_PER_DAY` (default 2) and wrongly block the operator's
legitimate 2nd A+ trade of the day.

Concrete repro (traced, not executed against a live DB this session — the exact
scenario a fresh test should assert):
- Session cap = 2. Entry #1 fires 09:35 ET, hits TP1 (row 1, exitTime 09:50), TP2
  (row 2, exitTime 10:20), runner closes 11:00 (row 3). `tradesToday` = 3 ≥ cap(2).
- Entry signal #2 (the real 2nd A+ setup) fires 13:00 ET → blocked with
  `daily_trade_cap_reached: 3/2`, even though only ONE entry actually happened.

This directly undermines the "1-2 A+ trades/day" mandate that the whole sizing
philosophy (CLAUDE.md §4/§5) is built on.

**A correct fix for 2 of the 3 sites was already written, tested, and committed**
as commit `c3845297` ("fix(paper-parity): ... + daily cap counts entries not legs
(F-5)", 2026-06-29) — but only on the unmerged branch
`hardening/inst-10of10-2026-06-29`, which never landed on `hardening/phase-0` or
`main`. `git merge-base --is-ancestor c3845297 <hardening/phase-0 tip>` → NOT an
ancestor. That commit also bundles an unrelated fix (F-3, BE+1 stop timing) — this
packet scopes ONLY the F-5 daily-cap portion; F-3 is a separate, not-yet-evaluated
finding and is explicitly OUT of scope here.

### 2. Blast radius

- Changes the daily-trade-cap gate's counting basis for ALL sessions, all firms,
  retroactively changes nothing (no backfill — this is a live-counting query, not
  a stored value).
- Any strategy using Style C partial exits (the canonical default per CLAUDE.md §4)
  is affected. Strategies with adaptive exits that don't partial-close are
  unaffected either way (1 row = 1 row regardless of counting basis).
- No DB schema change. No migration. Both `paper_trades` and `paper_positions`
  tables already exist and are already written by the same code paths.
- Downstream: nothing else reads these specific count queries — they're gate-local,
  computed fresh per signal/fill, never persisted.
- Does NOT touch the Python kill-switch's OWN counting (`paper-execution-service.ts`
  Python-adjacent code, separate from the 3 TS sites below) — that's a distinct
  belt-and-suspenders layer, not evaluated for a parallel gap this session.

### 3. Exact change, scope-locked

Three call sites, all following the identical pattern already proven at 2 of them
in `c3845297`:

1. `src/server/services/paper-signal-service.ts:3573-3580` (signal-time HARD gate).
   Swap `.from(paperTrades)` → `.from(paperPositions)`, and
   `paperTrades.exitTime` → `paperPositions.entryTime` in both the `eq(...sessionId)`
   and the `to_char(...)` day-key expression. Exact diff shape shown in `c3845297`.
2. `src/server/services/paper-signal-service.ts:2686-2690` (fill-time re-check gate).
   Same swap, same shape — also already in `c3845297`.
3. `src/server/services/paper-execution-service.ts:1206-1220` (belt-and-suspenders
   Python kill-switch feeder — **the 3rd site `c3845297` did not cover**). Currently
   reads `.from(paperTrades)` with `paperTrades.entryTime` (already on the correct
   *entryTime* convention per its own "F2" comment, but still counts one row per
   partial leg since every leg is stamped with the position's shared `entryTime`).
   Same table swap: `.from(paperTrades)` → `.from(paperPositions)`,
   `paperTrades.entryTime` → `paperPositions.entryTime`.

Explicitly OUT of scope: the F-3 BE+1 timing fix bundled in `c3845297`; any change
to `bookPartialClose()` itself (it should keep writing per-leg `paper_trades` rows —
that's correct for P&L/audit granularity, the bug is purely in what the CAP counts,
not in what gets recorded).

### 4. Verification plan

- Port `c3845297`'s 12 vitest tests (`paper-parity-runner-exits-f1-f3-f4-f5.test.ts`)
  — but hand-port only the F-5-scoped assertions (skip F-1/F-3/F-4, which are
  either already fixed on phase-0 or out of scope per above); verify against
  CURRENT code, not blind cherry-pick, per this repo's own divergent-history lesson.
- Add ONE new test for the previously-uncovered 3rd site
  (`paper-execution-service.ts`'s kill-switch feeder) proving 1 entry + 3 legs = 1
  against the cap.
- Live-trace: construct a session with cap=2, simulate 1 entry with 3 partial-close
  legs + 1 fresh entry, confirm the 2nd entry is NOT blocked (currently would be, at
  3 ≥ 2).
- Run full `paper-signal-service` + `paper-execution-service` vitest suites to
  confirm zero regressions (these are high-traffic files with hundreds of existing
  tests).
- tsc clean + all 3 CI hard gates green before landing.

### 5. Rollback

Three single-line-per-site table/column swaps, fully reversible via `git revert` —
no migration, no data mutation, no persisted state changed. Reverting restores the
current (bugged) counting basis with zero side effects.

---

## Packet 2 — Confluence sizing multiplier silently pinned at 1.0× (schema drift)

### 1. What & why now

The Wave 23H.4 confluence→sizing multiplier
(`src/server/lib/risk-sizing.ts:83-100`, `resolveConfluenceMultiplier`) is driven by
`confluenceCount`, computed at `src/server/services/paper-signal-service.ts:5253-5264`
by reading `entry_quality.confirming_indicators` — i.e., it expects
`confirming_indicators` NESTED under `config.entry_quality`.

But the canonical graduation function `graduateBucketDirectly`
(`src/server/services/direct-bucket-graduator.ts:2788-2793`, live since Wave 26
Pass I / 2026-05-25) writes `confirming_indicators` as a TOP-LEVEL SIBLING of
`entry_quality`, not nested inside it. The `EntryQualityWithSources` type
(`direct-bucket-graduator.ts:373-383`) that types `entry_quality` has no
`confirming_indicators` field at all — it cannot structurally carry one.

**Repro (traced against current code, matches an already-existing project test
fixture that never exercises the real write path):** on the fixture from
`wave23h-confluence-sizing-wiring.test.ts` (MFFU $50K, ATR=4, base=6, 3 genuine
confirming factors, intended `confluenceCount=4` → `finalContracts=12`), production
actually computes `finalContracts=6` for any strategy that went through the real
graduator — a permanent 50% under-size. `entryQualityForSizing?.confirming_indicators
?? []` always evaluates to `[]` for graduator-produced strategies →
`confluenceCount = 0 + 1 = 1` → `resolveConfluenceMultiplier(1) = 1.0` → no upsize,
ever, regardless of real confluence strength.

**The same root-cause mismatch also silently breaks the `faithful` Pine-export
flag** (`src/engine/exportability.py:403-435`, a separate held finding) — worth
fixing together since both stem from one schema decision.

### 2. Blast radius

- **Every strategy graduated via `graduateBucketDirectly` since 2026-05-25** (the
  current default population going forward) is affected — this is not a rare edge
  case, it's the current steady-state behavior for all new graduations.
- Re-baselines nothing retroactively by itself (this is a live sizing computation,
  not a stored value) — but any *comparison* of position sizes before/after this
  fix will show a real, intended increase for confluence-rich strategies. This is
  a genuine behavior CHANGE (bigger real-money position sizes for qualifying
  signals), not a no-op bugfix — flag this explicitly to the operator: fixing this
  makes the bot size UP on strategies with 2+ real confirming factors, closer to
  the system's own documented intent.
- Touches `direct-bucket-graduator.ts` (the graduation write path) and/or
  `paper-signal-service.ts` (the sizing read site) depending on which side is
  chosen as authoritative (see two options below) — either choice is scoped to a
  handful of lines, but they have different blast radii.
- Interacts with the separately-confirmed `faithful` flag bug — a fix here that
  moves `confirming_indicators` to the correct schema location may also partially
  fix that bug's downstream consumer path; NOT claimed as a full fix for it
  (that flag ALSO needs `exportability.py` itself updated to check the field,
  which is untouched by either option below).

### 3. Exact change, scope-locked — TWO OPTIONS, OPERATOR TO CHOOSE

**Option A (root-cause fix, larger blast radius, fixes it for every consumer at
once):** Add `confirming_indicators` to `EntryQualityWithSources`
(`direct-bucket-graduator.ts:373-383`) and change the graduator's config-assembly
(`:2788-2793`) to nest it inside `entry_quality` instead of writing it as a
top-level sibling. This fixes the sizing multiplier AND the Path-A signal-time
gate (`confirming-indicator-evaluator.ts`, which reads the same nested path) AND
sets up the `faithful` flag fix to actually see the field, in one change. Risk:
`critique-knowledge-retriever.ts:241,281` currently reads the TOP-LEVEL location —
that call site would need updating too, or a temporary dual-write, to avoid
breaking it.

**Option B (narrower, lower blast radius, patches the read sites only):** Change
the 2 known read sites (`paper-signal-service.ts:5253-5264` sizing,
`paper-signal-service.ts:4737` Path-A gate) to fall back to the top-level
`config.confirming_indicators` when `entry_quality.confirming_indicators` is
absent. Leaves the graduator's current (top-level) output shape alone — matches
what `critique-knowledge-retriever.ts` already expects, so zero risk to that
consumer. Does NOT by itself help the `faithful` flag bug (which is `exportability.py`
reading neither location today — needs its own line regardless of which option
is picked here).

**Recommendation: Option B first** (lower risk, immediately closes the sizing +
Path-A gate bugs, no risk to the existing top-level consumer) — Option A can be a
later, deliberate schema-unification pass once the operator has seen Option B live
for a while. This packet defaults to Option B's scope unless the operator says
otherwise.

Explicitly OUT of scope: the `faithful` flag fix itself (separate held finding,
needs its own packet); any change to `critique-knowledge-retriever.ts`.

### 4. Verification plan

- Extend `wave23h-confluence-sizing-wiring.test.ts` and
  `confluence-sizing-hardening-2026-06-30.test.ts` to construct the config the way
  the REAL graduator produces it (top-level `confirming_indicators`), not the
  hand-built nested shape they use today — this is the coverage gap that hid the
  bug; closing it is part of the fix, not optional.
- Confirm the fixture case (3 real confirming factors) now sizes to 12 contracts,
  not 6.
- Confirm zero regression on strategies with NO confirming indicators (should still
  size at base, `confluenceCount=1`, multiplier=1.0 — unchanged).
- Run full `paper-signal-service` sizing test suite + `direct-bucket-graduator`
  test suite.
- tsc clean + all 3 CI gates green.

### 5. Rollback

Option B: revert the 1-2 read-site changes, fully reversible, no schema/migration,
no persisted state changed — strategies simply return to sizing at 1.0× multiplier.

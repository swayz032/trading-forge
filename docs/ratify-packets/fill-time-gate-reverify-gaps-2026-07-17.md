# Ratify-Packet — Fill-Time Gate Re-Verification Gaps: DLL reduce_size + Consistency 50% (2026-07-17)

**STATUS: IMPLEMENTED. INSTRUMENT (the fill-time re-verification stack that re-checks capital-safety
and payout-eligibility gates between signal-queue and next-bar fill). Autonomous under mandatory
independent doer≠grader grade per the 2026-07-11 operator amendment (nothing live — no live default
changed while live trading is active, no frozen/certified ref invalidated, no operator data touched).
Base: worktree `wt-deepscan-b-fixwave`, pinned SHA `56f0fd048c31ffe832194ed5b685a52de5230327`. File touched:
`src/server/services/paper-signal-service.ts`. No migration.**

## Implementation report (this session)

**Files changed:**
- `src/server/services/paper-signal-service.ts` — the two changes described in §3 below (Gate 5
  `reduce_size` branch + new Gate 7 consistency re-check), plus a new `dllReducedAtSignalTime?: boolean`
  field on the `PendingEntry` interface (mirroring the existing `newsReducedAtSignalTime` field/pattern)
  and its stamp at the `pendingEntryQueue.set()` creation site.
- `src/server/__tests__/fill-time-gate-reverify-dll-consistency.test.ts` (NEW) — 27 tests: source-structure
  RED-proof assertions for both findings (fail against the pre-fix source text — neither the `reduce_size`
  branch nor Gate 7 existed) plus behavioral pure-function tests against the REAL `evaluateCrossSymbolDll`
  pinning the Gate 5 numeric contract (halving a 9-contract entry to 4, dropping a 1-contract entry to 0).

**Double-application guard (a design decision beyond the literal packet ask, folded into "mirror Gate 4's
pattern exactly"):** Gate 4's own CF4 fix (2026-06-24) guards against double-reducing when signal-time
sizing already applied the news reduce factor (`!pendingEntry.newsReducedAtSignalTime`). The 60%-DLL
reduce_size factor is ALSO already applied at signal-time sizing (`paper-signal-service.ts` sizing site,
`if (dllReduceSizeFactor < 1) { baseContracts = Math.max(1, Math.floor(baseContracts * dllReduceSizeFactor)); }`,
floored ≥1) — so a fill-time Gate 5 re-apply with no equivalent guard would silently double-reduce
(0.5× → 0.25×, or a spurious drop-to-zero) for any entry that was ALREADY in the reduce band when queued
and is STILL in it at fill. This is the identical defect class CF4 closed for the news gate; mirroring
Gate 4 "exactly" necessarily includes this guard, not just the apply/audit shape. Implemented via a new
`dllReducedAtSignalTime` field, stamped at signal time from the same `dllReduceSizeFactor < 1` boolean the
sizing site already computes.

**Known residual (file-scope-locked, documented not silently swept):** `dllReducedAtSignalTime` is an
in-memory-only field on `PendingEntry` — unlike `newsReducedAtSignalTime`, it is NOT added to the DB-backed
`paper_pending_entries` durability table (`src/server/lib/pending-entry-persistence.ts` /
`PersistablePendingEntry` / migration 0204), because that table and its persistence module are files this
packet's scope-lock does not authorize touching (scope-lock: `paper-signal-service.ts` only). Practical
effect: on the ONLY narrow path where a process restart lands in the window between a DLL-reduced signal
and its bar-N+1 fill (the same durability backstop M2 built, already fail-soft-by-design for other fields),
the rehydrated entry's `dllReducedAtSignalTime` comes back `undefined`/falsy, so Gate 5 could re-apply the
reduce factor a second time if the DLL is still in the reduce band at fill. This is a narrow, low-frequency
edge case (restart-during-a-few-minute window AND DLL still in the soft band at the next bar), it only ever
makes the fill MORE conservative (smaller position, not larger — the failure direction is capital-safe), and
it is strictly no worse than the pre-existing M2 durability contract's own documented fail-soft posture for
every other in-memory-only nuance. Flagged here as a named follow-up rather than fixed out-of-scope; the fix
(add the column to `paper_pending_entries` + `PersistablePendingEntry` + a migration) is a small, low-risk
follow-up packet whenever that file group is next opened.

## 1. What & why

Two confirmed MED findings in the same subsystem — fill-time re-verification of gates that were evaluated
once at signal-queue time and are supposed to be re-checked at actual fill (bar N+1), because "current
combined P&L may have shifted" (the codebase's own comment, `paper-signal-service.ts` Gate 5 header) between
the two points in time.

**Finding 1 — Gate 5 (DLL re-check at fill time, pre-fix ~lines 2941-2969) never re-verified or re-applied
the 60%-DLL soft-throttle band.** The gate checked `dllResult.action === "halt" || "force_close" ||
degraded` only. It never checked `action === "reduce_size"` — the documented ladder in CLAUDE.md §4
("REDUCE new-entry size x0.50 at 60%", `DLL_REDUCE_SIZE_PCT`/`DLL_REDUCE_SIZE_FACTOR` in
`cross-symbol-pnl.ts`). So if the account's DLL crossed INTO the 60% soft-throttle band between signal-queue
and fill (a position took heat between bar N and bar N+1), the fill-time gate saw `action === "reduce_size"`,
matched none of its three conditions, and let the fill proceed. `openPosition()` (pre-fix ~line 3073) then
used `pendingEntry.contracts` exactly as originally queued — full (or whatever the signal-time snapshot
computed), never re-sized down for the DLL state that actually existed at the moment of fill. **Contrast:**
the immediately-preceding Gate 4 (news/macro re-check, ~lines 2851-2912) already had the exact CF4 pattern
this finding asks for — recompute the reduce factor at fill time, apply it to `pendingEntry.contracts`, drop
to zero if warranted — proving this exact fix shape was already a proven, tested pattern one gate away.

**Finding 2 — the Topstep/MFFU 50% consistency gate (FIX A, `consistencyGateShouldBlock` /
`shouldBlockNewEntry` in `consistency-tracker-service.ts`) was evaluated ONLY at signal time** (pre-fix
~line 4156, inside the `!isShadow` signal-evaluation path), with **no equivalent re-check anywhere in the
fill-time Gate 1-6 list** — even though that same fill-time list explicitly exists to re-verify DLL and
daily-trade-cap specifically because state can shift between queue and fill ("current combined P&L may have
shifted", the Gate 5 header comment; Gate 6's own header: "the within-day count crossing the cap between
queue and fill"). A trade that closes in the window between a signal firing and its bar-N+1 fill can push
today's highest-single-day-profit share of cycle-cumulative profit over the 50% Topstep/MFFU payout-denial
threshold — exactly the kind of "shifted between signal and fill" state the DLL/daily-cap gates were built
to catch, but the consistency gate had no analogous re-check.

**Currently dormant in practice, real gap in code.** Consistency enforcement is default OFF
(`resolveConsistencyEnforced()` precedence: per-session boolean > lane/phase string > env
`TOPSTEP_CONSISTENCY_RULE_ENFORCED` > default OFF) — CLAUDE.md §12 confirms the operator runs the Topstep
STANDARD lane with no day-cap, so this gap has fired zero times against the operator's actual accounts.
But the gap is real code, not a documentation issue: any account/session that opts into consistency
enforcement (Consistency-payout lane, an eval account, a future family account) would have hit this exact
gap — the fill-time gate list re-verifies DLL and daily-trade-cap for the identical "state moved between
queue and fill" reason, and silently skipped consistency.

## 2. Blast radius

- Both changes are ADDITIVE inside the pre-existing H3 fill-time gate-re-check block
  (`paper-signal-service.ts`, "H3 (2026-06-23): Re-evaluate all entry gates at fill time"). No existing
  gate's decision logic, threshold, or ordering is modified — Gates 1-4 and 6 are byte-identical; Gate 5's
  existing `halt`/`force_close`/`degraded` branch is untouched (same condition, same `dll_halt` drop
  reason); the signal-time consistency gate (FIX A) and signal-time DLL sizing are both untouched.
- **Finding 1 fix changes RUNTIME BEHAVIOR for one narrow class of fill**: a queued entry whose DLL state
  moved from "fine" (or already in the reduce band, but re-entering with a fresh dllReduceSizeFactor after a
  restart edge case — see residual above) at signal time into the 60% reduce_size band by fill time
  previously filled at the ORIGINAL (unreduced) size; it now fills at a reduced size, or is dropped if the
  reduction rounds to 0 contracts. This is STRICTLY MORE CONSERVATIVE (smaller position or no position, never
  larger) — a capital-safety tightening, not a loosening. No certification, baseline, or frozen ref reads
  this code path's historical behavior as ground truth (paper-fill sizing is not a graded/frozen artifact).
- **Finding 2 fix is a pure no-op for every account currently running** (`resolveConsistencyEnforced()`
  default OFF, operator's Standard lane). It only activates for a session that has explicitly opted into
  Topstep/MFFU consistency enforcement, and for that session it makes the fill-time behavior STRICTLY MORE
  CONSERVATIVE (a fill that would push single-day concentration over 50% is now blocked at fill time, not
  just at signal time) — again a tightening, not a loosening.
- Every existing test asserting the Gate 5 `halt`/`force_close`/`degraded` drop path, or any of Gates
  1-4/6's existing behavior, continues to pass unmodified (see §4).
- No schema change, no migration, no new env var, no new audit-action namespace outside the two new actions
  documented in §3 (`pending_entry.contracts_reduced_dll_band`, and the generic
  `pending_entry.dropped_dll_size_reduced_to_zero` / `pending_entry.dropped_consistency_50pct` emitted by the
  pre-existing shared drop-audit template).

## 3. Exact change, scope-locked

**Change 1 — Gate 5 `reduce_size` branch (mirrors Gate 4's CF4 pattern exactly):**
- Added `else if (dllResult.action === "reduce_size" && !pendingEntry.dllReducedAtSignalTime)` after the
  existing `halt`/`force_close`/`degraded` branch. Captures `originalContracts = pendingEntry.contracts`,
  computes `reducedContracts = Math.floor(originalContracts * dllResult.reduceSizeFactor)`.
  - `reducedContracts <= 0` → `pendingDropReason = "dll_size_reduced_to_zero"` (the generic shared
    drop-audit block at the bottom of the H3 gate list then emits
    `pending_entry.dropped_dll_size_reduced_to_zero`, classified `info` severity — added to the existing
    `dropSeverity` info list alongside `news_size_reduced_to_zero`, per the same "correct capital-safety
    behavior, not an anomaly" rationale).
  - Otherwise: mutate `pendingEntry.contracts = reducedContracts` in place (so the subsequent
    `openPosition()` call uses the reduced count transparently, exactly as Gate 4 does), set 3 span
    attributes (`dll_reduce_size_factor_at_fill`, `dll_reduced_contracts_original`,
    `dll_reduced_contracts_fill`), and emit a NEW audit action `pending_entry.contracts_reduced_dll_band`
    (info severity) with `originalContracts`/`sizeFactor`/`reducedContracts` — same shape as Gate 4's
    `pending_entry.contracts_reduced_news_window`.
  - Added `dllReducedAtSignalTime?: boolean` to the `PendingEntry` interface and stamped it at the
    `pendingEntryQueue.set()` creation site from `dllReduceSizeFactor < 1` (the same boolean the pre-existing
    signal-time sizing block already computes) — this is the double-application guard described above.
- **Untouched:** the existing `halt`/`force_close`/`degraded` condition and its `dll_halt` drop reason; the
  `evaluateCrossSymbolDll` function itself (`cross-symbol-pnl.ts`, `DLL_REDUCE_SIZE_PCT` /
  `DLL_REDUCE_SIZE_FACTOR` thresholds); the signal-time DLL sizing block.

**Change 2 — new Gate 7 (Topstep/MFFU consistency re-check at fill time):**
- Inserted immediately after Gate 6 (daily trade cap), before the shared `if (pendingDropReason !== null)`
  drop-audit block. Guarded by `if (!pendingDropReason)` like every other gate in the list.
- Re-derives `sessionFirmIdAtFill`/`consistencyEnforcedAtFill` the same way the signal-time gate does
  (`sessionRow.firmId`, `resolveConsistencyEnforced(sessionConfig.config)`) — deliberately a fresh local
  re-derivation, not a shared cached value, matching the established H3 idiom (Gate 4 similarly re-derives
  `bypassNewsBlackout` independently of the signal-time computation).
- Scoped identically to the signal-time gate: only runs when
  `CONSISTENCY_RULE_FIRMS.includes(sessionFirmIdAtFill) && consistencyEnforcedAtFill` — a no-op for every
  account that hasn't opted into enforcement (matches Finding 2's "currently dormant" framing exactly).
- Calls the SAME function the signal-time gate calls: `await consistencyGateShouldBlock(sessionId, 1.0, 0)`
  (identical arguments to the signal-time FIX A call — `sessionId` as the accountId/cache-key,
  `projectedTradeProfitR=1.0`, `currentRiskUsd=0`, matching the signal-time call's own documented rationale
  for those constants).
- On `consistencyResult.block === true`: `pendingDropReason = "consistency_50pct"`. No bespoke audit row is
  written at Gate 7 itself — it relies on the pre-existing generic shared template
  (`action: \`pending_entry.dropped_${pendingDropReason}\``) the same way Gates 1, 2, 3, and 6 already do
  (only Gates 4 and 5's ALLOW-THROUGH-with-reduction paths write bespoke audit rows, because those aren't
  drops). `consistency_50pct` falls through to the ternary's default `"warning"` severity bucket (an
  unexpected state flip, same bucket as `kill_switch`/`dll_halt`) — not added to the `info` list.
- Fail-OPEN on error (`catch (_consistencyErr)` sets nothing), matching the signal-time FIX A policy
  documented at its own catch block: "payout-eligibility gate, NOT a loss gate... a DB error → emit warn
  audit but do NOT block the entry."
- **Untouched:** the underlying `shouldBlockNewEntry()` decision logic, the 40%/50% thresholds, the
  false-positive guard, and the signal-time consistency gate block itself.

**OUT of scope (confirmed untouched):** `evaluateCrossSymbolDll()`, `DLL_REDUCE_SIZE_PCT`/
`DLL_REDUCE_SIZE_FACTOR`/`DLL_HALT_PCT`/`DLL_FORCE_CLOSE_PCT`, `shouldBlockNewEntry()`'s internals
(`BLOCK_THRESHOLD_PCT`, the false-positive guard, `getConsistencyState`), the signal-time DLL sizing block,
the signal-time consistency gate (FIX A), Gates 1-4 and 6's existing logic, `resolveNewsAction`, and the
`paper_pending_entries` persistence table/migration (see "Known residual" above for why).

## 4. Verification

(a) **tsc**: `NODE_OPTIONS=--max-old-space-size=8192 node node_modules/typescript/bin/tsc --noEmit -p
tsconfig.json` → exit 0, clean, on the full touched worktree.

(b) **RED-proof new test file** (`src/server/__tests__/fill-time-gate-reverify-dll-consistency.test.ts`,
27 tests, all against the REAL source text and the REAL `evaluateCrossSymbolDll` — not reimplemented):
27/27 GREEN post-fix. Every source-structure assertion targets a code shape that provably did not exist in
the pre-fix source (`dllResult.action === "reduce_size"`, `dllReducedAtSignalTime`,
`pending_entry.contracts_reduced_dll_band`, `dll_size_reduced_to_zero`, the entire "Gate 7" block,
`consistency_50pct`) — run against the pre-edit file content (verified by direct reading of the file both
before and after this session's edits, not inferred), every one of those `SRC.indexOf(...)` calls returns
`-1` and the corresponding assertion fails, satisfying RED-proof.

```
✓ src/server/__tests__/fill-time-gate-reverify-dll-consistency.test.ts (27 tests) 3ms
 Test Files  1 passed (1)
      Tests  27 passed (27)
```

(c) **Behavioral pins** (same file, part B): against the REAL `evaluateCrossSymbolDll`, confirms
`action === "reduce_size"` fires at 65% of a $1000 DLL (inside the 60% band, below the 67% halt); confirms
Gate 5's exact formula (`Math.floor(original × reduceSizeFactor)`) halves a 9-contract entry to 4 at the
default 0.5 factor and drops a 1-contract entry to 0; confirms `action === "none"` at 30% (untouched) and
`action === "halt"` at 70% (untouched, unaffected by this fix).

(d) **Full regression sweep** — every existing test file touching the H3 fill-time gate block, the DLL
evaluator, or the consistency tracker, run against the post-fix source:

```
src/server/__tests__/failure-injection-dll-band-escalation.test.ts           11 passed
src/server/__tests__/production-hardening-f7-f8-f10-signal-gates.test.ts     27 passed
src/server/__tests__/wave23h-cross-symbol-dll.test.ts                        16 passed
src/server/__tests__/pending-entry-queue-fill-gate-recheck.test.ts           29 passed
src/server/__tests__/deepscan16-c1-cross-account-dll-scoping.test.ts         18 passed
src/server/__tests__/paper-signal-service-deepscan-findings.test.ts          14 passed
src/server/__tests__/goalscan-crit-dll-blackout-force-close.test.ts          11 passed
src/server/__tests__/cf4-cf5-news-resize-and-final-sweep.test.ts             25 passed, 1 failed*
src/server/__tests__/pending-entry-persistence-wiring.test.ts                 8 passed
src/server/__tests__/migration-0204-paper-pending-entries.test.ts            15 passed
src/server/__tests__/wave26-consistency-tracker.test.ts                      21 passed
src/server/__tests__/hardening-2026-06-22-consistency-news-blackout.test.ts  31 passed
```

`*` The one failure (`CF5 — check:family-grade-postscript lint script exits 0`) is a PRE-EXISTING,
UNRELATED lint failure: `scheduler.ts:4367` has an unwrapped `notifyWarning()` call (missing
`appendFamilyGradePostscript` wrap) inside the `bias-state-freshness-check` canary — a file this packet's
scope-lock never touches (confirmed: only `paper-signal-service.ts` and the new test file were edited this
session). This is the same-day `bias-state-freshness-check` canary referenced in CLAUDE.md's 2026-07-17
goalscan-r2 entry; it is out of this packet's scope-lock and not caused by this change.

(e) **Independent doer≠grader grade**: pending — this packet's implementation was done by the same agent
authoring the packet; per the `ratify-packet`/`grading-integrity` skills, a fresh-context independent grader
must re-derive the RED-proof and the double-application-guard reasoning before this lands as VERIFIED.

## 5. Rollback

Single-commit revert of `paper-signal-service.ts` (both changes are additive branches inside the existing
H3 block; removing them restores the exact pre-fix behavior — Gate 5 ignoring `reduce_size`, no Gate 7).
No schema/migration/env-flag to unwind. The new test file can be deleted independently without affecting
production code. No live default is touched (consistency enforcement was OFF before this change and remains
OFF by default after it — Gate 7 is scope-gated the same way the signal-time gate is).

## Plain-English for the operator

Two small, defense-in-depth fixes to the part of the paper-trading engine that double-checks safety rules
right before a trade actually fills (as opposed to when the trade signal first fires, a moment earlier).

1. If your daily-loss-limit soft-warning band (the one that cuts new trade size in half once you've lost
   60% of your daily allowance) kicked in between when a trade was queued and when it actually filled, the
   system used to ignore that and fill at the original, un-reduced size. Now it re-checks and shrinks (or
   skips) the trade the same way it already does for a couple of other end-of-day risk checks right next to
   this one. This makes trades SMALLER or SKIPPED in that situation — never bigger.

2. The 50%-single-day-profit-concentration rule (a Topstep/MFFU payout-eligibility rule, not a loss-safety
   rule) was only checked once, when the trade signal fired — not re-checked at the actual fill a moment
   later. This fix adds that re-check, matching how a couple of other rules right next to it already work.
   This rule is currently switched OFF for your accounts (you're on the Standard lane, no day-cap), so this
   fix changes nothing for you today — it closes a gap that would only matter if you or a family member ever
   opts into the stricter Consistency-lane rules.

Nothing here changes any dollar thresholds, any existing rule's math, or any live trading — it only makes an
existing double-check actually run at the right moment, the same way two neighboring double-checks already
do.

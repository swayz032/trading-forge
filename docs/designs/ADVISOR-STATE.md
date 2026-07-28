# ADVISOR-STATE — money-path / H1 seat

> **Rewritten in place, never appended.** Cold-start read for a fresh advisor:
> this file, then the last 3–5 rulings, then the newest 1–2 ARs. Do not read the
> ledger from the top. Invoke `advisor-ruling` before any ruling.
> Last rewritten: 2026-07-28, current through R-367.

## SEAT
Ledger at **R-367**. Newest AR: **AR-334**, RULED. Worker: **handed off** — it
declined to author item 2 on depleted context and left its contract inline in
AR-331 §5. Advisor rig: 2s content-hash report poll + 15-min idle watchdog
(both hash-based; my own pre-commit hook stamps mtimes, and the watchdog
excludes my `R-NNN`/`ADVISOR-STATE` commits so they cannot mask worker silence).

## AUTHORIZED NOW
**R-365 §5(1) is DONE** (`eb4e390a`, verified R-367): import is inert in every
flag state; `startBootProbe()` called once at `index.ts:832`. REMAINING:
**red-proof each of the six before making it green** (§5(3)), keep the
probe-gate DISCRIMINATES case green, and add **R-367 §3's static guard** that
`index.ts` calls `startBootProbe()` exactly once (red-proof it).
`checkProbeGate()` itself is correct — do not touch it. Fresh retry budget 2.
Then item 2 (R-363 + R-364 §3), then item 4. Authoring + PR only.

## NOT AUTHORIZED
A merge · a worktree update · any production write (incl. the item-2 row
UPDATE) · a service restart or deploy · credential decryption · spend · edits
inside `runtime-production` · defaulting `BROKER_KEY_PROBE_ENABLED` ON ·
weakening or regex-dodging the F-2 static guard · deleting/skipping any A-11
case · making the six pass by DISARMING the flag (that re-creates the vacuity).

## STATE, WITH EVIDENCE GRADES
**[MEASURED HERE]** PR #12 head `2934721f`; `newFailures` = **6** (was 2 before
the arming), verified from job `90359883693`. **MUST NOT MERGE.** The gate code
itself is sound (F-2 guard regex re-run across three trees: base 0 · `f28d293f`
1 · `f7e00221` 0; `randomUUID` imported; every `checkProbeGate()` error path
fail-CLOSED; the probe-gate suite has DISCRIMINATES + INVARIANCE controls).
**[MEASURED HERE]** **R-359's gate is INCOMPLETE**: it CONDITIONED
import-equals-intent on a flag instead of removing it — with the flag ON, any
import (test, script, migration runner, REPL) schedules a live broker POST.
**[MEASURED HERE]** **Vacuity CONFIRMED at 4 tests**, not 1 — every one an
ABSENCE assertion, which a disabled function satisfies trivially; CI is blind to
the class because it reports new FAILURES only.
**[MEASURED HERE]** PR #13 (item 3) removes the derived `<FIRM>_API_KEY`
fallback; red-proof is the `PAPER_API_KEY` trap itself + a discrimination
control. Unaffected by the PR #12 problem.
**[MEASURED HERE]** All 8 broker routes established shut. Migration 0159's
"paper rows are NEVER routed to funded brokers" is UNENFORCED in code; `'paper'`
validates as a live TradersPost account. `broker-router.ts:1764` is default-deny
on unknown types — and its "should not occur" caption INVERTS when item 2 lands.
**[MEASURED HERE]** Tower took a `0x9F` bugcheck; API self-restarted **25s after
boot**, 0 missing deps. **True outage ≤ ~7 min** (EventLog 6008's `13:15:55` is
a checkpoint, not the failure instant). Not TF software.
**[ARTIFACT-SOURCED]** corpus = 16. **[CORROBORATED]** 0 eligible today.
**[UNENUMERATED — OPEN]** the bugcheck's driver (`MEMORY.DMP` retained);
`migrations/schema.ts:2377` still declares the pre-0159 narrow `firm_id` CHECK
(never `db:generate` for item 2 — hand-author on 0159's template); legacy
Conv-VAE path; `npm install` at boot ≠ `npm ci`; no SHA→when→who deploy record.

## QUEUE (in order)
1. R-365 §5(3) six red-proofs + R-367 §3 call-site guard (PR #12 unblocks).
   §5(1) import-inertness is DONE (`eb4e390a`).
2. Item 2 — paper rows → no-egress `broker_type` (R-363 ordering is mandatory;
   the obvious sequence is illegal) + R-364 §3's caption rewrite.
3. Item 4 — single broker-egress chokepoint + CI bypass test.
4. Server-derived `strategy_id`; `npm ci` at boot; string-literal precondition
   sweep; consequence-ranked flag enumeration; the floors; 3-ii/3-iii; the
   builds (SMC → ORB+RANGE_EVENT → BAR_TIMING → SESSION_CLOCK).

## KNOWN-BENIGN (do not investigate)
`M src/engine/tests/fixtures/session_windows_parity.json` — phantom, content
hash-identical to HEAD (`0e7d4176b6fbcfe2`). Do not touch the index to clear it.
**A monitor event naming an OLD AR number is a TORN MID-WRITE READ**, not a lost
ledger (seen 13:55:33 as "AR-319"; next tick showed AR-330, nothing missing).
The watcher now waits for the hash to settle. Verify before alarm.
**Three red CI badges on PR #12 = ONE defect** — Node Tests on two triggers plus
an aggregate check that mirrors them (R-366 §3).

## OPERATOR-FACING
**DECISION PENDING (R-363 §7):** applying the item-2 migration is a PRODUCTION
WRITE — it retypes the two live `broker_accounts` paper rows. Authoring + PR
proceed without them; the apply lands only at their merge + worktree update.
**Do not set `PAPER_API_KEY` or any `<FIRM>_API_KEY` on the tower. Do not buy
the $29 Massive plan** until the paper engine is staged. `.claude/skills/` is
not under version control — disk-only, no backup.

# ADVISOR-STATE — money-path / H1 seat

> **Rewritten in place, never appended.** Cold-start read for a fresh advisor:
> this file, then the last 3–5 rulings, then the newest 1–2 ARs. Do not read the
> ledger from the top. Invoke `advisor-ruling` before any ruling.
> Last rewritten: 2026-07-28 (post-crash).

## SEAT
Ledger at **R-360** (commit `3457d6f4`). Newest AR: **AR-327**, RULED (R-358).
Worker: **DEAD — the 13:36 crash killed both CLI processes.** No worker session,
no rulings-watcher. Its last acts are on the branch, not in the relay.
Advisor rig re-armed: 2s report poll + 15-min dual-channel idle watchdog.

## AUTHORIZED NOW
**R-360 §6** (complete contract, needs no further authorization): arm
`BROKER_KEY_PROBE_ENABLED="true"` in the two failing A-11 probe tests + answer
the §5 vacuity question on the HTTP-400 sibling. Test files only; no source
change. Then, without waiting: (2) paper accounts → a `broker_type` with no live
egress; (3) remove the derived `${firmId}_API_KEY` fallback; (4) single
broker-egress chokepoint + a CI test failing on any other module's broker fetch.

## NOT AUTHORIZED
A merge · a worktree update · any production write · a service restart or
deploy · credential decryption · spend · edits inside `runtime-production` ·
defaulting the probe flag ON · weakening or regex-dodging the F-2 static guard ·
deleting/skipping any A-11 case.

## STATE, WITH EVIDENCE GRADES
**[MEASURED HERE]** PR #12 head `f7e00221`, MERGEABLE, 2 commits over the
executing branch `969ba025`. The F-2 guard's own regex re-executed on three
trees: base 0 · `f28d293f` 1 · `f7e00221` 0 ⇒ the breakage was ours and the fix
is real. Gate: exact-string `"true"`, default OFF, **flag tested at MODULE
SCOPE** so an unset flag schedules nothing at import; every `checkProbeGate()`
error path returns a skip reason (fail-CLOSED); `randomUUID` imported at `:24`.
New suite carries a DISCRIMINATES control + an INVARIANCE case.
**[MEASURED BY GRADED INSTRUMENT]** CI baseline gate on `f7e00221`: `newFailures`
= exactly the two A-11 401/403 cases (was 3; the F-2 one is closed).
**[MEASURED HERE]** All 8 broker routes established shut (code, tower config,
production DB). Migration 0159's "paper rows are NEVER routed to funded brokers"
is **UNENFORCED in code**; `'paper'` validates as a live TradersPost account and
the credential fallback derives the baited name `PAPER_API_KEY`.
**[HYPOTHESIS — UNTESTED]** the A-11 HTTP-400 negative case may now pass
VACUOUSLY under the gate; CI is structurally blind to that class.
**[ARTIFACT-SOURCED]** corpus = 16. **[CORROBORATED]** 0 eligible today.
**[UNENUMERATED — OPEN]** legacy Conv-VAE generate path (declared dead,
unmeasured); running dependency set (`npm install` at boot ≠ `npm ci`); no
deploy record mapping SHA → when → who.

## QUEUE (next 4)
1. R-360 §6 (arm the A-11 tests; answer the vacuity question). 2. Paper accounts
→ no-egress `broker_type`. 3. Remove derived credential fallback. 4. Egress
chokepoint + bypass test. Then: server-derived `strategy_id`; `npm ci` at boot;
string-literal precondition sweep; consequence-ranked flag enumeration; the
floors; 3-ii/3-iii; the builds (SMC → ORB+RANGE_EVENT → BAR_TIMING → SESSION_CLOCK).

## KNOWN-BENIGN (do not investigate)
`M src/engine/tests/fixtures/session_windows_parity.json` — phantom; content
hash-identical to HEAD (`0e7d4176b6fbcfe2`), verified twice. Do not touch the
index to clear it.

## OPERATOR-FACING
**Reseat the worker** (`worker-onboarding`) — R-360 is the queue waiting for it.
**Do not set `PAPER_API_KEY` or any `<FIRM>_API_KEY` on the tower.** **Do not buy
the $29 Massive plan** until the paper engine is staged. `.claude/skills/` is not
under version control — disk-only, no backup.

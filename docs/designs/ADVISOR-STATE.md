# ADVISOR-STATE — money-path / H1 seat

> **Rewritten in place, never appended.** Cold-start read for a fresh advisor:
> this file, then the last 3–5 rulings, then the newest 1–2 ARs. Do not read the
> ledger from the top. Invoke `advisor-ruling` before any ruling.
> Last rewritten: 2026-07-28 (post-crash).

## SEAT
Ledger at **R-366** (commit pending). Newest AR: **AR-333**, RULED (R-366).
★ **PR #12 MUST NOT MERGE** — `newFailures` = 6 (was 2); the arming is rejected
and R-359's gate is incomplete: it CONDITIONED import-equals-intent on a flag
instead of removing it, so with the flag ON any import schedules a live probe.
R-365 §5 is the repair contract (fresh retry budget).
Worker: **ACTIVE but HANDING OFF** — it declined to author item 2 on depleted
context (a migration on the fail-CLOSED boot path) and left the full contract
inline in AR-331 §5. Landed so far: `a6278602` (A-11 arming), `2934721f`
(mock comment), `0ec5c981` → **PR #13** (item 3, derived `<FIRM>_API_KEY`
fallback removed). **Item 2 belongs to the NEXT worker.** Nothing waits on me.
**The item-2 APPLY waits on the operator.** ⚠ R-363 §2 is WITHDRAWN (R-364 §1).
Advisor rig: 2s **content-hash** report poll + 15-min idle watchdog (both were
mtime-based and were tripped by my own pre-commit hook; hashing is immune, and
the watchdog now excludes my own `R-NNN` / `ADVISOR-STATE` commits so they
cannot mask worker silence).

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
**[MEASURED HERE]** Tower took a Windows `0x9F` bugcheck; boot `13:35:49`; the
API self-restarted **25s after boot** with `nodeDependencies.missing: []` and
`pythonDependencies.missing: []` — the 07-18 erosion class did NOT recur. **True
outage ≤ ~7 min, freeze instant UNENUMERATED** — EventLog 6008's `13:15:55` is
the last clean CHECKPOINT, not the failure moment (R-361 §4); AR-328's "~20 min"
is superseded. Not TF software. **[UNENUMERATED — OPEN]** the offending driver
(`MEMORY.DMP` retained) — an availability risk with a name, on a box heading
toward live capital.
**[ARTIFACT-SOURCED]** corpus = 16. **[CORROBORATED]** 0 eligible today.
**[UNENUMERATED — OPEN]** legacy Conv-VAE generate path (declared dead,
unmeasured); running dependency set (`npm install` at boot ≠ `npm ci`); no
deploy record mapping SHA → when → who.

## QUEUE (next 4)
0. **R-365 — make `import` always inert** (NEW, ranks first). Remove the
   module-scope conditional `setImmediate`; export an explicit boot-probe
   starter called ONCE from the app entry. Then repair the A-11 arming and
   **red-proof each of the six before making it green.** PR #12 blocks on this.
1. **Item 2** — paper rows → no-egress `broker_type`, contract in
   R-363 (+ R-364 §3: rewrite the dispatch tail's "should not occur" caption,
   which inverts the moment this lands). Hand-author only, never `db:generate`.
2. **Item 4** — single broker-egress chokepoint + a CI test failing on any other
   module's broker `fetch`. Unblocked, needs no further authorization.
3. **Report PR #12's HTTP-400 vacuity verdict** (rides the pending Node Tests).
4. Then: server-derived `strategy_id`; `npm ci` at boot. Then: server-derived `strategy_id`; `npm ci` at boot;
string-literal precondition sweep; consequence-ranked flag enumeration; the
floors; 3-ii/3-iii; the builds (SMC → ORB+RANGE_EVENT → BAR_TIMING → SESSION_CLOCK).

## KNOWN-BENIGN (do not investigate)
`M src/engine/tests/fixtures/session_windows_parity.json` — phantom; content
hash-identical to HEAD (`0e7d4176b6fbcfe2`), verified twice. Do not touch the
index to clear it.
**A monitor event naming an OLD AR number (seen 13:55:33, "AR-319") is a TORN
MID-WRITE READ, not a lost ledger** — a 2s poll can hash the report file while
the worker is rewriting it; the next tick showed AR-330 correctly and every
entry was present. The report watcher now waits for the hash to SETTLE before
emitting. Verify before alarm: `grep -o '^## AR-[0-9]*' … | head` + file size.

## OPERATOR-FACING
**DECISION PENDING (R-363 §7): applying the item-2 migration is a PRODUCTION
WRITE** — it retypes the two live `broker_accounts` paper rows so they can no
longer reach a live broker. Authoring + PR proceed without them; the apply lands
only at their merge + worktree update. Upside: it closes the ungated-probe path
a second, structural way (those rows leave the probe's selection set entirely).
**Do not set `PAPER_API_KEY` or any `<FIRM>_API_KEY` on the tower.** **Do not buy
the $29 Massive plan** until the paper engine is staged. `.claude/skills/` is not
under version control — disk-only, no backup.

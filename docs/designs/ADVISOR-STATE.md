# ADVISOR-STATE — money-path / H1 seat

> **Rewritten in place, never appended.** Cold-start read for a fresh advisor:
> this file, then the last 3–5 rulings, then the newest 1–2 ARs. Do not read the
> ledger from the top. Invoke `advisor-ruling` before any ruling.
> Last rewritten: 2026-07-28, current through R-380.

## SEAT — AND THE AUTHORITY MODEL CHANGED TODAY (R-376, operator-ordered)
Ledger at **R-387**. Newest AR: **AR-351**, UNRULED (item 4 / PR #22 — next). Worker:
**[MEASURED — START-RECEIPT 15:30] ACTIVE on item 2** after a 14:30–15:30
window in which item 2 was DECLINED (AR-338 §4) and this desk's state wrongly
said ACTIVE — see R-380. Declines now carry receipts and re-label the task. **"No decision waits on the operator — the desk decides and reports."**
Mine without asking: verified merges · worktree updates · deploys of verified
work · reversible CI-gated production writes · model/tooling choices. Reserved
to the operator (SHORT list): real capital at risk · spend beyond the standing
envelope · irreversible destruction · unboundable blast radius. Worker
stop-and-asks route to THIS DESK, answered in the same ruling. Also standing
(operator-ordered): **never answer from ignorance when WebSearch exists** —
research, then answer with sources. Rig: 2s content-hash report poll + 15-min
idle watchdog (hash-based; excludes my own ledger commits).
★★★ **INVOKE `advisor-ruling` BEFORE EVERY RULING** (skill §0.-1) — not once per
session. Measured 2026-07-28: invoking once and ruling from memory collapsed
§7 field compliance from 4.0/10 to 0.1/10, and the skill FILE MUTATES (edited
4x that day), so a remembered copy is a stale copy.

## AUTHORIZED NOW
**Item 2** — paper rows → no-egress `broker_type`. R-363's ordering is
mandatory (DROP topology CHECK → widen broker_type IN-list → UPDATE 2 rows →
RE-ADD amended CHECK, one transaction, idempotent, pglite dry-run ×2);
R-364 §3's caption rewrite at `broker-router.ts:1764` rides along; hand-author
on 0159's template, **never `db:generate`** (`migrations/schema.ts:2377` still
declares the pre-0159 narrow constraint); `migration-author` skill first.
**PR #19: RED — DO NOT MERGE (R-387). Reproduced at this desk: re-applying
**0159** now fails (`broker_accounts_firm_broker_topology_chk`) because 0208
correctly forbids the `paper→traderspost` pair 0159 seeds. 0208 itself replays
clean. Production impact NIL today (journal-keyed runner won't re-run 0159);
the broken invariant is "every migration re-applies". Worker to choose (A)
legacy tolerance / (B) pinned non-replayable register / (C) forward migration —
(C) preferred, never edit an applied migration. ★ My R-382 dry-run passed this
because it used a HAND-BUILT pre-state; only the real chain caught it.
Historic: collision CLEARED + dry-run PASSED at this desk (15/15, pglite,
incl. control + 8 discrimination probes). ONE revise outstanding: run
`node scripts/gen-migration-manifest.mjs` and commit the manifest (Lint gate).
On green I merge + deploy + push, then re-verify the two live rows read
`paper_sim` on the REAL DB. Historic (R-381): three-way migration collision** — the operator
shipped `0207_youtube_evidence_archive` (idx 210, applied) while we worked.
Rebase onto **`b2af6c1a`** (pushed), rename to **0208**, journal **idx 211**,
`when` **> 1785268800000**, touch nothing of the operator's entry. Substance
RATIFIED (NOT VALID, ordering, 3-arm default-deny CHECK, CORE_DDL mirror,
caption). **The apply is MINE** — PR → my verify → **my pglite dry-run ×2** →
my merge → my deploy → **my push** (R-381 §4: publish is part of deploy).
Then **item 4** — single broker-egress chokepoint + CI bypass test.

## NOT AUTHORIZED (worker)
Real-capital actions · spend · credential decryption · `.env` writes ·
defaulting `BROKER_KEY_PROBE_ENABLED` ON · weakening/regex-dodging the F-2 or
call-site guards · deleting/skipping A-11 cases · disarming the probe flag in
tests (re-creates the vacuity).

## STATE, WITH EVIDENCE GRADES
**[MEASURED HERE — R-377 DEPLOY RECORD]** Tower runs `f6684035` since 15:18:28
(before: `618a74b0`; HMAC restart corr `bc405867…`; API back ≤60s, uptime 11s,
db ok 103ms, deps missing:[]). Running-tree greps: `startBootProbe` present
(import + 1 call), `BROKER_KEY_PROBE_ENABLED` in code + ABSENT from env (probe
inert at import AND dormant by flag), derived `<FIRM>_API_KEY` fallback GONE.
**Cautions DOWNGRADED: `PAPER_API_KEY` arms nothing on this box now; an Office
enrollment creates a credential but no boot-time egress exists to grab it.**
**[MEASURED HERE]** PRs #12 + #13 MERGED (branch tip `3d7b2cef`); acceptance
was per-test from the vitest artifact incl. DISCRIMINATES. Suite baseline:
13,440 tests / **9 known failures — a tripwire: if it rises unexplained,
something got baselined instead of fixed.** Zero of the 9 in our surface.
**[MEASURED HERE]** The box carried 5 operator commits (evidence vault,
14:04–15:09, preserved on `origin/hardening/slumhouse-transcript-vault-20260728`,
zero broker files, zero overlap with our 13) — **the operator is a THIRD WRITER
on runtime-production: read `status -sb`, never a one-directional rev-list.**
Their migration 0207 verified idempotent, no-BOM, journal 0 dup-when, applied.
**[MEASURED HERE]** Migration 0159's "paper never routed to funded" contract
remains UNENFORCED until item 2 lands; `broker-router.ts:1764` default arm is
default-deny, and its "should not occur" caption INVERTS when item 2 lands
(rewrite required). 3am-agent model decision (researched, sourced, R-376 era):
**GPT-5.6 Sol on flex** ($2.50/$15 = GPT-5.4's list price; learning loop is ON
so quality compounds; REQUIRES retry + fallback tier for flex capacity misses;
first nights observe-only).
**[ARTIFACT-SOURCED]** corpus = 16. **[CORROBORATED]** 0 eligible today.
**[MEASURED HERE]** origin `hardening/slumhouse-shared-office-parity-20260723`
= **`b2af6c1a`** = the running box (FF-pushed R-381; before this, my deploy
merge and the operator's 15:33 work existed on ZERO remote refs).
**`migrations/schema.ts:2377-2378` is DOUBLY STALE** (pre-0159 `firm_id` +
pre-0208 `broker_type`) — **never `db:generate`** until someone regenerates it
deliberately; hand-editing a generated snapshot is its own hazard.
**[UNENUMERATED — OPEN]** the 0x9F bugcheck's driver (`MEMORY.DMP` retained);
legacy Conv-VAE path; `npm install` at boot ≠ `npm ci`; deploy records exist
only as R-377's ledger entry (no standing mechanism).

## QUEUE (in order)
1. Item 2 (contract above; apply = mine). 2. Item 4 (egress chokepoint + CI
bypass test). 3. Server-derived `strategy_id`; `npm ci` at boot;
string-literal precondition sweep; consequence-ranked flag enumeration; the
floors; 3-ii/3-iii; the builds (SMC → ORB+RANGE_EVENT → BAR_TIMING →
SESSION_CLOCK).

## DURABILITY (R-385 — was a live single-copy exposure)
Ledger branch `h1-wave4-sealed12-driver` is now **ON ORIGIN** (`f9576819`,
verified by reading the ledger/report tips back FROM the remote object).
Before this it existed on no remote at all — 747 commits, every ruling
R-359→R-384 — on the box that bugchecked today. **AGENT-REPORTS.md is
snapshotted by the desk for durability ONLY (431 insertions / 0 deletions —
single-writer intact; committing ≠ authoring).** **[STILL UNBACKED]** 24
untracked `docs/designs/` files incl. the -OPS ledgers and GRADE-* charters —
another campaign's artifacts, named not adopted; operator/OPS-seat call.

## KNOWN-BENIGN (do not investigate)
`M src/engine/tests/fixtures/session_windows_parity.json` — phantom, verified
twice; do not touch the index. · A monitor event naming an OLD AR number =
torn mid-write read (watcher settles now). · Three red CI badges on one PR =
one defect mirrored (an aggregate check is a mirror, not an instrument). ·
`.playwright-cli/` untracked in runtime-production = operator tooling, leave it.

## OPERATOR-FACING
Nothing waits on you. Deployed today: the boot probe can no longer fire from an
import in any flag state, and the system no longer invents credential names —
both verified on the running box. Your evidence-vault work was preserved
untouched through the deploy (merge, never rebase). `.claude/skills/` is still
disk-only, no backup.

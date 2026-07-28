# ADVISOR-STATE — money-path / H1 seat

> **Rewritten in place, never appended.** Cold-start read for a fresh advisor:
> this file, then the last 3–5 rulings, then the newest 1–2 ARs. Do not read the
> ledger from the top. Invoke `advisor-ruling` before any ruling.
> Last rewritten: 2026-07-28, current through R-377.

## SEAT — AND THE AUTHORITY MODEL CHANGED TODAY (R-376, operator-ordered)
Ledger at **R-377**. Newest AR: **AR-342**, RULED (R-377). Worker: **ACTIVE** on
item 2. **"No decision waits on the operator — the desk decides and reports."**
Mine without asking: verified merges · worktree updates · deploys of verified
work · reversible CI-gated production writes · model/tooling choices. Reserved
to the operator (SHORT list): real capital at risk · spend beyond the standing
envelope · irreversible destruction · unboundable blast radius. Worker
stop-and-asks route to THIS DESK, answered in the same ruling. Also standing
(operator-ordered): **never answer from ignorance when WebSearch exists** —
research, then answer with sources. Rig: 2s content-hash report poll + 15-min
idle watchdog (hash-based; excludes my own ledger commits).

## AUTHORIZED NOW
**Item 2** — paper rows → no-egress `broker_type`. R-363's ordering is
mandatory (DROP topology CHECK → widen broker_type IN-list → UPDATE 2 rows →
RE-ADD amended CHECK, one transaction, idempotent, pglite dry-run ×2);
R-364 §3's caption rewrite at `broker-router.ts:1764` rides along; hand-author
on 0159's template, **never `db:generate`** (`migrations/schema.ts:2377` still
declares the pre-0159 narrow constraint); `migration-author` skill first.
**The apply is MINE now** — PR → my verify → my merge → my deploy (R-377
method). Then **item 4** — single broker-egress chokepoint + CI bypass test.

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
**[UNENUMERATED — OPEN]** the 0x9F bugcheck's driver (`MEMORY.DMP` retained);
legacy Conv-VAE path; `npm install` at boot ≠ `npm ci`; deploy records exist
only as R-377's ledger entry (no standing mechanism).

## QUEUE (in order)
1. Item 2 (contract above; apply = mine). 2. Item 4 (egress chokepoint + CI
bypass test). 3. Server-derived `strategy_id`; `npm ci` at boot;
string-literal precondition sweep; consequence-ranked flag enumeration; the
floors; 3-ii/3-iii; the builds (SMC → ORB+RANGE_EVENT → BAR_TIMING →
SESSION_CLOCK).

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

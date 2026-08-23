# ALGO-057 — acceptance_bars=3 RATIFIED; FLAKE-1 discharged; and the FREEZE decision rule is PRE-REGISTERED here, before the running exam produces a number.

**Advisor:** Claude (Fable 5), ALGO seat. **Rules on:** ALGO-056 @ `9e5380cd`, strategy head
`7a997327`. **Channel head at drafting:** `9e5380cd` (the worker's packet, read). **PR #38:
DRAFT / DO NOT MERGE — unchanged.** **DECISION: APPROVE (§1) + PRE-REGISTER (§2–3) + ORDER
(§4).** The dual-window exam is RUNNING (arm 1 of 2) — nothing here touches it.

## 1. Verified [MEASURED HERE unless graded]

- Strategy stack `d150d87d → 1e65d042 (FLAKE-1 split + exam instrument) → 7a997327
  (acceptance_bars 2→3)` exists on the branch. `breakout_derivation.py:197` now defaults
  `acceptance_bars: int = 3`; `entry_authority.py:139` passes it through — the kernel relies
  on the default, so this IS kernel semantics, landed under the ALGO-046 §1.3 pre-authorization.
- ALGO-056's numbers on the CONSIDERED population: **29,775 candidates, identical at all three
  values; Route D grants 363 / 228 / 186 at 1 / 2 / 3** [ARTIFACT-SOURCED to the report; the
  rule application is checked here: strictly monotone, fewest at 3 ⇒ `R3_SILENT_STRICTER_WINS`
  → 3, consistent with the pre-registered R2–R4 text]. **Grants at 1 exceeding grants at 2 is
  the ALGO-054 amendment vindicated by data — under the survivor-selected population that
  rise was structurally impossible.** The rule also selected 3 on the pre-wiring run, so no
  surprise and no round-trip was correct.
- Five red tests had the old number baked in as literal or bar-SHAPE; re-anchored to derive
  from the signature/declaration, not re-pointed at 3 [RELAYED, consistent with the ALGO-053
  discipline I attacked and ratified in ALGO-054].
- **FLAKE-1 DISCHARGED**: the custody split landed and was red-proofed against a REAL
  corruption (one appended line → `DATA_CUSTODY_ERROR` naming file + expected/observed
  sha256 and bytes; the cross-check refuses to compare; artifact records kind + zero rows)
  [ARTIFACT-SOURCED to ALGO-056]. The ALGO-055 recurrence rule is now live.

## 2. PRE-REGISTERED: what FREEZE requires, written before either arm has rendered

The exam's A1–A5 (membership-not-count · emitted-not-source · pass-is-a-precondition ·
prefix-not-substring · no outcome reader) are the worker's pre-registration. This is mine, on
top, so the verdict cannot be argued after the number lands:

**F1 — A PASS is necessary, never sufficient.** All five A-rules PASS as EMITTED by the
instrument, on both arms. Any A-rule FAIL ⇒ NO FREEZE; the failing arm convicts the BRAIN;
repairs are ruled; the exam is re-run under the SAME pre-registration (no rule edits after
data — ALGO-054's amendment was legal only because it preceded the run).

**F2 — No lost agreement vs the FROZEN BASELINE, by membership.** The 09:30 arm's set of
decided agreements must CONTAIN the frozen 5/8's agreement set (session-keyed); the 08:00
arm's must contain the 09:30 arm's (the ALGO-043 rule). A tie at 5/8 with membership held is
FREEZE-eligible — **the rules decide, not the score**, and I bind myself to that now so a
tie is not re-litigated later. A higher count that DROPS a previously-agreed session is a
FAIL regardless of the count.

**F3 — Every GAINED agreement must be a TAUGHT story.** For each newly-agreeing session the
granted route/form/reason is checked against the derivation's declared story set; an
agreement reached through a story the teacher never taught (or a case-specific branch) does
not count toward F2 and is itself a finding.

**F4 — Independence.** FREEZE is ruled only after (a) I re-derive both arm headlines from the
row artifacts myself in a read-only arena at the exam's pinned head, and (b) the
`accuracy-validator` grade (§3) renders with its coverage section and finds no refutation
that survives. An honest null ("no refutation, here is what I covered") is a complete grade.

**F5 — What FREEZE is.** FREEZE = the entry semantics are SEALED for the next phase at a
pinned head; it is NOT promotion, NOT capital, NOT a merge of PR #38. The deployment window
sealed with it is 08:00–12:00 (ALGO-049).

## 3. The grade brief, pre-registered (dispatched by the WORKER after the exam renders)

`accuracy-validator`, DISPROVE mode, ONE dispatch over the whole wiring+exam packet:
claims verbatim from the exam report · pinned strategy head + rulings head · arena by
`git archive`, never a working tree · re-derive BOTH arm headlines from the row artifacts by
a path that does not import the exam module · verify F2 by set inclusion · plant at least one
mutation of the grader's own choosing · honest null permitted and requested · **durable
receipt = a committed file under `algo-reports/`** with the mandatory coverage section
(paths used, positive-control witnesses, join keys, what was NOT verified). A grade without
the coverage section is a stale-definition symptom: run `check-agent-parity` before
trusting it.

## 4. ORDERS (post-exam, not touching the running instrument)

1. **Lane law minted — a stopped WRAPPER is not a stopped CHILD.** Seen three times today
   (Monitor→ear bash, TaskStop→ear, background task→exam Python). After stopping anything,
   enumerate the child by CommandLine + birth time and kill it; **before any artifact-writing
   run, assert a single writer** (lock file or PID guard) — two writers to one artifact was
   one verification away from a corrupted exam record.
2. **Bounded census of the self-named habit.** The worker named substring-over-prose
   assertions as a HABIT (third instance in one packet). After the exam renders: enumerate
   every substring-in-source/raw/docstring assertion across the lane's test files (state the
   pattern and the surface), convert each to AST/prefix/emitted-value form or record why it
   is correct as-is. A named habit with no enumeration is one instance closed.

## 5. Queue

Exam renders (both arms) → worker publishes the verdict packet + dispatches the §3 grade →
advisor re-derivation (F4a) → grade receipt (F4b) → FREEZE ruling under F1–F5, or repairs
ruled → §4.2 census. 08:00–12:00 unconditional.

LESSON: write the freeze rule while the exam is still running — a decision rule authored
after the number is a rationalization with a citation.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any
decision in this ruling.

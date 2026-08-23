# ALGO-020 — ADVISOR RULING: backlog 012–019 ruled. Grade refutation ACCEPTED (band 5 stands — including against this seat's own narrower read). BRK15 = Route B variant. Two-era fork RULED: 2026 scores, 2025 teaches. Repair → re-grade → then semantics.

**Advisor:** Claude (Fable 5) — seated by operator order 2026-08-22: *"i want you to be the
advisor for the algo strategy plan i want you to read the engineer plan and arm your montior for
the opus worker and use algo ruling"*, reaffirmed mid-session: *"worker is waiting on your
rulings form the past reports and you need to arm monitor."* GPT remains the main campaign's
advisor; this seat exists on the ALGO channel only. Wait-on-GPT does not attach here (operator
re-seat + blocked worker).
**Worker:** Claude Code (Opus 5), `wt-mnq-v24`. **Strategy head at ruling:** `ff1864f6`
[MEASURED, ls-remote]. **PR #38: DRAFT / DO NOT MERGE — unchanged.**
**Ruling targets:** ALGO-012 · 013 · 014 · 015 · 016 · 017 · 018 (two eras) · 019 (grade landed).
**Numbering note:** this ruling was drafted as ALGO-018; the worker's 018/019 landed mid-draft
and the ledger law is last-number-wins — renumbered, nothing collided on the branch.
**Ear:** ARMED this session on `origin/external-advisor/gpt-rulings-algo` (2s poll, real repo
cwd; comparator red-proofed both directions — planted stale seed FIRES, true head SILENT — and
the red-proof itself caught ALGO-018/019 landing mid-draft). Blind window closed at `ebdcfaf6`
(ALGO-019); everything earlier read by hand (001–019). This publish is the ear's live
end-to-end control. Onboarding for future ALGO seats built per operator order:
`.claude/commands/algo-onboarding.md`.

---

## 1. THE GRADE — §9.2 is DISCHARGED: **band 5, REFUTED, and the refutation is ACCEPTED.**

The independent grader rendered late, not never — ALGO-019's withdrawal of the
"mechanism failed" diagnosis is accepted, and the lesson is now in seat memory: **a silent
grader may have finished and not rendered; say "no output received", never "failed."**

**Concurrence with a disclosure this ledger is owed.** Before ALGO-019 landed, this seat had
independently graded the same three files at `068bb24a` through three paths — adversarial code
read; aggregates recomputed from per-case rows (exact match: 6/14, 6/8, census); an independent
join of all 14 rows against the Downloads labels file (0 disagreements; live sha ==
`trader_labels_file_sha256` `1b20b0a8…`) — and had drafted **band 7** on internal coherence.
That draft never published, and the landed grade beats it on the merits. Two of my paths were
shallower than they looked, and both are convictions this desk already owns:

- My labels join checked the scorecard's censor flags against the labels file's
  `capture_warnings` — **the flag set against the flag set. Same-layer agreement is not
  evidence.** The grader applied the artifact's own stated DEFINITION and got 8-vs-6 (F-3).
- I cited `FORCE_RECEIPT_DISAGREES_WITH_KERNEL_GATE` as evidence the receipt can go red. I
  verified the raise EXISTS, not that it is REACHABLE — identical arguments to a pure function
  have no path to disagreement (F-4). **A green check with no path to red.**

What my read adds that survives and is folded into the repair contract below:
**G-1** — `exact_action_agreement` is a raw string compare, so a future
trader-`NO_TRADE` / bot-`NO_ENTRY_IN_WINDOW` case (`BOTH_DECLINED` in the census — exactly what
the semantics work is supposed to produce) counts as DISagreement in the headline. Same root as
F-2; one repair closes both. **G-3** — `decisions[0]` / `in_window[0]` assume
`iter_actionable_candidates` yields in decision-clock order; nothing pins it, and 2026-04-02's
mixed in-window sequence (`L,S,S`) makes the recorded direction order-dependent. Post-F-1 the
"first" is even more load-bearing. My third finding (uncaveated structural zeros) is largely
superseded by F-1 — once the join is budget-faithful, `MISSED_TRADER_ENTRY` genuinely fires
(twice, per the grader) — but any metric that REMAINS structurally zero on this corpus carries
a `structural_zero` note in the artifact itself.

**F-1 is confirmed and is the finding of record.** The window join credits the bot with entries
its own one-trade budget forbids; 7 of 14 sessions spent the bullet pre-window; budget-faithful
uncensored agreement is 5/8; 2026-03-23 is published AGREE while production went the opposite
direction 57 minutes before the window opened. Two non-overlapping paths (artifact column +
direct `_analysis_run_day` execution). The scorecard contradicted the session-budget module
shipped in the same packet.

### The repair contract (§9.2 REOPENS only through this, then a fresh grade)

1. **F-1, ruled semantics:** the scorecard publishes TWO surfaces, separately and labeled —
   **PRODUCTION-FAITHFUL** (budget-honoring; session's first A+ consumes the bullet; pre-window
   consumption → `BUDGET_CONSUMED_BEFORE_WINDOW`, and in-window the bot can genuinely miss →
   `MISSED_TRADER_ENTRY` + `TRADER_DIRECTION_NOT_PERMITTED_IN_WINDOW` fire on real data) as
   **THE headline**; the budget-ignored kernel/authorization view stays as an explicitly-labeled
   diagnostic surface only. Fix point as the grader named: `…frozen_replay_regrade.py:139`.
2. **F-2 + G-1:** bind the headline to `_mismatch_class` — agreement = `AGREE` ∪
   `BOTH_DECLINED`, censored excluded by the classifier, no parallel raw compare, no hardcoded
   `/14`.
3. **F-3:** censoring membership derives from the artifact's flag set (`capture_warnings`) as
   the operative criterion; the scorecard records that the prose definition under-selects
   (WAIT ≠ NO_TRADE distinguishes 04-02; 04-09 carries an action and is not censored). **The
   frozen labels file is not edited.** ALGO-016 §3's "uniform" claim is conceded and withdrawn;
   ALGO-016's core selectivity finding (bot 14/14, trader 7/14, no both-stood-aside session —
   row facts) SURVIVES and remains binding.
4. **F-4:** the force receipt must be able to disagree — recompute through an independent
   derivation (from raw 1m bars, or perturbation-tested), or rename it so it stops claiming to
   be a receipt. Its BRK15 path recomputes through the **15m parent** exactly as the kernel
   does (see §2).
5. **F-5:** enumeration assertions on both vacuous guards; delete the unconditionally-true
   assert; the second-trade guard gets a structural check, not a grep — the worker's own
   docstring already states why.
6. **F-6:** reconcile the two label hashes (manifest-internal `11d8dec0…` vs whole-file
   `1b20b0a8…` — different byte ranges, nothing compares them) and put the censoring annotation
   under custody. The strongest fix is ordered in §4 item 4: commit the labels file.
7. **G-3:** pin decision-clock ordering (test or explicit sort).
8. **Ratio honesty (grader §3):** the artifact totals report the executable-opportunity ratio
   (**≈1.1:1** under the budget) BESIDE the authorization-layer ratio — two layers, both named,
   neither substitutes for the other.

Acceptance: baseline rerun; the production-faithful headline (expected 5/8-shaped, plus the two
new classes) red-proofed; every repair with a positive witness; then **re-dispatch the
independent grade** (the mechanism works — it renders late). This seat will independently
re-verify the repaired join when it lands; my recompute paths are on file.

ALGO-012's remaining closures stay accepted (the force-receipt closure is reopened by F-4, as
above). ALGO-013's retraction and ablation stand as before — ablation is SIZING evidence with
its own three caveats binding, v2.2 is the prior implementation and not the teacher; **101
supersedes 177** and the grader's arithmetic-at-its-pin is reconciled in ALGO-019 §4. ALGO-017
§1 (no recorded field discriminates; receipts are post-grant tautologies) stands with its n=7
limit, now with the two-era structural explanation under it.

---

## 2. ALGO-014 — RULED: **BRK15 is a VARIANT of `B_NORMAL_BREAKOUT`. There is no fifth route.**

Measured at source this session: the production kernel already trades it —
`current_mnq_strategy_v2_4_kernel.py:115` ranks `{"BRK5": 3, "BRK15": 2, "REV": 1}` and `:242`
builds BRK15 candidates from the pending weak-first-break 15m continuation path [MEASURED HERE
at `068bb24a`; kernel diff to current head EMPTY]. ALGO-009 ROUTE B says it in prose: a weak
first break falls to the *"already-authorized 15m three-bar continuation family"*. §3's **NO
FIFTH ROUTE** forbids new pre-break permission paths; it does not forbid mirroring a route the
kernel already ranks. The question is now load-bearing from two directions (X-ray hole,
ALGO-014; force-receipt parent mismatch, ALGO-019 F-4) — same answer both times:

**ORDER:** mirror BRK15 into the X-ray as
`B_NORMAL_BREAKOUT / BRK15_WEAK_FIRST_BREAK_CONTINUATION` (diagnostic files only; kernel
byte-untouched); remove its gates from `NOT_MIRRORED_PENDING_RULING`; the force receipt's BRK15
path recomputes through the 15m parent; re-run census and ablation and replace every
provisional ALGO-013 §2/§4 number with a FINAL one. Until then they remain upper bounds.

---

## 3. ALGO-018 (two eras) — THE FORK IS RULED: **the 2026 corpus SCORES; the 2025 join TEACHES. No second scoreboard.**

The operator redirected this decision here, and it is decided as follows:

- **The 2026 frozen corpus remains the ONLY fidelity scoring instrument.** It is the only
  surface carrying per-session trader decisions — including declines — at decision clocks, and
  ALGO-009 §10's success conditions are defined on it. Option (B)-as-a-second-corpus is
  REFUSED: two scoreboards invite metric shopping, and the 2025 record can barely score
  *declines* at all — he traded on 55 days of roughly that many trading sessions, so the
  no-trade evidence (B) promised is nearly absent from it.
- **The 2025 join becomes the TEACHING lane** — positive-selection evidence, not scores, in
  this order:
  1. **Resolve the ledger timezone first** (the worker's own prerequisite; `64 of 74` stays
     conditional and travels with its caveat until then).
  2. **Bounded enumeration of the long video AT THE JOIN** — the verified 2025-04-11 replay
     content (and any further date a chart frame pins), extending the custody receipt with
     honest frame-coverage arithmetic. Not a full 3h53m census; the file's non-trading content
     (frozen chart, the ChatGPT screen, the daily-view tail) is recorded as exactly that.
  3. **Derive teacher-positive evidence** from the joined day(s): for each of his real entries
     (four on 2025-04-11, prices in-band), reconstruct from 5m/1m price what the entry HAD —
     location, interaction, story, force — and feed that into the H1–H8 hypothesis program as
     evidence of what his true grants share that the machine's false grants lack.
- **Option (A) stays passive-receive.** The decline-reasons question has been asked; it is not
  re-asked and it is not a schedulable work item. If the operator ever volunteers 2026-era
  reasoning, it registers as new `OPERATOR_STATED` evidence; the frozen labels are never edited.
- **Hard rail, restated because the ledger makes it live:** the ledger's `rPnL` column and
  every outcome field remain UNREAD for all semantic work — dates, entry prices, clocks only,
  exactly as ALGO-018 already practiced. The 2025 lane derives what his entries LOOKED like,
  never what they PAID. The "frozen rules tighten the record" measurement stands as flagged,
  not resolved, and is not a license to loosen anything from realized behavior.

---

## 4. AUTHORIZED NOW — the queue (worker holds landing authority; no round-trip owed)

1. **Evaluator repair per §1's contract** (worker already mid-flight per ALGO-019 §5 —
   ratified). Files: regrade/runner/guards/custody + tests + regenerated scorecard. Forbidden:
   every semantic file; the frozen labels file (uncommitted edits). Then **re-dispatch the
   grade.**
2. **BRK15 mirror + re-census/ablation per §2.** Diagnostic files only.
3. **2025 teaching lane per §3** (timezone → bounded join enumeration → teacher-positive
   derivations). Independent files; may interleave with 1–2 at the worker's sequencing — no
   lane consumes another's output until the hypothesis program joins them.
4. **Labels custody:** field-scan `mnq_replay_v3_labels_FROZEN.json`; if it carries decisions/
   timestamps only (no dollar or P&L field), COMMIT it into `research/` as canonical frozen
   ground truth — closing F-6's unsigned-annotation hole with git custody over the whole byte
   range and retiring the Downloads exposure. If any monetary field exists: do not commit;
   report the field names. The analytics CSV stays out — operator's call, unchanged.
5. **Semantics (ALGO-009 §3/§6 breakthrough, derivation-first) OPENS only after the re-grade
   passes.** The ablation table is sizing evidence, never a to-do list; H2 is now
   MEASURED-CONFIRMED (`entries.py:168/174` literals), H3 substantially confirmed — the work is
   to COMPUTE real evidence at the decision clock per the frozen teacher semantics, then let
   the state machine discriminate on it.

**§8 re-ruled on the corrected numbers (ALGO-013 §6.1): ORDER A STANDS.** It never rested on
the ratio's magnitude — it rests on the direction of every scoreable failure and the measured
mechanism. Both ratios (authorization-layer, final after §2; executable ≈1.1:1) are reported
side by side wherever either is cited.

**STOP CONDITIONS:** PR #38 DRAFT / DO NOT MERGE · no PnL, realized outcome, winner/loser or
clean-edge input to any decision (ledger `rPnL` explicitly included) · frozen labels never
edited, censored cases never relabeled, no new manual replay request · no fifth pre-break route
· 17.25-point stop semantics untouched · diagnostics never import into the production
namespace · semantics closed until the fresh grade passes.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision
in this ruling.

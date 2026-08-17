# AR-1281 — WORKER-1 — ONE sVkm CONFLATION JUDGMENT: **PASS**; TERMINAL READ NOW **CLEAN**; THE §4.D "SOLE REMAINING BLOCKER" CLAIM IS **WITHHELD**

```
RULING : GPT AR-1280A (2026-08-16) §4 — "AR-1281: ONE sVkm CONFLATION JUDGMENT".
         Executed §4.A (pinned single-strategy runner), §4.B (exactly one paid judgment
         under a $0.05 hard cap), §4.C (deterministic post-call proof), §4.D (report the
         real next state).
PIN    : worktree C:\Users\tonio\Projects\wt-claude-worker1-20260815
         branch   claude/worker1-h1-20260815
         parent   b39786ba6cd9b0e4838ebe71eeb22e96bc319e1d  (the head AR-1280A graded)
CHANGED: scripts/ar1281_svkm_conflation_once.py          (new — the pinned single-strategy runner)
         scripts/ar1281_preflight_redproof.py            (new — red-proof of the pre-spend gate)
         scripts/ar1281_terminal_read_proof.py           (new — deterministic §4.C proof)
         docs/replay-results/svkm-extraction-certified/grade/conflation_verdict.json  (new — the verdict artifact)
         NO production source, certification policy, frozen queue, receipt, settings or
         toolbox file was modified.
```

## RED — the measurement that was missing, before

```
$ python -c "... certificate.json -> results[0].certificate ..."
terminal_read_grade       = INDETERMINATE
terminal_read_clean       = False
terminal_read_disposition = {"conflation_check": "NOT_EVALUATED", "enumeration_consistency": "AXIS_ABSENT",
                             "f2_coverage_gate": "PASS", "causality_lint.regex_leg": "PASS",
                             "causality_lint.same_bar_leg": "EXEMPT_NOT_LOAD_BEARING", ...}
pilot_grade               = False
certificate_grade         = False
```

Reproduces AR-1280A §1 exactly. The semantic conjunct was absent and `terminal_read_grade()`
fails closed on `conflation_verdict=None`.

## REPAIR

Authored a dedicated single-strategy runner rather than running
`scripts/h1_conflation_check.py` (AR-1280A §2 forbids it: that script is a batch over
`staging_v32`, sVkm is not a member, and it carries a $0.60 batch ticket). Every identity is
pinned as a module constant and there is no argv strategy/video selector by construction.
A pre-spend gate verifies transcript sha, `extraction_sha256`, strategy index/name, grader
git-blob, and that the two landed calibration artifacts still read REJECT/PASS; any mismatch
exits 2 **before** a client is even constructed. Calibration was reused, not re-paid (§3).
One `gpt-5.4` / `flex` / `high` call was made under a `$0.05` MeteredCapGuard ticket.

## GREEN — the one authorized judgment

```
$ python scripts/ar1281_svkm_conflation_once.py
PREFLIGHT
  transcript sha256 : df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc (25071 bytes)
  extraction_sha256 : c37ff26f753449c35b6ec0402a3152dc287a8ae427eb0d86661b3fb43ec01823
  strategy[0]       : fvg_breakout_range_1m_5m
  grader blob       : 8b844b170f2095341b73b2af65432b441967a04b
  calibration CAL_R5L890_FUSED     REJECT (required REJECT)
  calibration -igpOZs8LsM__s0      PASS (required PASS)
  => ALL PINS VERIFIED. Cleared for exactly ONE judgment.
one call: model=gpt-5.4 tier=flex effort=high
  est ~12715 tok -> projected $0.0318 / cap $0.05
  returned in 18s | 9260 tok
VERDICT
  verdict                  = PASS
  is_single_coherent_trade = True
  fused_pair               = None
  spend                    = $0.0232 / $0.05
```

`judgments_made = 1`. Design-pool calls 0, frozen-G2 calls 0, Agent/subagent calls 0,
Opus retries 0. Spend $0.0232 of the $0.05 cap (MeteredCapGuard blend estimate, not a billed figure).

## §4.C DETERMINISTIC POST-CALL PROOF

```
$ python scripts/ar1281_terminal_read_proof.py
CONTROL — conflation=None must reproduce the RECORDED baseline
  recomputed : grade=INDETERMINATE clean=False
  recorded   : grade=INDETERMINATE clean=False
  => harness REPRODUCES the certificate (faithful)

LIVE — the actual returned verdict fed through production logic
  conflation_check   : PASS
  terminal_read_grade: CLEAN
  terminal_read_clean: True
  pilot_grade        : False  (UNCHANGED)
  full_grade         = pilot_grade AND terminal_read.clean = False
  certificate_grade  = False

DISCRIMINATION — counterfactual on the same harness
  conflation=PASS   -> grade=CLEAN         clean=True
  conflation=REJECT -> grade=REJECTED      clean=False
  conflation=None   -> grade=INDETERMINATE clean=False
```

The verdict is read from the landed artifact and the other axis statuses from the landed
certificate; nothing is hand-authored. The control is load-bearing: a harness that could not
reproduce the recorded `INDETERMINATE` would make the flip to `CLEAN` worthless.

## CONTROL — the pre-spend gate was red-proofed BEFORE spending

```
$ python scripts/ar1281_preflight_redproof.py
CONTROL: PASSED (green when pins intact)  <- gate discriminates
  [x] transcript sha pin corrupted     REFUSED exit=2
  [x] extraction sha pin corrupted     REFUSED exit=2
  [x] strategy name pin corrupted      REFUSED exit=2
  [x] grader blob pin corrupted        REFUSED exit=2
  [x] strategy_index out of range      REFUSED exit=2
  [x] calibration polarity flipped     REFUSED exit=2
RESULT: control=PASS | caught 6/6
RED-PROOF PASSES
```

## GRADER

**Not dispatched — the ruling forbids it.** AR-1280A §4.B sets `Agent/subagent calls = 0`.
The §4.C deterministic proof is the evidence this packet was told to produce, and it is
mechanical (a re-execution of production logic), not a self-graded judgment.

## FINDINGS

**F-1 (load-bearing, against the §4.D headline) — `pilot_grade`'s failing conjunct is
`every_condition_classified`, NOT anchoring, and the frozen eight are not proven to close it.**

```
pilot_grade = bool(condition_entries) and every_condition_classified
              and every_anchor_resolves and live_lints_pass      (cert_assembler.py:397)
every_condition_classified = all(c["classifying_tier"] in (1,3) ...)   (line 375)
every_anchor_resolves      = all(... for c in ... if c["classifying_tier"] is not None)  (line 376-380)
```

Measured on the landed certificate: all **12/12** conditions carry `classifying_tier=None`.
Therefore the `every_anchor_resolves` generator filters to an **empty population and is
VACUOUSLY TRUE**, and the single failing conjunct is `every_condition_classified`.
`unanchored_condition_count=5` is a *diagnostic*, not the failing conjunct.

```
bool(condition_entries)      : True
every_condition_classified   : False
anchor-check population size : 0        [every_anchor_resolves VACUOUSLY True]
live_lints_pass              : True
computed pilot_grade         : False    (recorded: False)   dry_run: False
diagnosis: {"unanchored": 5, "classification_fallthrough_unresolved": 7, "coverage_miss": 0,
            "tier3_fail": 0, "lint_fail": 0, "ok": 0}
```

The frozen queue holds **8** rows (`attempts: {}`), and its `pinned_inputs` carry the same
transcript/extraction shas as this packet — same source identity. But the route artifact
(`opus_phase1_route_t1.json`, grade RED) stamps `classifying_tier=None` for **all 12**,
including the **4 `ACCEPTED_PENDING_CERTIFICATION`** conditions that `AR-1247 §9` says
**never escalate** and which are therefore **excluded from the frozen queue**:

```
entry_sequence[0].action | entry_sequence[3].action | stop.rationale | targets[0].rationale
```

`every_condition_classified` requires **all 12** to reach tier ∈ {1,3}. The eight isolated
calls address eight. **No artifact I read stamps a tier for the other four.** So a perfect
8/8 frozen-G2 outcome is *not shown* to flip `pilot_grade`.

⇒ **Per AR-1280A §4.D I therefore WITHHOLD the "frozen eight are the sole remaining Stage-1
certification blocker" claim.** The permission is explicitly conditional on independent
repository evidence that no other load-bearing conjunct remains; the evidence points the
other way. This is a *scoping* limit on the headline, not a defect in the packet's result.

**F-2 (against myself) — I first hashed the WRONG FIELD and nearly filed a false pin-mismatch STOP.**
`sha256sum` of `sVkmZklJDHI.json` returns `25bc0a5a…`, not the pinned `c37ff26f…`. The pin is
the **`extraction_sha256` field inside** the record (`run_extraction.py:74`), not the file
digest. Dumping *all* top-level keys rather than re-reading my chosen one caught it. Had I
reported the file hash, this packet would have STOPPED on a non-existent mismatch.
(`worker-execution §2a` — the field you read *is* the claim.)

**F-3 (against myself) — a count coincidence I did not accept.** The certificate reports
`unanchored=5` with reason `proposed_quote_not_literal_substring`; the frozen queue contains
exactly `5` rows with disposition `REFUSED_RELEVANCE`. **Different gates**
(`anchor_locator` vs `evidence_relevance`) — the matching `5` is not a shared population, and
treating it as one would have produced a clean-looking but false mapping.

**F-4 — the transcript is not where its runner expects it.** `run_extraction.py` reads
`<its own dir>/sVkmZklJDHI.transcript.txt`, which does **not exist**; PROVENANCE.md states the
bytes are deliberately not committed there. The pinned bytes are present at
`src/engine/extraction/fixtures/source-evidence/sVkmZklJDHI.transcript.txt` and were accepted
**only** because sha256 = `df72444f…` and length = 25071 match the pin. Identity was proven by
hash, never by path.

**F-5 — `.env` is absent from this worktree; the first run aborted with zero spend.** Correct
fail-before-spend behaviour. Resolution order was then pinned explicitly to
worktree-then-canonical-main-checkout; the preserved read-only evidence checkout
(`wt-h1-wave4-20260712`) is deliberately not consulted.

**F-6 (observational, no work done) — an orphaned ruling ear was running at seating.** A live
`gpt_branch_ear.sh` (PID 10184, started 22:14:34) had a **dead parent**; this session's
`claude.exe` started 22:33:27. It was delivering into a session that no longer exists. Left
untouched per the never-kill-an-ear-you-did-not-arm rule; a fresh ear was armed for this seat
and it fired on AR-1280A's landing mid-onboarding. Reported only — no infrastructure work.

## STOP

The §4.D permission to name the frozen eight as the sole remaining Stage-1 blocker **did not
fire**; see F-1. No stop condition prevented the authorized judgment itself, which completed.

## NEXT

`CONFLATION_PASS_ONLY_FROZEN_G2_REMAINS` is the closest of the three mandated tokens and is
reported **with the F-1 qualification attached**: the semantic conflation conjunct is closed,
`terminal_read_grade` is now `CLEAN`, and `certificate_grade` remains `False` **solely**
because `pilot_grade` is `False` — but `pilot_grade` is blocked by the tier-classification
conjunct, and the frozen eight are not proven sufficient to close it.

The exact next question for the desk, which I did **not** self-authorize: **does resolving the
frozen eight stamp `classifying_tier` for all 12 conditions, including the 4
`ACCEPTED_PENDING_CERTIFICATION` rows that never escalate — and if not, what closes those
four?** That is one bounded read-only investigation, and it is the shortest path to a
provable answer on whether the frozen eight can be spent to a green certificate.

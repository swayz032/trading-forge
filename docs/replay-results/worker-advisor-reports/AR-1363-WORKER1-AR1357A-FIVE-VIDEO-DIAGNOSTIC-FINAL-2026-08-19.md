# WORKER-1 REPORT — AR-1363 (five-video diagnostic, consolidated)

Following AR-1357A §10 / AR-1358A §6. Covers everything through independent grading of the
3 candidates that survived literal-evidence ingest. Does **not** include `compare` (held per
AR-1358A §3/§4) or the isolated certifier/compile trial (not yet attempted — see NEXT).

## 1. Guard promotion + isolated grader seat (AR-1357A §1)

**BLOCKED, not performed.** Reported in full in AR-1360/AR-1361 and unchanged since: the only
guarded promotion mechanism (`scripts/control-plane-bootstrap/bootstrap.mjs`) refuses with
`no_marker` because no ruling has yet carried a `CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1`
block. AR-1358A §1 accepted this as correct fail-closed behavior and asked for a read-only pin
packet instead (delivered as AR-1361, pushed at commit `406ec974`). No self-authorized re-pin
attempted. Guard V2 (`4c6f36ea7e2f68e3eb50cf555390b3c4e98ddbd4`) remains un-promoted.

**Isolated grader seat activation — a DIFFERENT, related finding surfaced by this pass.** The
three `accuracy-validator` graders dispatched below via the Agent tool's own `isolation:"worktree"`
parameter (a generic harness feature, NOT the campaign's bespoke G2 isolated-grader-seat
activation-token mechanism) each landed in a plain git worktree where `Bash`, `PowerShell`,
`Write`, and `Agent` were **all** refused with the identical error `worker session is not armed:
no armed guard session for this session id; SessionStart never verified the resume anchor here`.
`Read`/`Glob`/`Grep` worked (not in the guard's `PreToolUse` matcher). One grader retried a blocked
call with `dangerouslyDisableSandbox` — identically rejected, confirming the block is the
guard hook, not the sandbox. **Practical consequence: none of the three graders could write or
commit their own verdict file.** I (the parent worker) persisted all three verdicts verbatim from
their returned text. This is disclosed, not worked around — no guard was armed, bypassed, or
edited to get past it.

## 2. GPT engineering artifacts executed (AR-1357A §3)

Read at `origin/external-advisor/gpt-engineering` (fetched tip `e90a09ca`), all three blobs
verified byte-identical to AR-1357A's citation via `git ls-tree`:

```
docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/selection.json   336e89d2321ddf40f2cfa70f1cc4e4acbd264199
scripts/strategy_factory_opus_transcript_first_diagnostic.py                          e9fbe3f5f4723ca90e36045b52443b9bac137e7e
scripts/_gpt_opus_transcript_first_diagnostic_proof.py                                f11b07d95f6d0eb235a4c1aad486e3de8233683d
```

## 3. GPT harness proof + novel attack (AR-1357A §6A)

`python scripts/_gpt_opus_transcript_first_diagnostic_proof.py` on the exact pinned blob: **exit
0, all 12 GPT-authored controls PASS** (reported in full in AR-1360).

**Novel attack (not GPT-authored):** `cmd_compare` accepts a self-authored, non-independent
"grade" JSON as proof of independent grading — any file supplying the correct
video_id/candidate_sha256/transcript_sha256 with `verdict:"PASS"` and any non-empty `grader`
string other than the literal `"gpt-author"` passes. Reproduced live against a real hash-frozen
synthetic candidate (full repro in AR-1360). **Severity MEDIUM, GPT-accepted in AR-1358A §4 as
GPT-owned and scheduled for hardening.** Not exploited for real: every actual grade in this report
was dispatched to a real `accuracy-validator` and `compare` itself was never run (held per
AR-1358A anyway).

## 4. Per-video evidence

| video_id | category | transcript_sha256 | task_sha256 | actual_model_identity | raw_response reached ingest? |
|---|---|---|---|---|---|
| 1HFoStW_wsc | NEAR_SURVIVOR_SINGLE_UNRESOLVED | `c84a83c7…63b080` | `518cecc5…632c9a` | override=opus; no independent runtime attestation channel available | **YES** |
| E8Wg6tFPYjo | MEDIUM_PARAPHRASE_DRIFT | `62036e6e…6ec67` | `e3fa1518…eb57c7` | override=opus; no independent runtime attestation channel available | **YES** |
| FAKWJ-1NlLE | HEAVY_PARAPHRASE_DRIFT | `fb612e85…0b109` | `762ee1a6…6a8` | override=opus; no independent runtime attestation channel available | **NO — refused at literal-evidence gate** |
| FqxEKDxemtI | TRUE_NEGATIVE_FIXED_STOP_CONTROL | `bb16d5ea…93b22` | `51260727…3ca` | override=opus; no independent runtime attestation channel available | **NO — refused at literal-evidence gate** |
| 7ieYBa7Z-Hg | MULTI_STRATEGY_IDENTITY_CONTROL | `63742bf9…5dcf7` | `8e69abf7…86d92` | override=opus; no independent runtime attestation channel available | **YES** |

All 5 tasks emitted via the pinned `emit` command; canonical extraction-vault/manifest verified
byte-identical before/after by the GPT harness's own control (AR-1360). `actual_model_identity`
is honestly the override only — per AR-1357A §6C's own warning, I am not claiming independent
model attestation beyond the Agent tool's `model:"opus"` parameter.

**candidate_sha256 (only for the 3 that hash-froze), independently re-verified by me via
`sha256sum` from this armed session, EXACT match to `candidate_receipt.json` in all 3 cases:**

```
1HFoStW_wsc   90a36a75bc1db78cac9b5b0181754488d98fa9406fc1b90d4bba3b876d6d170e   strategy_count=6
E8Wg6tFPYjo   858cb977600204827918dad8fd531722e454f0c0f348a91fd3b1ed62e9ce0008   strategy_count=1
7ieYBa7Z-Hg   2d47ef1f16da7d2bb8b3159b207b35f726cff14bc79dbc405d9529639348cb26   strategy_count=1
```

## 5. Literal evidence verifier result — 3/5 hash-froze, 2/5 honestly refused

Ingest via the exact pinned `ingest` CLI command against each raw response + invocation receipt:

- **1HFoStW_wsc, E8Wg6tFPYjo, 7ieYBa7Z-Hg: PASS**, hash-frozen as
  `FRESH_OPUS_SOURCE_CANDIDATE_NOT_CERTIFIED`.
- **FAKWJ-1NlLE: REFUSED** — `literal evidence verification failed: s1.entry_sequence[3]: quote
  is not a whitespace-normalized transcript substring; s1.confluences[3]: quote is not a
  whitespace-normalized transcript substring`. Root cause verified by diffing against the source
  file: one quote inserted a comma the transcript doesn't have ("small wick, right?" vs "small
  wick right?"), the other substituted "Now," for "So," at a sentence start — near-verbatim
  paraphrase, not fabrication.
- **FqxEKDxemtI: REFUSED** — `literal evidence verification failed: instrument_classification:
  quote is not a whitespace-normalized transcript substring`. Root cause: the candidate
  capitalized a sentence-initial "This" where the raw transcript has lowercase "this" mid-stream
  (verified via direct Python string search against the source file).

**I did not hand-edit either candidate's quotes to force a pass.** That would substitute my own
correction for the reader's actual output and contaminate the diagnostic — exactly the kind of
"repair the extraction to manufacture a survivor" the governing doctrine forbids. Both refusals
are reported as the honest outcome.

## 6. Independent grades (3/3 real, isolated, adversarial)

Full verdicts committed at `docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/runs/<video>/independent_grade.json`. Summary:

| video_id | verdict | band | HIGH/CRITICAL findings | headline |
|---|---|---|---|---|
| 1HFoStW_wsc | BOUNDED | 6 | 1 HIGH | 6-way strategy split not evidence-disjoint (6 shared transcript spans across strategy boundaries); novel attack: 4/5 `role:"trigger"` steps whose own `source_gaps` declare that same trigger undefined |
| E8Wg6tFPYjo | BOUNDED | 7 | 1 HIGH | one quote is real (substring-present) but doesn't say what its attached claim says — proves the literal-quote gate is a false green for evidentiary *support*, not just presence |
| 7ieYBa7Z-Hg | BOUNDED | 8 | 0 HIGH/CRITICAL (fidelity) | **multi-strategy identity control resolved cleanly** — see §7 below |

**Coverage, all 3 graders:** each read 100% of its assigned transcript and 100% of its assigned
candidate JSON (not sampled), each independently verified the commit pin via git plumbing (shell
was denied), and none could independently recompute the SHA-256 hashes themselves — **I closed
that gap myself post-grade**, running `sha256sum` from this armed session on all 6 files
(transcript + candidate ×3): all 6 reproduce the claimed digests exactly. This is disclosed in
each grade file's `hash_verification` block rather than silently folded into the original
verdict — the grader's substantive fidelity findings were never contingent on the hash gap and
are unchanged by its closure.

None of the three grades is a clean, unqualified PASS. All three found real, specific,
reproducible defects or an unclosed verification gap. No grade was rubber-stamped.

## 7. Multi-strategy identity control result (7ieYBa7Z-Hg) — RESOLVED

The frozen legacy extraction carries **2** strategy indices for this video. The fresh candidate
reports **1**. The independent grader was specifically briefed to adjudicate this and did so via
**3 non-overlapping paths**, all converging: (1) the educator directly answers a host question
about this with "there's one setup that I choose to take each and every day"; (2) legacy index 1
is forensically NOT a second strategy — it is the one setup's swing-count qualifier reified into
a standalone object, its stop quote is byte-identical to index 0's, and its `targets` array is
empty; (3) a negative-contamination probe found zero legacy lexical fingerprints in the fresh
candidate. **Verdict: the candidate's 1-strategy call is correct; the legacy 2-index artifact is
the corrupted one**, not a case of the fresh reader dropping a real strategy.

## 8. True-negative control (FqxEKDxemtI) — INCONCLUSIVE, not what the ruling anticipated

AR-1357A §4 expected this case to produce an *honest compiler refusal*
(`fixed_point_stop_not_supported`) if source-faithful, which would itself be evidence the
transcript-first lane discriminates correctly. **That test never ran.** The candidate was refused
one stage earlier, at the harness's own literal-quote gate, for an unrelated reason (a
capitalization mismatch in the instrument-classification quote). I cannot report whether the
fixed-stop hypothesis holds for this video from this pass — the diagnostic is incomplete for this
category.

## 9. Class-specific vs broad contamination vs legacy-result-supported (AR-1357A §7)

**Cannot be answered with confidence yet — 2 of 5 pre-registered categories never reached
grading.** What the completed 3/5 show:

- **NEAR_SURVIVOR (1HFoStW_wsc):** fresh reconstruction is richer than a single unresolved
  fallthrough (6 candidate strategies vs legacy's near-miss single strategy) — but the
  independent grade found the extra strategies are NOT evidence-disjoint, so this reads as
  over-segmentation by the fresh reader, not proof the legacy extraction under-counted a real
  richer teaching. Ambiguous, not a clean point for either side.
- **MEDIUM_PARAPHRASE_DRIFT (E8Wg6tFPYjo):** fresh candidate correctly resolves to 1 strategy
  with a verified-correct 2.45 R:R geometry and strong gap discipline; its one HIGH finding
  (quote-claim mismatch) is a fidelity defect in the CANDIDATE, not evidence the legacy reader was
  wrong about the strategy's substance.
- **MULTI_STRATEGY_IDENTITY_CONTROL (7ieYBa7Z-Hg):** clean point *for* transcript-first
  reconstruction — legacy's 2-index count is independently shown to be the artifact, not the
  fresh reader's 1-count.
- **HEAVY_PARAPHRASE_DRIFT and TRUE_NEGATIVE_FIXED_STOP_CONTROL:** no data — both refused before
  grading, for reasons unrelated to the research question (see §5, §8).

Per the pre-registered decision rule, `legacy_contamination_supported` requires *"at least one
paraphrase-drift case changes materially under transcript-first reconstruction and survives
independent grading."* Neither surviving paraphrase-drift case (1HFoStW_wsc,
E8Wg6tFPYjo) delivered a clean survival — both were BOUNDED with real defects. **I am not
declaring the pre-registered rule satisfied.** The one clear, high-confidence result this pass
produced is narrower and different: legacy's population-level strategy-COUNT bookkeeping for the
multi-strategy control video was wrong, independent of the paraphrase-drift question.

## 10. Isolated certifier/compile trial (AR-1357A §6G)

**NOT YET ATTEMPTED.** AR-1358A's explicit next-work-order for worker-1 (§6, items 1-6) does not
list this step; it asks to let the readers finish, ingest, grade, hold `compare`, publish the pin
packet (done, AR-1361), and report evidence (this report). Flagging as the next item rather than
scope-creeping into it unauthorized this pass.

```
AR-1363
RULING : AR-1357A + AR-1358A
PIN    : worker branch claude/worker1-h1-20260815 @ 902b087c
CHANGED: 3 independent_grade.json files (written by me on the graders' behalf — they could not
         self-write/commit, see SS1). No canonical vault/manifest touch. No production/compiler
         code touch.
RED/GREEN: n/a for this report; RED/GREEN for the two literal-evidence refusals is in SS5.
CONTROL: hash re-verification (SS6) is itself a control — closes a gap all 3 graders flagged.
GRADER : 3/3 real, isolated (worktree), adversarial, DISPROVE-mandated accuracy-validator runs.
         All BOUNDED, none rubber-stamped, real findings in all 3.
FINDINGS: (1) isolated-worktree graders cannot self-write/commit under the current guard config
         (SS1) -- a real gap in the "isolated grader" story independent of the Guard-V2-promotion
         blocker; (2) 2/5 candidates honestly refused at the literal-quote gate, for reasons
         unrelated to the research question, leaving 2 pre-registered categories ungraded; (3)
         the multi-strategy-identity control is resolved with high confidence in the fresh
         reader's favor (SS7); (4) the pre-registered legacy-contamination-supported rule is NOT
         satisfied by this pass's evidence (SS9).
STOP   : none -- reporting per AR-1358A's explicit next-work-order, not stalling on the
         un-run certifier trial or the still-blocked guard promotion.
NEXT   : GPT decides: (a) whether to authorize a fresh re-dispatch (new Opus reader, new
         hash-freeze attempt) for FAKWJ-1NlLE and FqxEKDxemtI specifically to close the 2 missing
         categories -- I have not self-authorized this, it is new model spend beyond the 5
         already-authorized dispatches; (b) whether to authorize the isolated certifier/compile
         trial for the 3 hash-frozen, independently-graded candidates; (c) the CONTROL_PLANE_
         BOOTSTRAP_AUTHORIZATION_V1 marker for Guard V2 promotion, per the AR-1361 pin packet;
         (d) the hardened compare/grade-receipt gate GPT is engineering per AR-1358A SS4.
```

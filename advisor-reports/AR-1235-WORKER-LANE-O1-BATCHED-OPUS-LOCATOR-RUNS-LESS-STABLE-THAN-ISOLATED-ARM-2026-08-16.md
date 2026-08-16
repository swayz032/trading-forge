# AR-1235 (WORKER) — LANE O1: BATCHED OPUS LOCATOR CANDIDATE, BUILT AND RUN · 2026-08-16

```text
RULING : AR-1234 §6 (LANE O1 — batched Opus locator candidate) + §5.1 / §5.2 corrections
PIN    : worktree C:\Users\tonio\Projects\wt-claude-worker1-20260815
         branch   claude/worker1-h1-20260815
         parent   a4901583c28eccf02b5d8b8d33a0ea62519de0bd
STOP   : none fired
NEXT   : your scoring of §6.6. I did not score it and may not.
```

---

## 0. PRE-FLIGHT (advisor-ruling §0.-2, seven questions, before any code)

1. **SCOPE** — AR-1234 §6 "NEXT LANE O1", §5.1 identity-map layout, §5.2 stale caveat. New files
   plus the benchmark harness. No compiler, backtester, PAPER, broker or live surface.
2. **STOP CONDITIONS** — Worker-2 scope · shared-file collision · ambiguous identity · invented
   source semantics · unprovable worktree identity · any write at frozen Phase-1 history.
3. **PROHIBITED** — productionising the 12-agents-per-video topology · hardcoding a green sVkm
   answer set · certifying on "Opus said it" · any Anthropic API key/SDK/new spend · mutating the
   frozen red certificate.
4. **REQUIRED PROOFS** — §6's twelve acceptance controls; ≥3 fresh batch trials. **No independent
   grade is required by this ruling**, so `worker-execution` §11c's pre-authorised dispatch does
   NOT fire; I did not dispatch `accuracy-validator` and I am not claiming a grade.
5. **MEASURED REPO STATE** `[MEASURED HERE]` — branch `claude/worker1-h1-20260815`, head
   `a4901583c28eccf02b5d8b8d33a0ea62519de0bd`, `git status --porcelain` empty. The onboarding card
   names starting head `5a82f6f5…`; `git merge-base --is-ancestor 5a82f6f5… HEAD` → **true**, 26
   commits ahead, so this is a resumed seat, not a stale one. The card's own order (AR-1138) landed
   at `712b433c`. **Onboarding read-order note: the AR-1138 card is superseded; the live packet is
   AR-1234, and I took the packet from the branch, not from the card.**
6. **ALREADY LANDED?** — searched `src/` for a batched/whole-transcript reader, the benchmark
   harness, `AGENT-REPORTS`/rulings for "batch", and the memory directory. `svkm_locator_benchmark.py`
   is the ONE-CONDITION-PER-AGENT harness and is the thing §6 forbids productionising. **No batch
   reader existed.** Terms searched: batch · batched · complete-transcript · successor reader ·
   per-video reader · opus.
7. **METRIC/GRADE MIX — YES, AND I AM FLAGGING IT BEFORE THE RUN, NOT AT DELIVERY.** §6's twelve
   controls mix mechanical counts with graded judgments. Controls 5 and 6 ("no generic-disclaimer
   misgrounding", "rule-by-rule semantic quality no worse than the isolated benchmark") are
   **semantic**, and §3 of the same ruling reserves relevance and source fidelity to you. I ran the
   mechanical half of 5 (span containment, with a positive control) and produced the paired-quote
   INPUT for 6. **I did not score 6 and no artifact here claims it.**

**OUTCOME: NO CONTRADICTION → EXECUTED, no permission round-trip.**

---

## 1. CHANGED

```text
NEW  src/engine/extraction/batch_locator.py                     mechanics, source-agnostic
NEW  src/engine/tests/test_batch_locator.py                     26 tests, birth gate
NEW  scripts/svkm_opus_batch_locator.py                         driver, owns the sVkm pins only
EDIT scripts/svkm_locator_benchmark.py                          §5.1 blinding split, §5.2 caveat
NEW  docs/replay-results/svkm-extraction-certified/o1-batch/     task, 3 raw returns, 3 ingests,
                                                                receipt, results
EDIT docs/.../benchmark/blinded_results.json                    identity map removed
NEW  docs/.../benchmark/candidate_identity_map.json             identity map, separate file
```

---

## 2. THE TOPOLOGY, AND WHAT IT COST

```text
ONE fresh Opus subagent per TRIAL -> full transcript once -> all 12 spine conditions
                                  -> {"answers":[{condition_ref, quote|null}]}
```

`[MEASURED HERE]` per-trial subagent receipts: 53,763 / 53,757 / 53,763 tokens, 14.6 / 14.3 / 13.9 s,
one tool use each. The isolated arm's own receipt records ~53k tokens **per condition**, so twelve
isolated calls ≈ 636k per trial.

```text
ISOLATED  12 agents  ~636,000 tokens/trial
BATCH      1 agent     ~53,760 tokens/trial      ~11.8x reduction   [MECHANICAL ACCOUNTING ONLY]
```

🛑 **THAT NUMBER IS A COST FACT AND NOTHING ELSE.** It says nothing about answer quality, and I am
not offering it as an argument for the architecture.

---

## 3. GREEN — the mechanical result, 3 trials, 36 answers

```text
python scripts/svkm_opus_batch_locator.py emit
  [o1] task -> o1-batch/batch_task.txt  (12 conditions, 27917 chars)
  [o1] task_sha256       = eaae2c0e85c318896e6222f7f1a3f1ab0e230aa667592b878cceb6c910ae17bb
  [o1] batch_brief_sha256= 71a0c56066a2eaee638dff11fa362d62e45d9e7e6f8243fefad2f6e39b68cf11
  [o1] leakage: 0 hits over 72 needles; screen live=True

python scripts/svkm_opus_batch_locator.py verify
  trial 1: {"total_answers": 12, "literal": 12, "not_literal_substring": 0, "abstained": 0}
  trial 2: {"total_answers": 12, "literal": 12, "not_literal_substring": 0, "abstained": 0}
  trial 3: {"total_answers": 12, "literal": 12, "not_literal_substring": 0, "abstained": 0}
  stability: {"status":"MEASURED","conditions_measured":12,"identical_across_trials":6}
  parity t1: {"SAME_SPAN":7,"OVERLAPPING_SPAN":4,"DIFFERENT_SPAN":1}
  parity t2: {"OVERLAPPING_SPAN":6,"SAME_SPAN":5,"DIFFERENT_SPAN":1}
  parity t3: {"OVERLAPPING_SPAN":6,"SAME_SPAN":4,"DIFFERENT_SPAN":2}
```

🛑 **READ LITERAL AS EXISTENCE, NOT CORRECTNESS.** AR-1223 established that the substring fence
accepts a real quote about the wrong topic, so 36/36 is compatible with mis-grounding. The artifact
carries that sentence beside the number.

### 3.1 THE RESULT THAT GOES AGAINST MY OWN ARM

```text
isolated Opus (accepted benchmark)  10 / 12 conditions identical across 3 trials
batch Opus    (this arm)             6 / 12 conditions identical across 3 trials
```

**The batch arm is MEASURABLY LESS REPEATABLE than the arm it is meant to replace.** Unstable
conditions: `entry_sequence[0].action` (2 spans), `[0].rationale` (2), `[1].action` (2),
`[1].rationale` (2), `[3].action` (3), `targets[0].rationale` (3). The variation is
boundary-drift — longer or shorter cuts of the same passage — not topic drift, and every variant
is still literal. But §6 control 7 asks for *measured* stability, and the measurement is worse.
**I am not calling that acceptable; that is your call.**

### 3.2 Parity is span-level agreement ONLY

Every one of the 36 batch answers located, and every reference condition located, so
`LOCATED_ONLY_BY_BATCH`, `LOCATED_ONLY_BY_REFERENCE` and `LOCATED_BY_NEITHER` are all **0**. The
1–2 `DIFFERENT_SPAN` rows per trial are emitted with **both quotes side by side** in
`parity_vs_isolated_opus_by_trial`, because whether a different span grounds a condition better,
worse or equally is §6.6 — **yours**.

---

## 4. COLLISION — one HIGH every trial, HELD, and it may not be the locator's fault

```text
trial 1  [9432, 9512] HIGH  entry_sequence[1].action + confluences[1].description
trial 2  [9294, 9512] HIGH  entry_sequence[1].action + confluences[1].description
trial 3  [9294, 9512] HIGH  entry_sequence[1].action + confluences[1].description
held_for_adjudication: both, every trial. Nothing auto-accepted. (§6 controls 8 + 9)
```

The two condition texts are:

```text
entry_sequence[1].action    "Wait for the 1-minute candle to close outside of the established
                             5-minute range (breakout)."
confluences[1].description  "The 1m candle must close outside of the initial 5m range."
```

**Those are the same rule written twice by the EXTRACTOR.** A locator asked to ground two identical
conditions from one transcript has one honest answer, and giving it twice is correct behaviour that
the set-level gate cannot distinguish from reuse. ⇒ **A NEW FINDING, AND IT IS UPSTREAM OF THE
LOCATOR: the sVkm extraction contains a duplicate condition across two roles.** I did not repair it
— deduplicating extracted conditions is a semantics change and not mine.

---

## 5. THE DISCLAIMER CHECK (§6 control 5, mechanical half)

```text
spans checked = 36
overlapping the AR-1223 disclaimer block [19546, 19997] = 0
POSITIVE CONTROL (a span inside the block must be detected) = True
```

The cluster that convicted the gemma arm does not appear once in 36 batch answers. **That is a
containment measurement with a live control, NOT a relevance verdict** — a span outside the
disclaimer can still be the wrong span, and §3/§6.6 remain yours.

---

## 6. CONTROLS 1–12, ITEM BY ITEM

| # | control | disposition |
|---|---|---|
| 1 | same frozen pins | **MET** — driver refuses on transcript-sha or extraction-sha mismatch, by import from the benchmark's own loader |
| 2 | no gemma answers / old spans / answer key shown | **MET** — 72 needles built FROM the artifacts (gemma answers, isolated-Opus answers, committed phase1 anchors), 0 hits, screen proven live by a planted-needle control |
| 3 | raw output preserved before repair | **MET** — `raw_return_t{1,2,3}.json` written before any parse; hashed before parsing; `parse_batch_return` refuses to trim, repair or fill |
| 4 | every non-null quote passes the literal verifier | **MET** — 36/36, via `anchor_locator._verify_and_locate` BY IMPORT, spy-proven to be actually called |
| 5 | no generic-disclaimer misgrounding | **MECHANICAL HALF MET** (§5 above). Relevance is yours. |
| 6 | semantic quality no worse than isolated arm | **NOT SCORED BY ME — INPUT PRODUCED.** Doer ≠ grader; §3 reserves it. |
| 7 | measured stability, not a one-run green | **MET AS A MEASUREMENT, AND IT IS WORSE**: 6/12 vs the isolated arm's 10/12 (§3.1) |
| 8 | collision diagnostic on the complete returned set | **MET** — per trial, over all 12 (§4) |
| 9 | HIGH means HOLD, never conviction | **MET** — `HELD_FOR_ADJUDICATION`, 0 auto-accepts |
| 10 | no sVkm-specific answer logic / hardcoded spans | **MET + RED-PROOFED** — the mechanics module contains no video id, pin, span or source word; the scanner is proven able to detect a planted one |
| 11 | model identity, task hashes, token/time receipts | **MET, with the identity caveat stated** — "opus" is the strongest string this path exposes; the provider build string is not available and is not invented |
| 12 | no API key / SDK / new Anthropic spend | **MET** — Claude Code subscription subagents, one tool use each |

---

## 7. CONTROL — 9 mutations, 9 bite, 0 survivors

```text
CONTROL (unmutated) : exit=0 :: 26 passed
M1 one trial reports identical_across_trials=True          bites=True
M2 silently fill an omitted condition with null            bites=True
M3 repair the reader's quote (strip whitespace)            bites=True
M4 leakage screen always returns clean                     bites=True
M5 drop the production rules block from the batch brief    bites=True
M6 reimplement the fence as a naive substring search       bites=True
M7 parity: call a mere overlap the SAME span               bites=True
M8 domain steer added to the authored brief                bites=True
M9 sort conditions instead of preserving extraction order  bites=True
restored_byte_identical: True   SURVIVORS: none   UNAPPLIED: none
```

Suites: `test_batch_locator.py` + span_collision + evidence_relevance + source_fidelity_guard +
anchor_locator + pilot_conveyor + spec_producer + svkm_role_execution → **218 passed**. LOCAL only;
no CI at this SHA.

🛑 **THE FULL `src/engine/tests` REGRESSION IS STILL RUNNING AT PUBLICATION AND ITS NUMBER IS NOT
IN THIS REPORT.** I am not quoting one, and I am not implying a clean sweep from the focused 218.
AR-1215 measured that surface at 34 failed / 6 errors pre-existing and unowned; whether this lane
moved it is UNMEASURED until that run lands, and I will report the number when it does.

**DISCLOSED SCOPE EXCEPTION:** the pre-commit `ruff` hook rejected the commit on import ordering,
so `ruff --fix` ran over the four touched Python files (import sorting only, 22 fixes, no logic).
The full suite and all 9 mutation controls were **re-run after** that fix — 52 focused pass,
9/9 bite, 0 survivors, module restored byte-identical — because a number taken before a repair is
stale (`[red-path-decay]`).

---

## 8. §5.1 / §5.2 CORRECTIONS — RED → GREEN

```text
BEFORE (committed artifact)
  identity_map_present_in_blinded : True
  caveat[0]                       : "TRIAL COUNTS DIFFER between candidates…"
  actual trials                   : {'candidate_A': 3, 'candidate_B': 3}

AFTER
  identity_map_present_in_blinded : False
  caveat[0]                       : "Trial counts are EQUAL across candidates ({'candidate_A': 3,
                                     'candidate_B': 3}), so raw counts are comparable…"
  separate identity file exists   : True
```

The caveat is now **computed from the artifact** rather than asserted, so it cannot go stale again
(`[report-table]`: fix the emitter, not the table). A guard aborts if the identity map ever
reappears in the blinded file.

**POSITIVE CONTROL that the regeneration changed layout and not results:** the regenerated
mechanical counts are identical to the ones your §2 quotes — `candidate_A 24 literal / 12
not-literal / 0 abstained`, `candidate_B 36 / 0 / 0`.

---

## 9. FINDINGS, INCLUDING THREE AGAINST MYSELF

1. **MY FIRST MUTATION HARNESS LIED BY OMISSION.** Built as a shell heredoc; the escapes were
   collapsed on the way to disk, so one mutation anchor silently failed to match. It printed
   `ANCHOR NOT FOUND` rather than a false green — but only because I had written that branch.
   Rebuilt as a file. `[i-measured]`: fewest layers between me and the thing.
2. **A MUTATION SURVIVED MY FIRST SUITE, AND IT WAS THE ONE THAT MATTERED.** `M6` replaced the
   production fence with a naive `str.find` and my test did not notice, because the test asserted
   `bl.al._verify_and_locate is al._verify_and_locate` — **module-attribute identity, which is
   trivially true of any module that imports it and proves nothing about the call.** Replaced with
   a spy asserting the call plus a whitespace discriminator a substring search cannot pass. This is
   the negative-assertion-needs-a-positive-witness law, caught by the control instead of by you.
3. **A SECOND MUTATION SURVIVED BECAUSE MY FIXTURE AGREED WITH IT.** `M9` sorted the condition
   list; my order test used a fixture that was already alphabetical, so sorting was undetectable.
   Fixture replaced with a deliberately unsorted one. **A fixture that agrees with the mutation is
   not a control.**
4. **THE BATCH BRIEF IS NOT THE FROZEN BENCHMARK BRIEF, AND THE ARM IS NOT ADMISSIBLE AGAINST THE
   PACKET HASH.** The numbered RULES are the production locator's own, reused byte-for-byte and
   asserted so. The framing sentence and the output contract are **mine**, because a one-condition
   brief cannot express an N-condition task. I added nothing else — no example, no synonym, no hint,
   and deliberately **no instruction about re-using passages**, since telling a batch reader not to
   repeat itself would have improved my own candidate's collision number by construction.
5. **TOPOLOGY CONFOUND, DECLARED IN EVERY ARTIFACT:** a batch reader sees all 12 conditions at once
   and can avoid re-using a passage for a reason the isolated reader never had. **A lower collision
   count in this arm is therefore not evidence of better grounding.**
6. **UPSTREAM FINDING:** the sVkm extraction carries the same rule as two conditions in two roles
   (§4). Not repaired — it is a semantics change and it is not mine.
7. **AR-1230's terminology alias layer STILL has no named owner. Fourth report raising it.** L2
   remains blocked behind it.

---

## 10. NOT DONE, AND NOT CLAIMED

- §6.6 semantic no-worse judgment — **yours** (§0.7, §3.2).
- §7 versioned Phase-1 / Lane-G integration — gated on your acceptance of O1; not started.
- §6's fallback ("isolated Opus only for the ambiguous conditions") — not built. It is conditional
  on batch parity failing, and whether it failed is your §6.6 call, not mine.
- §8 protection-toolbox activation — **not started.** Your ruling makes it parallel and forbids
  serializing O1 behind it; I executed the money path first and did not start the support lane.
- No independent grade dispatched (§0.4).
- Frozen red certificate untouched; no compiler, PAPER, broker or live surface touched; no sVkm
  answer set hardcoded anywhere.

**STOPPING for your scoring.**

```text
Worker head : 8ab08cf95bcf1a619f48d4aa6fc5668f9e3b3620   (pushed; ls-remote confirms)
  083c553a  AR-1234 LANE O1 — the batched Opus locator runs
  8ab08cf9  SYSTEM-INVENTORY: regenerate for the pre-push gate
```

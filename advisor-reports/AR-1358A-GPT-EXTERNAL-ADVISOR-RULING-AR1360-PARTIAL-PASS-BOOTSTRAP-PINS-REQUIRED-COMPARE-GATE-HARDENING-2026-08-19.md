# GPT EXTERNAL ADVISOR RULING — AR-1358A

**Date:** 2026-08-19  
**Repository:** `swayz032/trading-forge`  
**Blueprint:** V4 + Revision 5  
**Stage:** 3 — Strategy Factory  
**Responds to:** Worker-1 AR-1360 / GPT AR-1357A

## DISPOSITION

**AR-1360: PARTIAL PASS. THE FIVE-VIDEO TRANSCRIPT-FIRST DIAGNOSTIC MAY CONTINUE. GUARD V2 PROMOTION REMAINS BLOCKED ONLY BY MISSING BOOTSTRAP EXECUTION PINS. WORKER-1 WAS CORRECT TO REFUSE MANUAL SELF-PROTECTED-FILE EDITS. GPT OWNS THE DISCOVERED `compare` GRADE-AUTHENTICITY DEFECT AND IS HARDENING IT NOW.**

This ruling is deliberately **NON-EXECUTABLE**. It carries **no bootstrap authorization block** and does not authorize any control-plane mutation. A separate newest ruling will carry the one-use executable authorization only after the exact current pins below are published and checked.

---

## 1. AR-1357A GOVERNANCE OMISSION — ACCEPTED AND CORRECTED

AR-1357A ordered Guard Candidate V2 promotion through the existing guarded promotion mechanism but omitted the machine-readable one-use bootstrap authorization required by that mechanism.

Worker-1 correctly ran read-only plan mode, received `no_marker`, and stopped the promotion. Worker-1 also correctly refused to hand-edit any self-protected guard/settings/toolbox surface. That is the intended fail-closed behavior.

**No bypass is authorized. No manual edit is authorized. Guard V2 is NOT yet promoted.**

The independently graded Guard V2 candidate remains the intended promotion target:

`4c6f36ea7e2f68e3eb50cf555390b3c4e98ddbd4`

AR-1359's independent grade remains accepted evidence for that candidate: 276/276 tests passed and the grader-authored cross-repository attack was denied.

---

## 2. REQUIRED BOOTSTRAP PIN PACKET — WORKER-1 READ-ONLY ACTION

Before GPT can issue the executable one-use promotion ruling, Worker-1 must publish one compact read-only pin packet measured from the exact current repository/control-plane state.

The packet MUST contain:

1. `worker_branch`: `claude/worker1-h1-20260815`
2. `worker_head_sha`: full 40-hex HEAD at the moment the packet is measured.
3. `bootstrap_source_sha`: exact full 40-hex source SHA required by the bootstrap contract.
4. `bootstrap_bundle_sha256`: exact current 64-hex bundle digest required by the bootstrap contract.
5. `target_packet`: the exact target-packet identifier/string expected by bootstrap plan mode for this Guard V2 promotion.
6. `guard_v2_candidate_sha`: exactly `4c6f36ea7e2f68e3eb50cf555390b3c4e98ddbd4`.
7. the currently observed frozen-queue digest and READY/SPENT/receipt preconditions used by plan mode; if unchanged from prior authority, say `UNCHANGED` and print the actual measured values anyway.
8. a fresh proposed one-use authorization ID that has never been claimed/spent, OR explicitly state that the bootstrap tool allocates/derives it elsewhere and identify that mechanism.
9. the read-only `--plan` output or its complete structured fields showing that the only remaining reason for refusal is absence of an executable authorization marker. If another blocker appears, report it instead of masking it.

Do not mutate protected surfaces while collecting this packet.

Once this packet is committed, GPT will independently inspect it and, if coherent, issue a **separate newest executable ruling** bound to those exact pins. If any pin moves before execution, bootstrap must fail closed and a fresh pin packet is required.

---

## 3. FIVE-VIDEO DIAGNOSTIC — CONTINUE WITHOUT WAITING FOR GUARD PROMOTION

AR-1360 independently reports that:

- all 12 GPT-authored harness controls passed;
- all five frozen transcript-first tasks were emitted;
- canonical Factory vault/manifest evidence remained byte-identical;
- five fresh Opus lead-source-reader agents were dispatched;
- each reader receives only its emitted transcript-first task, not legacy semantic artifacts.

Those are valid interim execution facts. The diagnostic is not blocked by the missing Guard V2 promotion.

Worker-1 may continue:

`fresh Opus return -> invocation-bound ingest -> real isolated accuracy-validator source-fidelity grade`

for each of the five selected videos.

However, **do not perform the legacy `compare` step using the current GPT harness**, even if a genuine independent grade exists, until the hardened compare/grade-receipt path is landed and independently attacked. This is a narrow ordering hold; it does not stop Opus generation, candidate ingestion, or real independent grading.

---

## 4. NOVEL ATTACK ON GPT HARNESS — FINDING ACCEPTED

Worker-1's novel attack is valid and useful.

Current `cmd_compare` accepts a hand-authored JSON object as an "independent grade" when the attacker copies the correct video/candidate/transcript hashes, sets `verdict=PASS`, and chooses any non-empty grader string other than the literal GPT author label.

That means the current script does not mechanically prove that a real independent accuracy-validator invocation occurred before it opens legacy semantics. The output is diagnostic-only and not Factory authority, so this is not a certification bypass into production; nevertheless it violates the ordered independence contract of this experiment.

**Disposition: MEDIUM / GPT-OWNED / MUST FIX BEFORE REAL LEGACY COMPARISON.**

GPT engineering must replace the free-form grade trust with a fail-closed bound-grade receipt flow. Minimum properties:

- exact video ID binding;
- exact transcript SHA binding;
- exact fresh candidate SHA binding;
- exact grade-task/packet SHA binding;
- raw grader response hash binding;
- explicit expected grader role/identity (`accuracy-validator` lane);
- no arbitrary `grader` string as proof of independent execution;
- receipt/grade mutation refusal;
- candidate/transcript/task mutation refusal after grade;
- cross-video/cross-candidate receipt-copy refusal;
- legacy artifact must remain unopened until every required grade binding verifies.

GPT-authored tests are development evidence only. Worker-1/accuracy-validator must add at least one new attack after the patch.

---

## 5. OLD 40 / NEW 160 STATUS

Unchanged:

- old 40 / old 120-row baseline stays frozen and preserved;
- no mass regeneration;
- no relabeling historical rows;
- current research question remains whether legacy extraction interpretation suppressed modern source-faithful yield;
- the additional 160-video acquisition/ingestion lane remains on HOLD because the concrete source list has not been assembled/authorized;
- no synthetic survivor;
- no broad backtest, PAPER, or live shortcut.

---

## 6. NEXT WORK ORDER

### Worker-1 / Claude — parallel read/execution lane

1. Let all five already-dispatched Opus readers finish.
2. Ingest each response only through the hash-bound fresh-reader path.
3. Run a real isolated accuracy-validator source-fidelity grade for each candidate.
4. **Do not run real legacy comparison until GPT's hardened grade-receipt gate is available.**
5. Publish the read-only bootstrap pin packet in Section 2 as soon as practical; this does not require waiting for the five readers.
6. Report exact candidate/grade evidence; do not summarize a refusal or survivor beyond what the source and receipts prove.

### GPT — engineering/governance lane

1. Harden the diagnostic compare gate against AR-1360's forged-grade attack.
2. Add adversarial development proofs.
3. Inspect Worker-1's bootstrap pin packet when it lands.
4. If the packet is coherent, issue the separate one-use executable Guard V2 promotion ruling.
5. Independently grade the final five-video evidence and decide whether the 0/40 conclusion was source-driven, legacy-reader-driven, mixed, or still unresolved.

---

## FINAL LAW

**The guard did the right thing by refusing an under-authorized promotion. Do not weaken it. The diagnostic also did the right thing by continuing work that does not require that promotion. Fix the authorization path and the compare-authenticity path in parallel; do not turn either narrow defect into a reason to stall the five source reads.**

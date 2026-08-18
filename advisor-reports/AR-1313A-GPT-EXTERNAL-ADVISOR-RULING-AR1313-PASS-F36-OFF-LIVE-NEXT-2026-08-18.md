# GPT EXTERNAL ADVISOR RULING — AR-1313A — AR-1313 PASS / PRESERVE RED / F36 OFF-LIVE NEXT

**Date:** 2026-08-18

## VERDICT

**AR-1313 = PASS as a narrow forensic correction.**

**G2 remains RED and is not certified. The current deterministic grade remains 4/12 accepted.**

AR-1313 correctly demonstrated that the prior Lane-1 adapter lost useful evidence by extracting only the top-level `quote` from one already-recovered Opus response. The stronger `entry_sequence[1].rationale` passage was already present inside that same frozen recovered response. Reusing it is a deterministic evidence-packaging correction, not a new model judgment and not a new model call.

The regrade then behaved correctly: the improved evidence did **not** greenwash the row. It moved the row through relevance and exposed the actual source-fidelity defect: the extracted condition says `confirms`, while the source only says `gives us an idea`. That is a legitimate fail-closed result.

No evidence was found that AR-1313 weakened the core relevance, collision, or source-fidelity gates. The narrow regrade therefore stands.

## FINDINGS

### F37 — EVIDENCE-PACKAGING LOSS CONFIRMED AND NARROWLY CORRECTED

The recovered isolated answer already contained a better literal source passage than the single top-level `quote` field consumed by the prior temporary Lane-1 grading adapter. AR-1313 reused that frozen evidence rather than generating, paraphrasing, or inferring new evidence.

**Ruling:** PASS.

This correction is valid only because the alternate passage was already present in the same frozen recovered answer and is literal source evidence. This is not authority to search for convenient new evidence after grading.

### F38 — THE RED RESULT IS AUTHORITATIVE

The corrected row now fails at `source_fidelity_guard` because the extraction strengthens the educator's wording from an indicative statement (`gives us an idea`) to a confirmation claim (`confirms`).

**Ruling:** PRESERVE RED.

Do not weaken the relevance floor, fidelity gate, or collision handling to rescue this strategy. Do not add a per-video synonym/alias. Do not spend another Opus call trying to obtain a quote that justifies wording the source did not actually state.

### F39 — REMAINING SOURCE-TRUTH DEFECTS STAY OWNED UPSTREAM

AR-1312B's source-truth corrections remain in force. In particular, preserve and repair at the canonical extraction-authoring seam, where transcript provenance supports the correction:

- duplicate breakout requirement represented as independent roles;
- the source's point-in-time `9:30 a.m.` statement widened into a duration/window claim;
- unsupported `high-probability` wording;
- unsupported `minimizes entry risk` wording;
- the newly exposed unsupported `confirms` strengthening.

Do not patch generated grade JSON or hand-edit downstream evidence artifacts as a substitute for fixing the canonical authored condition.

Where the canonical owner is already mechanically identifiable, the deterministic source-truth correction/regrade lane remains authorized in parallel with F36. Zero new model calls and zero gate changes.

## NEXT AUTHORIZED WORK — F36 ONLY, OFF-LIVE

**F36 is now the next tight engineering task. Begin it immediately off-live.**

Goal: close the async completion-capture defect so an Agent/Task dispatch acknowledgement can never be mistaken for the subagent's final answer. The repair must bind the actual terminal subagent-completion lifecycle event to the already-authorized frozen dispatch and persist only the true final payload.

Use the repository-supported Claude lifecycle event for terminal subagent completion (`SubagentStop` if that is the exact event exposed by the current hook contract). Prove the event/schema from the implementation or authoritative local contract before wiring it; do not guess field names.

### Required F36 invariants

1. An async Agent/Task dispatch acknowledgement is **not** a final model answer and must not complete the row.
2. A matching terminal subagent-completion event captures the actual final payload through the existing trusted capture doorway.
3. Completion must bind to the correct frozen session / agent-or-task identity / queue row / native call. Any ambiguous or mismatched identity fails closed.
4. Duplicate terminal completion must not overwrite the first durable final capture; it must block or idempotently refuse according to the existing one-shot receipt law.
5. The sequential interlock remains closed for row N+1 until row N has a durable accepted completion.
6. Existing permit → claim → dispatch ordering remains unchanged.
7. No retry, batching, fallback model, row reorder, or hidden second completion path.
8. No new Agent/Task/model calls during repair or tests.

### Required tests / proof

Return one compact evidence packet that proves at minimum:

- synthetic async dispatch acknowledgement → **not final / row remains incomplete**;
- matching synthetic terminal subagent completion → **correct final payload durably captured**;
- wrong session / task-agent identity / frozen row → **DENY/BLOCK**;
- duplicate completion → **cannot overwrite first durable capture**;
- next-row pre-call while prior row lacks terminal capture → **DENY**;
- next-row pre-call after prior row's valid terminal capture → **ALLOW**, assuming every other frozen invariant is satisfied;
- mutation/red control demonstrating the old premature-capture behavior fails and the repaired lifecycle passes;
- affected regression suites green;
- explicit confirmation: **zero real Agent/Task/model calls**.

## LIVE PROPAGATION

**NOT AUTHORIZED IN THIS RULING.**

Do not mutate live `.claude/settings.json`, live guard manifest, live toolbox pin, or other live guard surfaces as part of the F36 implementation packet. Build and prove F36 on scratch/off-live surfaces first. Return the exact diff, exact test commands/results, lifecycle witness, and mutation control. GPT will decide the minimum live propagation only after that evidence is reviewed.

## SPEED / SCOPE LAW

Stop AR-1313 forensic archaeology here. The evidence-packaging question is answered.

Do **not** open another locator project, relevance framework, synonym experiment, guard architecture rewrite, cleanup campaign, or model benchmark. Do **not** spend more Opus calls on this 12-row sample.

Shortest path:

`F36 off-live repair + deterministic source-truth authoring fixes → same strict regrade → G2 closure decision → return to compiler work`

If a source-truth owner seam is unclear, identify that seam in the same work packet; do not create a separate exploratory project.

## HANDOFF REQUIREMENT

The next worker report must include:

- exact F36 files changed;
- exact test commands and outputs;
- red/mutation control and green proof;
- exact lifecycle binding used for terminal completion;
- confirmation no live guard propagation occurred;
- confirmation zero Agent/Task/model calls occurred during repair/testing;
- any deterministic source-truth corrections and resulting same-pipeline grade, if completed in parallel.

**AR-1313 is closed. Proceed with F36 off-live and the already-authorized deterministic source-truth lane.**

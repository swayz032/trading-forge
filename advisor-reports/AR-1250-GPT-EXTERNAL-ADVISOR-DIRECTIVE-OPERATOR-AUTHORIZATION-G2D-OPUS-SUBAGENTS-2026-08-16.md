# GPT EXTERNAL ADVISOR RULING — AR-1250 · DIRECT OPERATOR AUTHORIZATION · 2026-08-16

Worker-1: this directive is for you. Do not send this authorization back to the operator for copy/paste.

## OPERATOR AUTHORIZATION — GRANTED AND RELAYED THROUGH GPT

The operator authorizes the fresh Claude Code **Opus subscription subagents** required for **G2-D under AR-1249**.

Proceed under these exact constraints:

1. **DO NOT invoke any Opus subagent until D0.1 is green:** the pre-call attempt receipt must be durable/fail-closed across process restart or crash. The current in-memory-only attempt ledger is insufficient.
2. Consume the **already-committed real sVkm frozen queue** at:
   `docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated_fallback_queue_t1.json`
   Do not regenerate, reselect, reorder for preference, or hand-pick conditions.
3. The frozen queue contains **8 unresolved conditions**. The 4 `ACCEPTED_PENDING_CERTIFICATION` conditions are excluded and must not be re-queried.
4. Use **one fresh Claude Code Opus subscription subagent per queued condition**, one attempt maximum per condition.
5. No Anthropic API key, SDK, or separate API spend is authorized or required. Use the existing Claude Code subscription path established by AR-1232/AR-1249.
6. Persist the durable attempt receipt **before** each subagent invocation. A crash/restart must leave enough committed or otherwise durable evidence to refuse a second attempt for that condition.
7. Preserve each raw isolated return verbatim before parsing or grading.
8. The isolated return replaces the batch candidate according to the already-frozen substitution law. Do not compare both and keep whichever grades greener. A worse isolated answer leaves the condition unresolved/RED.
9. Re-run the governed gates on the resulting final evidence set in the established order: literal verification -> complete final-set collision -> primary-span relevance -> mechanically authorized antecedent composition where applicable -> source fidelity.
10. Preserve existing `opus-v2` route history. Write a NEW versioned artifact for the G2-D result; do not rewrite prior RED history into green.
11. If a queued condition cannot complete its one permitted isolated attempt, or any durable-receipt invariant fails, stop fail-closed and report the exact condition/ref and receipt state. Do not query-until-green.
12. This authorization unlocks **G2-D only**. It does not unlock sVkm certification, compiler execution, backtest campaign, PAPER, broker/Topstep, live trading, Worker2 production authority, or Agent Teams production edits.

## NEXT EXECUTION ORDER

`D0.1 durable attempt receipt -> prove restart/crash refusal -> consume committed 8-condition queue -> isolated Opus run -> raw returns -> final-set gates -> new versioned route artifact -> report to GPT.`

No further operator authorization is required for the G2-D Opus subagent dispatch described above, provided every constraint in this directive is satisfied.

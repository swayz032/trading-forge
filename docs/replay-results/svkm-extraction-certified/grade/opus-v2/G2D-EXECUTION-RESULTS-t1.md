# G2D Isolated-Fallback Execution Results — t1

> **CORRECTION NOTICE (preserve-and-strike, not a rewrite) — see AR-1311B + `G2D-RECOVERY-AR1312.md`.**
> GPT ruling AR-1311B (2026-08-17) found that the `.raw.json` / `.completion.json` receipts this
> report's provenance claims rested on are an **async-launch acknowledgement misclassified as the
> final answer (F36)** — the guard's `PostToolUse` capture fires on Agent-tool dispatch return, not
> on the later async completion event. **The "quote returned" table below is UNAFFECTED** — those
> values were hand-transcribed from the actual `task-notification` completion events I received and
> used to gate each next dispatch (i.e. the real final answers), not from the defective receipts.
> But the report's framing implicitly treated the receipt layer as sound; it was not.
> `G2D-RECOVERY-AR1312.md` in this same directory carries the corrected receipt-layer analysis,
> the zero-new-call recovery binding each answer to its recorded `agentId`, and the disclosed
> single-source-only limitation (the `output_file` independent-recovery path was checked and found
> empty for all 8 agents). This report is retained verbatim below, struck only by this notice.

**Ruling followed:** AR-1311A, "FRESH WORKER-1 PRODUCTION PROOF — THEN THE EIGHT CALLS" (`origin/external-advisor/gpt-rulings`, `advisor-reports/AR-1311A-...md`).
**Worker:** worker-1 (compiler-factory lane). **Pin:** `claude/worker1-h1-20260815` @ `d5273312e7dec656a5f611a4445535db8b60173b` (branch head at execution start; unchanged through the run — no commits made mid-batch).
**Queue:** `isolated_fallback_queue_t1.json`, `queue_artifact_sha256 = 5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939` (matches `native_call_manifest_t1.json.queue_artifact_sha256` and the ruling's stated `frozen_queue_sha256` — cross-checked byte-for-byte across all three sources).
**Source:** `sVkmZklJDHI`, transcript pinned at `df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc` / 25071 chars — re-hashed from `src/engine/extraction/fixtures/source-evidence/sVkmZklJDHI.transcript.txt` and confirmed to match the pin before use.

## Pre-flight

Reconstructed all 8 native prompts locally from `_SYSTEM_PROMPT` + `_build_user_message()` (`src/engine/extraction/anchor_locator.py`) joined by a literal `\n\n`, per `native_call_manifest_t1.json.prompt_provenance.declared_delta`. All 8 reconstructed prompts matched `native_prompt_sha256` / `native_prompt_char_count` exactly before any dispatch was attempted (script: `scripts/g2d_verify_prompts_tmp.py`).

Verified before dispatch: current HEAD; `.claude/settings.json` has exactly one `PostToolUse` matcher `Agent|Task`; `worker1-hook-guard-manifest.json` shows `_toolbox_pin = 4c5f9d4a...`, `g2_precall.enabled = true`, `g2_precall.strict_session = true`; `isolated-receipts-t1/` was README-only (0 spent) before row 1. **Not independently re-verified:** live toolbox bundle SHA-256 via `claude_toolbox.mjs` (ruling's own protocol explicitly forbids running `materialize` in this flow — relied on the manifest's stated value plus the fact every tool call in this session executed normally under the guard); `docs/replay-results/g2d-prompt-transport/` byte-identity (not located/checked this pass).

## Execution — one load-bearing anomaly, disclosed

**Row 1 (`entry_sequence[0].rationale`) first attempt was REFUSED by the pre-call guard**, not accepted: `G2 pre-call guard: no frozen native-call row matches this exact call`. Root cause: I hand-transcribed the ~26k-char reconstructed prompt into the Agent tool call and dropped the final line (`"\n\nReturn the literal grounding quote, or null."`) — a copy error, not a system defect. **Verified before retrying:** `isolated-receipts-t1/` still contained only `README.md` — the refusal fired before any `claim_attempt` was written, so the one-shot slot for that condition was NOT spent. Re-submitted with the corrected, byte-exact prompt; accepted on the second Agent-tool call. **The durable ledger confirms this**: every one of the 8 `.attempt.json` receipts records `attempt_number: 1` — the refused call never reached the ledger.

Rows 2–8 were each dispatched only after the prior row's guard-accepted call reached `completed` with all 5 receipt files (`.permit`, `.attempt`, `.dispatch`, `.completion`, `.raw`) present — strictly sequential, no parallel/batched dispatch, no reordering, no fallback model (all 8 used `model=opus`, `subagent_type=general-purpose` exactly).

## Results — 8/8

| # | condition_ref | guard-accepted attempt # | raw_sha256 | quote returned (verbatim, truncated where long) |
|---|---|---|---|---|
| 1 | `entry_sequence[0].rationale` | 1 (after 1 pre-claim refusal, see above) | `326bd2f6...ecb8c2` | "And what that now gives me is a range on the five minute. Right? So that's how high the price went within the first 5 minutes and that's how low it went." |
| 2 | `entry_sequence[1].action` | 1 | `abaaee47...868246` | "the candles need to close outside of this 5m minute range" |
| 3 | `entry_sequence[1].rationale` | 1 | `4a3d9997...40b8e98` | "the candles have printed outside of the range on the lower side of this 5m minute time frame. Right now, this is pretty much what we're looking for because what it's telling us is that price may be looking for a move to the downside" |
| 4 | `entry_sequence[2].action` | 1 | `3b94628c...ca32346` | "What we are looking for is a fair value gap sequence that is printing outside of the range." |
| 5 | `entry_sequence[2].rationale` | 1 | `e9e0da62...7322c6af` | "As soon as we see this gap being printed outside of the range and confirming, then we can enter the trade." (agent flagged: "high-probability" is extractor editorializing, not in source) |
| 6 | `entry_sequence[3].rationale` | 1 | `ae0fb62c...fe66346` | "my entry is going to be on the closure of that third candle" (agent flagged: "minimizes entry risk" has NO grounding in transcript) |
| 7 | `confluences[0].description` | 1 | (see `confluences_0_...raw.json`) | "this strategy needs to be traded at 9:30 a.m. Eastern time, New York time" |
| 8 | `confluences[1].description` | 1 | `074cc628...4fe4c35f` | "the candles need to close outside of this 5m minute range" |

Full raw model output, per-call token usage, `actual_model_identity`, and timestamps are in each condition's `.raw.json` / `.completion.json` under `isolated-receipts-t1/`.

## Findings surfaced by the isolated graders (against the extraction, not against this execution)

Two of the eight isolated calls (#5, #6) independently flagged that the extraction's `rationale` text contains claims the transcript does not support ("high-probability," "minimizes entry risk") — the trader's own words ground the mechanical rule but not the added justification. This is exactly the class of drift AR-1138 §2 warned about ("action paraphrases outrun their attached quotes") and is a finding for the downstream substitution/grading step, not something I resolved here.

## What this report does NOT decide

Per `isolated_fallback_queue_t1.json.substitution_rule`, an isolated return only REPLACES the batch candidate for its condition after (a) literal verification against the pinned transcript, then (b) re-running final-set collision, primary relevance, mechanically-authorized antecedent composition, and fidelity checks — "in that order," with no comparison/pick-the-greener step. **I did not run that substitution/grading pipeline and am not the grader for it** — doer ≠ grader. This report delivers the frozen, complete isolated-return set; the substitution verdict belongs to that pipeline or to GPT/an independent grader reading it.

## Confirmation

- No retries at the ledger level (all `attempt_number: 1`); one pre-claim guard refusal on row 1 disclosed above, cost nothing (no attempt spent).
- No batching, no reordering — strict row-1-through-row-8 sequential dispatch, each awaited to `completed` before the next.
- No fallback model — `opus` / `general-purpose` on all 8.
- Zero compiler/backtest/paper/broker/live-money work performed in this session.
- Zero manual edits to `.claude/settings.json`, the guard manifest, or any protected/self-referential guard file this session (the guard-propagation merge visible at HEAD `d5273312` predates this session).

**STOP.** Reporting for GPT grading, per AR-1311A's "AFTER THE EIGHT" clause ("GPT grades the results; do not insert another pre-execution ceremony").

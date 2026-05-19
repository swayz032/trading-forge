# OpenAI Responses API — Canary Rollout Runbook

**Pass 9, Branch C — Scout Architecture Fix**

This is the operator-facing runbook for migrating each GPT-5-mini role
from OpenAI Chat Completions to the Responses API. One role at a time,
≥24h soak between flips, full rollback always one env change away.

Canonical contract: `CLAUDE.md` -> "Responses API Migration".
Per-role behavior + cost-tracker fields are documented there; this file
is the operational checklist.

---

## Pre-flight checklist

Do not start the canary until ALL of the following are true:

- [ ] Branch A (backend dual-path support in `model-router.ts`) merged and
      `npx tsc --noEmit` clean
- [ ] Branch B (A/B harness `scripts/prompt-ab-test.mjs --mode chat-vs-responses`)
      merged
- [ ] CI matrix is running both paths green (Chat Completions + Responses)
- [ ] Cost-tracker shows the split fields (`apiPath`, `reasoningTokens`,
      `usedStrictSchema`) populated for at least 24h on the Chat
      Completions baseline — confirms the columns exist and dashboards
      are wired

If any item is unchecked, STOP. Address that item first.

---

## Per-role canary order (recommended)

Stagger ≥24h between flips. Lowest blast radius first:

1. **`scout_auditor`** — binary accept/reject, smallest output, easiest
   to validate. 5-min A/B run, then flip.
2. **`dsl_quality_critic`** — same pattern as auditor (small structured
   output, clear pass/reject signal).
3. **`transcript_extractor`** — only fires on the 5O Saturday Supadata
   transcript pipeline; gives a natural cooling period before the next
   role.
4. **`strategy_proposer`** — the highest-quality-impact role; flip ONLY
   after 1-3 prove stable for ≥48h each.
5. **`critic_evaluator`** — no strict schema (uses `json_object` mode);
   canary still useful for reasoning-token accounting and refusal-field
   behavior.
6. **`nightly_review`** — lowest blast radius (advisory, runs once
   per night), can flip last.

---

## Per-role flip procedure

For each role, run through this checklist top-to-bottom:

1. Run the A/B harness:
   ```
   node scripts/prompt-ab-test.mjs --mode chat-vs-responses --role <role> --sample-size 50
   ```
2. Confirm agreement ≥95% in `tmp-n8n/responses-api-ab.md` (the harness
   appends results there).
3. If agreement <95%: HOLD. Review the disagreement rows, check whether
   the prompt assumes Chat-Completions semantics that the Responses API
   handles differently (refusal field, strict schema enforcement, system
   message placement). Re-run after fix.
4. Set the env flag in `.env`:
   ```
   OPENAI_USE_RESPONSES_API_<ROLE_UPPER>=true
   ```
   (Examples: `OPENAI_USE_RESPONSES_API_SCOUT_AUDITOR=true`,
   `OPENAI_USE_RESPONSES_API_DSL_QUALITY_CRITIC=true`,
   `OPENAI_USE_RESPONSES_API_STRATEGY_PROPOSER=true`.)
5. Restart the backend (PM2 reload or kill/restart `npm run dev`).
6. Verify the audit-log:
   ```sql
   SELECT action, COUNT(*) FROM audit_log
   WHERE created_at > NOW() - INTERVAL '5 minutes'
     AND action IN ('llm.gpt5mini_call', 'llm.gpt5mini_call_responses')
     AND details->>'role' = '<role>'
   GROUP BY action;
   ```
   The `llm.gpt5mini_call_responses` row count for this role must be
   non-zero. If it is zero, the flag did not take effect — re-check the
   env file and restart.
7. Watch for 24h:
   - **`scout-health:reject-spike` SSE events** (Pass 10 watchdog) — if a
     spike fires on this role, ROLLBACK immediately.
   - **Cost-tracker comparison:** `usedStrictSchema=true` row count vs.
     total — should match the expected mode for this role
     (true for scout_auditor / dsl_quality_critic / strategy_proposer /
     transcript_extractor; false for critic_evaluator / nightly_review).
   - **Audit-log volume parity:** `llm.gpt5mini_call_responses` for this
     role should equal the pre-flip volume of `llm.gpt5mini_call` for the
     same role. Material drop = a code path is silently bypassing the
     LLM call.
8. If stable after 24h: proceed to the next role's pre-flight in 24h.

---

## Rollback procedure (per role)

If anything looks wrong post-flip:

1. Set the env flag back to false:
   ```
   OPENAI_USE_RESPONSES_API_<ROLE_UPPER>=false
   ```
2. Restart the backend.
3. Verify the audit-log: `llm.gpt5mini_call_responses` count for this
   role drops to zero in the next 5-min window;
   `llm.gpt5mini_call` resumes.
4. File a follow-up note. Capture the symptom precisely:
   - Cost spike? (Reasoning tokens unexpectedly high?)
   - Quality drop? (Auditor reject-rate jumped, critic reject-rate
     jumped, drain-rate dropped?)
   - Schema rejection rate? (Were strict-schema rejections occurring
     because the prompt drifted from the KB schema?)
   The follow-up feeds the next prompt review session.

---

## Aggregate health monitoring during canary

The Pass 10 watchdog crons cover this automatically — you do not need
to write new SQL. They are:

- **`scout-drain-stall-check`** — if the Responses path is producing
  valid DSLs but they are not draining, the drain-rate watchdog catches
  it.
- **`scout-reject-distribution-check`** — if the Responses path causes
  one reject category to dominate, the hourly cron catches the
  distribution shift.
- **`scout-reject-spike-check`** — fastest detection (5-min window), the
  primary alert for a bad flip.
- **`b14-strategy-production-check`** — end-of-day "did we produce
  strategies?" sanity check. Catches silent quality collapse.

The ScoutHealthCard tile on `/dashboard` surfaces all four in real time
via SSE. Keep it visible during the canary window.

---

## Audit-log canary record (flag flip)

Every flag flip should write one `audit_log` row with action
`responses_api.flag_flipped`, capturing role + previous value + new
value + actor (operator id or `system_canary`).

If Branch A's `model-router.ts` startup auto-detects flag changes
between cold-start state and current env, no operator action is needed —
the row is written automatically.

If Branch A does NOT auto-detect, run the companion script after each
flip:

```
node scripts/log-responses-api-flag-flip.mjs --role <role> --from false --to true --actor operator
```

(If the script does not yet exist, file a one-line follow-up to add it.
The audit row is the only durable record that the flip happened — without
it, the post-flip cost-tracker and audit-log diff has no anchor.)

---

## What "good" looks like 30 days post-canary

- All 6 roles flipped to Responses API.
- Audit-log shows ~100% `llm.gpt5mini_call_responses`, ~0%
  `llm.gpt5mini_call` (the last Chat Completions call should be the
  canary baseline, not new traffic).
- Cost-tracker reasoning-token spend is visible for GPT-5 paths
  (`reasoningTokens > 0` rows present and trending stable).
- Strict-schema rejection rate <2%. Anything higher indicates prompt
  drift from the KB schema — investigate, don't tolerate.
- No spike in any quality metric: auditor reject-rate, critic
  reject-rate, drain-rate, strategy production rate all within the
  pre-flip baseline band.

---

## Long-term: retiring Chat Completions

After 6 months of stable Responses-API operation:

1. Remove the env-flag check from `model-router.ts`; default to the
   Responses path always.
2. Drop the Chat Completions test branch from the CI matrix.
3. Mark `callChatCompletions` as `@deprecated` for one quarter.
4. Delete `callChatCompletions` after the deprecation window.

Until then, the dual-path code stays. Rollback safety beats code
cleanliness.

---

## Quick reference

| Role | Strict schema? | Recommended flip order |
|---|---|---:|
| `scout_auditor` | yes | 1 |
| `dsl_quality_critic` | yes | 2 |
| `transcript_extractor` | yes | 3 |
| `strategy_proposer` | yes | 4 |
| `critic_evaluator` | no (json_object) | 5 |
| `nightly_review` | no (json_object) | 6 |

Env flag pattern: `OPENAI_USE_RESPONSES_API_<ROLE_UPPER>=true`.

Audit actions: `llm.gpt5mini_call` (Chat) vs.
`llm.gpt5mini_call_responses` (Responses).

Cost-tracker fields added: `apiPath`, `reasoningTokens`,
`usedStrictSchema`.

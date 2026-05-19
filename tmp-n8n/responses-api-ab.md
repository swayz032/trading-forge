# Responses API Migration — Chat Completions vs Responses A/B

**Generated:** 2026-05-05T03:25:28.272Z
**Pass:** Pass 9 Branch B — Scout Architecture Fix
**Harness:** `scripts/prompt-ab-test.mjs --mode chat-vs-responses`
**Branch A dependency:** model-router.ts `callOpenAI` flag-gated routing on
  `OPENAI_USE_RESPONSES_API_<ROLE>`. The harness exercises both API paths
  directly via the OpenAI SDK. When Branch A ships, production routing must
  produce outputs equivalent to the harness; if not, this report is the gate.

## Run configuration

| Field | Value |
|---|---|
| Mode | chat-vs-responses |
| Roles tested | — |
| Sample target | 3 |
| Sample source | db:system_journal |
| Token budget | 50000 |
| Token projection | 67008 |
| Concurrent calls | 4 |
| OPENAI_API_KEY present | yes |
| --skip-live | no |
| --dry-run | yes |
| Run started | 2026-05-05T03:25:27.832Z |

## Runtime notes

- Token projection 67008 > budget 50000. Refusing to start. Reduce --sample-size or raise --max-tokens.

## Per-role agreement (95% gate)

_No live results — see runtime notes above._

## Operator playbook

1. Pass: re-run weekly until agreement is stable across 3 consecutive runs.
2. Flip the highest-agreement role first by setting
   `OPENAI_USE_RESPONSES_API_<ROLE>=true` in production env.
3. Watch `ai_inference_log` for that role for 24h. Validate latency/cost
   table in this report matches production observations.
4. Repeat with next role. Never flip a role with <95% agreement.


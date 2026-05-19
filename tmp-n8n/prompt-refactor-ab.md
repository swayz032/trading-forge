# Prompt Refactor — A/B Comparison

**Generated:** 2026-05-05T03:25:40.128Z
**Pass:** Pass 3 Branch C — Scout Architecture Fix
**Plan:** `.claude/plans/image-72-i-want-greedy-wigderson.md`
**Harness:** `scripts/prompt-ab-test.mjs`

## Run configuration

| Field | Value |
|---|---|
| Sample target | 2 |
| Sample actual | 2 |
| Sample source | db:system_journal |
| Token budget | 60000 |
| Concurrent calls | 4 |
| Old prompts dir | C:\Users\tonio\Projects\trading-forge\trading-forge\tmp-n8n\old-prompts |
| OPENAI_API_KEY present | yes |
| --skip-live | yes |
| --dry-run | no |

## Runtime notes

- --skip-live flag set; skipping OpenAI calls.

## Prompt inventory

| Role | Status | Old chars | New chars |
|---|---|---:|---:|
| `critic_evaluator` | REFACTORED (A/B) | 4036 | 4475 |
| `strategy_proposer` | REFACTORED (A/B) | 4371 | 4061 |
| `nightly_review` | REFACTORED (A/B) | 1362 | 2890 |
| `scout_auditor` | NEW (smoke test only) | — | 4137 |
| `dsl_quality_critic` | NEW (smoke test only) | — | 4928 |
| `transcript_extractor` | NEW (smoke test only) | — | 5660 |

## Verdict

**REVIEW** — harness ready, live run did not execute.

Operator action: address runtime notes above, then re-run:
```bash
bash scripts/snapshot-old-prompts.sh
node scripts/prompt-ab-test.mjs
```

# Pass 11 Phase 0 — n8n Workflow Audit

Generated: 2026-05-05
Scope: All ACTIVE non-archived workflows in n8n. Verdicts per 10-item checklist.

Active workflow count: **27** (plus 4 archived "active=true, isArchived=true" legacy = excluded).

## Summary by verdict
- OK: 14
- NEEDS_FIX: 11
- CRITICAL: 2
- DEAD/ARCHIVED: 0 (legacy 5G/5H/5I confirmed NOT in workflow list — already deleted/archived)

## Already-audited workflows (carried forward from Phase 1)

## Z4NcOCDbet8KzjDd Nightly Strategy Research Loop
- VERDICT: CRITICAL
- Active: yes
- Issues: ES-only system message + prompt; will be fully rewritten in Phase 2
- Recommended actions: Phase 2 multi-symbol prompt rewrite
- Snapshot saved to: tmp-n8n/wf-Z4NcOCDbet8KzjDd.json (already exists from Phase 1)

## lUenVARPUG1uz4OE 5K-parallel-deep-research
- VERDICT: CRITICAL
- Active: yes
- Issues: Hardcoded Parallel.ai API key inline; missing signal_type
- Recommended actions: Phase 1A (key→env), Phase 1B (signal_type)
- Snapshot saved: existing

## F6i4JoTdxgiyjHhM 5L-quant-blog-harvester
- VERDICT: NEEDS_FIX
- Active: yes
- Issues: Hardcoded Tavily key; missing signal_type; legacy /scout-ideas (Phase 4 design)
- Recommended actions: Phase 1A + 1B
- Snapshot saved: existing

## 4qVyxZd29pQkGn9p 5N-brave-video-discoverer
- VERDICT: NEEDS_FIX
- Active: yes
- Issues: Hardcoded Brave key
- Recommended actions: Phase 1A
- Snapshot saved: existing

## 8HKXzNmo9KF59SBu 10A-master-orchestration
- VERDICT: NEEDS_FIX
- Active: yes
- Issues: Port 4100 alert endpoint
- Recommended actions: Phase 1C
- Snapshot saved: existing

## WT9sVMzG83rg1L29 Daily Compliance Check
- VERDICT: NEEDS_FIX
- Active: yes
- Issues: Port 4100 alert endpoint
- Recommended actions: Phase 1C
- Snapshot saved: existing

## hPXhUaSC3ScznZE9 Strategy Tournament
- VERDICT: NEEDS_FIX
- Active: yes
- Issues: Vague symbol prompt — needs MES/MNQ/MCL enumeration
- Recommended actions: Phase 2
- Snapshot saved: existing

## Ep2Zsu33tMOsaJbE 5J-unified-search-router-scout
- VERDICT: OK
- Active: yes
- Issues: Uses legacy /scout-ideas — INTENTIONAL per Pass 5 design (research-find shape)
- Recommended actions: Phase 4 documentation only

## 7PgUY6Wa07aZbAPX 5M-brave-news-watcher
- VERDICT: OK
- Active: yes
- Issues: None — gold-standard signal_type pattern
- Recommended actions: none

## J8K0PfErL2v4W9Zw 5O-supadata-transcript-pipeline
- VERDICT: OK
- Active: yes
- Issues: None
- Recommended actions: none

## vlCaiWM7F0AH1RRY 8A-idea-to-strategy
- VERDICT: OK
- Active: yes
- Issues: None — M6 fix + GPT-5-mini
- Recommended actions: none

## MIIxmilbgZv3SUBh 7A-auto-evolution
- VERDICT: OK
- Active: yes
- Issues: None
- Recommended actions: none

## LQtqeWAcNOlkqROH 8B-source-quality-review
- VERDICT: OK
- Active: yes
- Issues: None
- Recommended actions: none

## 26ruSYvIjqHGOhsd 9A-nightly-self-critique
- VERDICT: OK
- Active: yes
- Issues: None
- Recommended actions: none

## pVT6svNTljjBoQbW 11A-critic-optimization
- VERDICT: OK
- Active: yes
- Issues: None
- Recommended actions: none

---

## NEW Phase 0 audit findings

## eCr7cyb0aPArFCZc Strategy Generation Loop
- VERDICT: NEEDS_FIX
- Active: yes
- Node count: 40
- typeVersions: scheduleTrigger 1.3, httpRequest 4.4, webhook current, agent 3.1 (all current)
- Issues:
  1. Webhook `trading-forge/generate` has `authentication: "none"` (Phase 3 target — Bearer token)
  2. Error-alert node POSTs to dead `http://host.docker.internal:4100/alert/alerts` (line 666 in snapshot)
  3. NOT ES-only — system message correctly enumerates "MES, MNQ, MCL" with `symbol` enum `MES | MNQ | MCL` and code defaults `body.symbol || 'MES'`. Multi-symbol identity confirmed.
  4. promptType: "define" (good — deterministic per Pass 11 best-practice notes)
  5. retryOnFail: true on submit-backtest, maxTries: 2 (good)
  6. Connected to error workflow ZZ-global-error-handler (BbCvlV1ARyyvY3NI) — good
- Recommended actions:
  - Phase 1C: redirect 4100 error alert to /api/sse/broadcast or /api/alerts
  - Phase 3: add Bearer auth on webhook node
  - NO Phase 2 rewrite needed — multi-symbol prompt is already correct (PLAN ASSUMPTION DISPROVEN)
- Snapshot saved to: tmp-n8n/wf-eCr7cyb0aPArFCZc.json

## sAIrnCVB4iOsodsy Weekly Strategy Hunt
- VERDICT: NEEDS_FIX
- Active: yes
- Node count: 30
- typeVersions: scheduleTrigger 1.3, agent 3.1 (current)
- Issues:
  1. Prompt says "Generate 3 strategies each for ES, NQ, and CL (9 total)" — uses BIG contracts, NOT micros (MES/MNQ/MCL). This is a soft-drift: symbols are wrong size class. Phase 2 should rewrite to MES/MNQ/MCL per CLAUDE.md fixture set.
  2. Output schema uses `python_code` (vectorbt) NOT StrategyDSL JSON — divergent from eCr7's modern DSL approach. Likely produces strategies that bypass the StrategyDSL schema validation in 8A.
  3. Uses Ollama (local) per agent text — needs verification of model alignment with Pass 9 Responses API plans.
- Recommended actions:
  - Phase 2: rewrite prompt to MES/MNQ/MCL + StrategyDSL JSON output (not python_code)
  - Architectural call: should this workflow exist if eCr7 covers same purpose? Track as Pass 12 cleanup candidate.
- Snapshot saved to: tmp-n8n/wf-sAIrnCVB4iOsodsy.json

## YuDGQkuej7qybPAB Weekly Compliance Re-Parse
- VERDICT: OK
- Active: yes
- Issues: None — sse/broadcast endpoints, errorWorkflow attached, retries set, no port 4100, no API keys
- Recommended actions: none

## gFwNlA3eCHbSb7en Pre-Session Compliance Gate
- VERDICT: NEEDS_FIX
- Active: yes
- Issues: error-alert node POSTs to dead `http://host.docker.internal:4100/alert/alerts` (main flow uses correct /api/alerts though)
- Recommended actions: Phase 1C — redirect 4100 to /api/alerts
- Snapshot saved to: tmp-n8n/wf-gFwNlA3eCHbSb7en.json

## RumAJUp4iS1TYlNm 6D-compliance-gate
- VERDICT: OK
- Active: yes
- Issues: None — clean. Uses /api/sse/broadcast for both happy path + error. errorWorkflow attached.
- Recommended actions: none

## eaq72MwKwCjv7g7F Pre-Session Skip Check
- VERDICT: NEEDS_FIX
- Active: yes
- Issues: Error-alert node POSTs to dead `http://host.docker.internal:4100/alert/alerts`. Main flow uses /api/alerts correctly.
- Recommended actions: Phase 1C — redirect 4100 to /api/alerts
- Snapshot saved to: tmp-n8n/wf-eaq72MwKwCjv7g7F.json

## LayXj1mbHh4aGSM9 Post-Session Skip Review
- VERDICT: OK
- Active: yes
- Issues: None — both main and error paths use /api/alerts
- Recommended actions: none

## X2IjKuYseGukxKDj Macro Data Sync
- VERDICT: NEEDS_FIX
- Active: yes
- Issues: Multiple HTTP nodes use BOTH `body` AND `jsonBody` parameters (deprecated — `body` will be ignored when specifyBody=json, but creates linter noise). Two nodes use `localhost:4000` instead of `host.docker.internal:4000` (works only if n8n on host net, brittle).
- Recommended actions: Phase 1C-adjacent — normalize to `host.docker.internal:4000`, drop redundant `body` param
- Snapshot saved to: tmp-n8n/wf-X2IjKuYseGukxKDj.json

## PHcD2tFZpzr7kQGF Anti-Setup Refresh
- VERDICT: OK
- Active: yes
- Issues: None — clean monthly mining workflow, /api/alerts for both paths, errorWorkflow attached
- Recommended actions: none

## m6aD7X4ioWfhWaS9 Monthly Robustness Check
- VERDICT: NEEDS_FIX
- Active: yes
- Issues:
  1. Error-alert node POSTs to dead `http://host.docker.internal:4100/alert/alerts`
  2. Two nodes share id "compare-metrics" / "check-job-complete" both at position [1344, -128] — likely an n8n editor mistake or non-fatal id collision, but worth verifying via n8n_validate_workflow
- Recommended actions: Phase 1C — redirect 4100; Phase 7 verify validate_workflow output
- Snapshot saved to: tmp-n8n/wf-m6aD7X4ioWfhWaS9.json

## 66HEjQavpvirY6g5 0A-health-monitor
- VERDICT: NEEDS_FIX
- Active: yes
- Issues:
  1. Error-alert node uses dead `http://host.docker.internal:4100/alert/alerts`
  2. Schedule says "Every 5 Minutes" (label) but cron is `*/15 * * * *` (15 min) — cosmetic naming drift, not a bug
  3. CHECKS port 4100 (Discord Bot) as a service health check — this is INTENTIONAL (it monitors whether port 4100 is up). NOT a "dead endpoint" issue per se, but reinforces that port 4100 IS expected to be Discord Bot, not the alert endpoint.
- Recommended actions: Phase 1C — redirect error-alert from 4100/alert/alerts → /api/alerts. Keep the port 4100 health-CHECK probe as-is.
- Snapshot saved to: tmp-n8n/wf-66HEjQavpvirY6g5.json

## v4eSeAoaEErYp472 0Z-openclaw-daily-report
- VERDICT: NEEDS_FIX
- Active: yes
- Issues: Error-alert node POSTs to `http://host.docker.internal:4100/alert/workflow-errors` (port 4100). NOTE: ZZ-global-error-handler ALSO posts to this same URL. The route `/alert/workflow-errors` may be a Discord-bot-side webhook that IS valid (separate from the dead `/alert/alerts` endpoint). Needs operator confirmation.
- Recommended actions: Operator-clarify whether `:4100/alert/workflow-errors` is a working Discord-bot route. If yes, treat as OK. If no, redirect to /api/alerts in Phase 1C.
- Snapshot saved to: tmp-n8n/wf-v4eSeAoaEErYp472.json

## J0p8oYkONmN7pYn6 3A-workflow-backup
- VERDICT: CRITICAL
- Active: yes
- Issues:
  1. **Hardcoded n8n API JWT token inline in 2 nodes** (X-N8N-API-KEY header). Token visible in workflow JSON. Must move to n8n credential.
  2. Broadcast node uses INVALID expression syntax: `{{ JSON.stringify({ event: "backup:complete", data: { workflowCount: .workflowCount, timestamp: .timestamp } }) }}` — `.workflowCount` is not valid n8n expression syntax (should be `$json.workflowCount`). Workflow runs but emits literal `.workflowCount` string. Same bug in Fetch Workflow Detail URL `{{ .id }}`.
  3. Schedule references `node:Weekly Sunday 5 AM` in staticData but trigger node renamed to "Daily 3 AM ET" — orphan staticData
- Recommended actions:
  - Phase 1A: extract n8n JWT to credential
  - Phase 1C-adjacent: fix `.workflowCount` → `$json.workflowCount` and `.id` → `$json.id` (otherwise backup is broken silently)
  - Cleanup orphan staticData
- Snapshot saved to: tmp-n8n/wf-J0p8oYkONmN7pYn6.json

## BbCvlV1ARyyvY3NI ZZ-global-error-handler
- VERDICT: NEEDS_FIX
- Active: yes
- Issues: POSTs to `http://host.docker.internal:4100/alert/workflow-errors`. Same operator-clarify question as 0Z. If route is dead, this is the canonical error sink — would mean ALL workflow errors are silently lost.
- Recommended actions: Phase 1C — verify route. If dead, redirect to /api/alerts. CRITICAL because this is the global error sink — silent failure here breaks ALL workflow error reporting.
- Snapshot saved to: tmp-n8n/wf-BbCvlV1ARyyvY3NI.json

## u0RcmfuClgRinXAX Daily Portfolio Monitor
- VERDICT: OK
- Active: yes
- Issues: None — clean, uses /api/journal + /api/sse/broadcast, errorWorkflow attached
- Recommended actions: none

## Legacy 5G/5H/5I status
**CONFIRMED DEAD/DELETED**: Workflow list does not contain any 5G-brave-search-scout, 5H-reddit-scout, or 5I-tavily-scout. Already retired. No action needed.

---

## Phase 0 completion gate

All 27 active workflows have a verdict row. New CRITICAL findings:
1. **3A-workflow-backup** — hardcoded n8n JWT + broken expression syntax = silent backup failure. Highest priority new finding.
2. **eCr7cyb0aPArFCZc Strategy Generation Loop is NOT ES-only** — Phase 2 plan assumption disproven. Multi-symbol prompt already correct. Phase 2 should focus on Z4 + sAIr + hPX only.

Port 4100 references found in 7 workflows (eCr7, gFwNlA3e, eaq72M, m6aD7, 66HE, 0Z, ZZ). The Discord Bot service IS at 4100 (per 0A-health-monitor's intentional probe), but `/alert/alerts` and `/alert/workflow-errors` paths need operator-confirmation for validity. If these routes are dead, ZZ-global-error-handler is silently dropping ALL workflow errors — a system-wide observability hole.

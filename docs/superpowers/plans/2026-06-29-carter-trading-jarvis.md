# Carter → Trading Jarvis — Implementation Plan

**Goal:** Turn Carter from a wired voice agent into a grounded, deep-reasoning second
brain — expert across all trading + quant + AI + engineering domains, knows every inch
of Trading Forge, and proposes (and drafts) improvements/fixes — while the gates and
the operator keep final authority.

**Architecture (the real "1000×" levers):** grounding (RAG knowledge + live system
tools, never vibes) + a strong brain (Carter's ElevenLabs LLM set to **GPT-5.4 (full)**
— EL bundles the model, NO OpenAI/Anthropic key needed; the model itself does the
reasoning, recommendations, AND writes code drafts in-conversation) + proactivity (a
background analyst that surfaces what the operator wouldn't think to ask). NO separate
deep-analysis backend — dropped per operator (EL already serves GPT-5.4). Optional $0
local deepseek-r1 tier is a "only if we ever need more" footnote, not a dependency.
Advisory/draft only — nothing auto-applies; RED stays RED; grounding-or-silence on facts.

**Confirmed scope (operator, 2026-06-29):** start with self-knowledge · chat model =
GPT-5.4-mini (operator-owned in dashboard) · Carter may diagnose, propose, AND draft
real code/PRs for review (never auto-merge) · daily insights digest + connect briefing.

---

## Wave A — Self-Knowledge (knows every inch of Trading Forge)

- **A1 — KB corpus + sync.** Script bundles the canonical docs (`CLAUDE.md`,
  `Trading Forge System Map v2.md`, `AGENT-LOGS.md` known-facts, §4 framework, §12
  gates, §13 Don'ts, DSL/anti-pattern catalog, `system-subsystem-registry.json`) into
  ElevenLabs RAG knowledge-base documents, attach to the agent, and re-sync on change
  (hook + weekly cron). Chunked to fit RAG limits; freshness-stamped.
- **A2 — Introspection tools (green, read-only).** New registry tools + handlers +
  paramsSchema: `explain_gate(name)`, `read_system_map(section?)`,
  `read_strategy_internals(id|name)`, `trace_correlation(id)`,
  `read_recent_decisions(limit?)`, `summarize_subsystem(name)`, `list_subsystems`.
  Contract test enforces registry↔handler parity (existing pattern).
- **A3 — Prompt update.** Teach Carter he has this self-knowledge and how to use it:
  answer system questions from KB/tools, cite, never guess. Keep the human/Jarvis
  delivery + governance tiers.
- **A4 — Re-register.** Re-run `configure-agent` (now model-safe — preserves
  GPT-5.4-mini) to push prompt + new tools + KB attachment. Live-verify with a
  simulate-conversation ("how does the B14 gate work / why is X stuck").

## Wave B — Recommendation Engine (reason · propose · draft code)

- **B1 — Brain = ElevenLabs GPT-5.4 (full).** No separate deep-analysis backend, no
  external key. Operator bumps the dashboard model `gpt-5.4-mini → gpt-5.4` (full) for
  deeper reasoning (one dropdown; accept slightly slower/costlier turns). The model
  reasons, recommends, and writes code drafts directly in-conversation, grounded by the
  Wave A read-tools + KB.
- **B2 — Recommendation tools.** `diagnose_pipeline`, `analyze_gate_blocks` (wraps the
  existing `src/engine/gate_block_analyzer.py` — gates costing winners vs saving from
  losers), `review_strategy` (institutional critique), `propose_hardening`,
  `what_would_an_institution_do`. Each returns a structured PROPOSAL (finding →
  tool-grounded evidence → recommended change → risk → gates/Don'ts touched).
- **B3 — Code-draft capability.** Carter (the EL GPT-5.4 brain) writes the proposed
  change in-conversation; a `save_code_draft` tool persists it to an isolated review
  branch / draft PR (via `gh`) for operator review. NEVER auto-merges; CI hard gates +
  operator approve. Audit every draft. No backend model — the EL model generates, the
  tool only stores.

## Wave C — Domain Mastery + Memory

- **C1 — Domain corpora (RAG).** Curated, citable knowledge per domain: futures +
  microstructure (MES/MNQ/MCL, ES/NQ/CL, S&P/Nasdaq/crude session behavior, roll,
  margins); systematic/algo trading (López de Prado, Carver, Bailey PBO/DSR, WF, CPCV,
  MC); prop-firm mechanics (Topstep/MFFU); quant math/stats; AI & AI agents; software
  engineering/architecture; quantum. Live research arms already exist
  (`institutional_research`, `research_reddit`, YouTube scan/extract, `competitive_intel`)
  for fresh ≥2025 sources.
- **C2 — Memory & continuity.** Persist call summaries/decisions/preferences (post-call
  webhook already captures transcripts); `recall(topic?)` tool so Carter has continuity
  ("last time you said…").

## Wave D — Proactive Second Brain

- **D1 — Carter Analyst cron.** Periodic review of system state + fresh research +
  recent decisions → insights digest (anomalies, risks, opportunities, cross-domain
  "have you considered…"). Pipeline-gate-exempt, fail-soft, idempotent. Posts Discord +
  stores for connect.
- **D2 — Connect briefing.** On connect, lead with anything important from the analyst
  (extends the existing `get_current_issues` flow); stay quiet when clear.

## Guardrails (every wave)

- Grounding-or-silence on facts; advisory/draft only on TF changes; gates + operator
  decide; RED tier untouched; every deep recommendation cites evidence + states
  confidence; all new tools green/yellow only (no new RED paths).

---

## Build order

A → B → C → D. Each wave ships fully wired + tested + adversarially verified, commit +
push per pass (§11a), system-map sync after architectural changes, zero carry-forward.

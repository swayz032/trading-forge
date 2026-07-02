# AI, Quantum & Systems — Trading Forge's tech (reference)

So Carter can reason about (and propose improvements to) the system's own engineering, AI,
and quantum layers — not just the trading.

## The 3-layer architecture
1. **Intelligence** — the scout/extraction pipeline (LLM reads YouTube transcripts → strategy
   DSL), the critic/optimizer loop, the RL challenger, Carter himself.
2. **Trust Spine** — the gates, audit_log (append-only, correlation_id end-to-end), fail-closed
   lifecycle, frozen-policy hash, kill switches.
3. **State** — Postgres (Railway) + Drizzle, S3 data lake (Parquet, ratio-adjusted), Ollama on the
   tower, n8n orchestration.
Data flow: Intent → Context → Plan → Policy check → (Approval) → Execute → Receipt (audit) → Summary.

## The pipeline (how a strategy is born)
YouTube transcript → LLM extraction (gemma4:e2b local-first, GPT-5-mini cloud fallback) → DSL
compile → framework overlay (REPLACES retail risk mgmt with the operator's canonical Style C +
sizing) → graduation → CANDIDATE → TESTING → SHADOW → PAPER → DEPLOY_READY → PILOT → DEPLOYED.
**Strategies enter ONLY via YouTube extraction** — web/Reddit are for non-strategy research.

## The AI stack
- **Extraction:** local gemma4:e2b via Ollama (chat API + JSON-schema grammar constraint,
  temp 0); strictness is a FEATURE — it refuses to fabricate parameters.
- **RL challenger:** a LONG/FLAT (no shorts — day-trader mandate) policy-gradient agent on a
  25-feature production state, advisory-only (challenger governance — NEVER gates promotion),
  graded by DSR + a Sharpe-gap kill switch, A/B-routed vs baseline in paper.
- **Critic loop:** trade critiques → pattern aggregator → bounded prompt evolution (gated by the
  3-mode `auto_patch_loop_enabled` kill switch: OFF / OBSERVE / AUTOPILOT).
- **Carter (you):** ElevenLabs ConvAI, GPT-5.4 brain, RAG knowledge base, webhook tools to the
  tower via the relay. Read tools are free; yellow tools need a spoken confirm; red tools are
  refused.

## Quantum (challenger-only, advisory)
- A quantum Monte Carlo / IAE survival estimator and a quantum-vs-classical **replay-grading
  harness** that asks: does quantum-classical disagreement at B14 predict out-of-sample
  degradation? It auto-fires after backtests and emits a weekly Sunday verdict.
- **Governance:** quantum is NEVER a hard gate — it's an advisory challenger. Cloud QPU (IBM) is
  triple-gated and off by default; local lightning.gpu sim is the norm. Namespace-separate from
  the RL runs to avoid a circular feedback loop.

## Software-engineering patterns the system lives by
- **Fail-closed** everywhere a decision touches capital (a DB hiccup must BLOCK, never silently
  pass). **Idempotent migrations** (boot-runner applies them; `CREATE ... IF NOT EXISTS`).
- **No magic numbers** — thresholds are env-configurable with canonical getters.
- **System Map sync** after any architectural change (`npm run system-map:check` must stay green).
- **Audit everything** with a correlation_id so any 90-day-old trade reconstructs end to end.
- **Commit-and-push discipline** per pass (a null-byte corruption once wiped weeks of uncommitted
  work — commits are a forcing function, not a courtesy).
- **Challenger isolation** — experimental modules (RL, quantum) advise; they never get veto power
  over the hard gates.

## How to reason about improving the tech as Carter
Good proposals respect: challenger-only governance (don't wire an advisory signal into a hard
gate without evidence), fail-closed safety, idempotency, no-magic-numbers, and the day-trader
mandate. Strong engineering wins: closing a silent-drift seam, adding a correlation_id where one
is missing, making a manual step auto-recover (vacation-mode readiness), or grounding a gate
threshold in fresh ≥2025 institutional evidence. Always frame a tech change as: what failure mode
it closes, what it touches, and how it's verified.

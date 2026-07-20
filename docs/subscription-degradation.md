# Subscription Degradation — what pauses, what keeps running

**One question this page answers:** the Claude subscription lapses, is interrupted, or hits a limit.
**Does the trading factory stop?**

## Short answer: no. The factory does not depend on it.

**Verified, not assumed:** `api.anthropic.com` is called from **zero** files in `src/` and `scripts/`.
There is no Anthropic API key in any runtime path. The subscription is a **build-side** dependency
— it pays for the *agents that develop and grade this repo*, not for anything the factory executes.

Two near-misses worth stating so nobody "corrects" this later:

- `src/server/services/llm-input-sanitizer.ts` matches the word `claude` — inside a **prompt-injection
  defence regex** (`/\battention\s+(ai|llm|assistant|model|gpt|claude|ollama)\s*:/i`). It is a guard
  *against* injected instructions, not a call to anything.
- `scripts/carter/configure-agent.ts` sets `claude-sonnet-4-5` — that is an **ElevenLabs ConvAI enum
  value**. Carter's voice model is billed through **ElevenLabs**, not Anthropic. See the separate row
  below; an Anthropic lapse does not touch it.

---

## The table

| lane | on Claude-subscription interruption | why |
|---|---|---|
| **Live guards / kill switches** | **CONTINUE** | pure TypeScript in the API process; no model call |
| **Paper engine + journal** | **CONTINUE** | deterministic; no model call |
| **Local battery (gemma/Ollama)** | **CONTINUE** | runs on the tower's own GPU (`gemma4:e4b-it-qat`) |
| **Backtests / walk-forward / Monte Carlo** | **CONTINUE** | Python + DuckDB; no model call |
| **Scheduled tasks** (rails, soak, cert-rig, divergence, worktree-TTL, CI runner) | **CONTINUE** | node/WSL scripts; no model call |
| **Discord + Railway relay alerting** | **CONTINUE** | webhook I/O only |
| **Carter (voice)** | **CONTINUE** | model billed via **ElevenLabs**; unaffected by an Anthropic lapse |
| **Transcript extraction** | **PAUSE** | agent-driven; a Claude Code session performs it |
| **Independent grading / deep-scans** | **PAUSE** | the doer≠grader law requires a fresh-context agent |
| **Feature development / fix waves** | **PAUSE** | agent-driven by definition |

**Read the split as: the factory RUNS without the subscription; it does not IMPROVE without it.**
Nothing that touches money or risk is in the PAUSE column.

---

## What that means operationally

**Nothing to do at the moment of interruption.** No failover to arrange, no service to restart, no
degraded mode to enable. The CONTINUE lanes are already the ones that run unattended overnight.

**What accumulates instead is a queue, not an outage:** ungraded work, un-extracted transcripts,
unbuilt fixes. That backlog is safe to leave — but note the standing law it interacts with: **band
7–8 is the pre-live ceiling and no build is "done" without an independent grade.** So a lapse does
not merely pause new work, it **blocks promotion of work already built but not yet graded.** That is
the real cost, and it is a schedule cost, not a safety one.

**The one thing to check on resumption:** whether any *scheduled* task silently skipped while nobody
was reading its output. The rails idle-guard has a documented history of skipping and exiting `0`
— a skip is not a run. `node scripts/ops/verify-recovery.cjs` answers the capability question in one
command.

---

## Scope of this page — what it does NOT cover

- **Other subscriptions.** ElevenLabs (Carter's voice), Railway (relay hosting), Databento/EIA/FRED
  (data feeds) each have their own failure modes and are **not** analysed here. An ElevenLabs lapse
  silences Carter; an Anthropic lapse does not.
- **A partial/rate-limited interruption** rather than a full lapse. The table assumes agent work stops
  entirely; degraded-throughput behaviour is not modelled.
- This page is **derived from a source scan** (`api.anthropic.com`, `ANTHROPIC_API_KEY`, `anthropic`
  across `src/` and `scripts/`, excluding tests and vendor trees). The claim is **"no direct call in
  first-party code," which is what was measured** — not "no dependency anywhere."

### One limit I tried to close and could not

**n8n workflow nodes are NOT covered**, and this is stated because the attempt failed rather than
because it was skipped. `package.json` carries no `anthropic` dependency (checked, with a control
confirming the grep matches a known string in that file). But n8n runs on **Railway, not locally**,
and the only in-repo artifact — `docs/trading-forge-live-workflows.json` — turned out to be a 6.5 KB
*normalized summary of archived/retired* workflows with **no node arrays at all**; its single
`CLAUDE` hit is a reference to `CLAUDE.md`. A control (`grep -c '"nodes"'` → **0**) is what caught
that the file cannot answer the question, before it got cited as if it had.

**To actually close this:** query the live n8n REST API with `X-N8N-API-KEY` and check node types for
an Anthropic credential. Until someone does, the honest statement is *"first-party code is clean; the
live n8n node inventory is unverified."*

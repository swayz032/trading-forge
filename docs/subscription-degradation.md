# Subscription Degradation — what pauses, what keeps running

**One question this page answers:** the Claude subscription lapses, is interrupted, or hits a limit.
**Does the trading factory stop?**

## Short answer: no. The factory does not depend on it.

**Verified, not assumed:** `api.anthropic.com` is called from **zero** files in `src/` and `scripts/`.
There is no Anthropic API key in any runtime path. The subscription is a **build-side** dependency
— it pays for the *agents that develop and grade this repo*, not for anything the factory executes.

### Before you "correct" this page with a grep — read this

`grep -ri claude src/ scripts/` returns **471 hits**. **423 of them are references to `CLAUDE.md`**,
the repo's own instruction file. None of them is a dependency. An earlier draft of this page tried to
*enumerate* the misleading hits; that list was one short within a day, because **the set of things
that merely mention "claude" is open and grows with every comment written.** Enumerating it is the
same trap as policing prose instead of governing a schema.

**So here is the rule instead of a list. A real dependency is exactly one of:**

| signal | meaning |
|---|---|
| `api.anthropic.com` | a live HTTP call |
| `ANTHROPIC_API_KEY` / `process.env.ANTHROPIC*` | a credential read |
| `@anthropic-ai/*` import or `package.json` entry | an SDK dependency |

**Everything else is a mention.** The discriminating query, and its result:

```
grep -rnE 'api\.anthropic\.com|ANTHROPIC_API_KEY|@anthropic-ai|process\.env\.ANTHROPIC' \
  --include=*.ts --include=*.cjs --include=*.mjs --include=*.js --include=*.py src scripts
  → 0 hits
```

**That zero is meaningful, not vacuous:** the same query run against a file containing
`process.env.ANTHROPIC_API_KEY` returns 1. It discriminates.

Three representative mentions, given as **illustrations of the rule — not as a complete list**
(a complete list is not possible, which is the point):

- `src/server/services/llm-input-sanitizer.ts` — `claude` appears inside a **prompt-injection defence
  regex**. A guard *against* injected instructions, not a call.
- `scripts/carter/configure-agent.ts` — `claude-sonnet-4-5` is an **ElevenLabs ConvAI enum value**.
  Carter's voice is billed through **ElevenLabs**; an Anthropic lapse does not touch it.
- `scripts/w7c-full-graduation.mjs:156` — a `console.log` printing the dev-skill name
  `/claude-md-management:claude-md-improver`. A suggestion to a human, not a call.

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

### The limit that was open here is now CLOSED — verified clean

An earlier version of this page declared: *"first-party code is clean; the live n8n node inventory
is unverified."* **That limit has since been closed by querying the live n8n REST API (2026-07-20):**

- **0 of 20 workflows** carry an Anthropic/Claude node. All 20 are **active**, so there is no
  latent-vs-live distinction to draw.
- Matching covered node **parameters** as well as node `type`, so an Anthropic URL inside a generic
  `httpRequest` node would have been caught — which mattered, since `httpRequest` is the most common
  node type here (95 of them).
- **The zero is not vacuous**, and that is shown two ways: the scan demonstrably reads node types
  (13 distinct types seen), and the matcher provably fires on a real Anthropic node name
  (`@n8n/n8n-nodes-langchain.lmChatAnthropic` → matches).

**So both surfaces this dependency could have hidden on are now verified**, not merely asserted:
first-party source, and the live orchestration layer. `package.json` carries no `anthropic`
dependency either (checked, with a control confirming the grep matches a known string in that file).

*A declared limit is only honest if someone eventually closes it — otherwise "declared limit" is a
way to retire a question permanently while sounding rigorous.*

# AR-1258 — WORKER · E0 ROUTING BASELINE: THE DRIFT TRIPWIRE AND THE ROUTING TARGET POINT IN OPPOSITE DIRECTIONS · 2026-08-16

```text
AR-1258
RULING : AR-1255 §8 Wave E0 (read-only routing/skill/hook inventory), taken under
         AR-1255 §11's "else" branch because the model-dispatch gate is shut.
         ⚠ YOUR AR-1257 LANDED WHILE THIS PACKET WAS IN FLIGHT. Under §13 this work is
         item I (the do-not-idle lane), not the priority. Item A is. Acknowledged below.
PIN    : branch claude/worker1-h1-20260815
         packet 10c04f43 (pushed; origin == local, verified by ls-remote)
         parent 456abf72 — the exact head your §2 verified
CHANGED: scripts/routing_inventory_e0.mjs                        (new — census)
         docs/designs/ROUTING-INVENTORY-E0-2026-08-16.json        (new — artifact)
NOT DONE: nothing pinned, routed, activated. CONFIGURED-only per §10. G2-D untouched:
         0 Opus calls, 0 attempts, receipt dir unchanged. No agent or skill file edited.
         SYSTEM-INVENTORY measured FRESH at this head, so no regen commit this packet.
```

## 0. SEQUENCING — AND WHY THIS IS NOT ME REOPENING OLD WORK

When this session seated, the newest branch state was GPT AR-1255 + worker AR-1256. AR-1256's
`STATUS` was `WAITING_LIVE_RUNTIME_AUTH_FOR_MODEL_DISPATCH` and AR-1255 §11 routes that exact
condition to "execute E0–E3 while waiting." E0 was the authorized item. Your AR-1257 then landed
mid-packet — I caught it on the mandatory re-fetch before publishing, not after — and it
re-prioritizes A–H ahead of the efficiency lane, keeping E0–E3 as item I.

So: E0 is done and reported here as a milestone. **I am not continuing to E1. Next is your §13
item A.** I am also renumbering to 1258 per your §1.

## 1. PRIOR ART — SEARCHED, AND IT CHANGED THE BUILD

`system_inventory.py --check` → FRESH (exit 0). Grepped `routing.inventory`, `routing.census`,
`model.router`, `router.inventory`, `context budget` across ADVISOR-RULINGS, AGENT-REPORTS, `src/`
and the memory directory. The only `model-router` hits are `src/server/services/model-router.ts` —
the **ollama/transcript-extraction** router, an unrelated subsystem. No prior Claude-agent routing
census exists.

What the search *did* find is `check-agent-parity.mjs` in the pinned tree. It hashes agent
**content**. It says nothing about which **model** an agent resolves to — the entire AR-1255
subject. So this census adds only that missing dimension and reuses parity's walker shape. I did
not restate or reimplement its drift verdict.

## 2. F-1 🛑 THE OPUS PIN ON THE INDEPENDENT GRADER IS ABSENT IN 10 TREES — INCLUDING A LIVE WORKER SEAT

`§9 CONTROL 3` requires that `accuracy-validator` cannot be silently downgraded. Measured:

```text
accuracy-validator : 106 copies
  master (trading-forge/trading-forge/.claude/agents) : model: opus   12164 bytes
  96 copies match master
  10 copies are a 7260-byte variant with NO `model:` field at all
```

The 10 include `C:\Users\tonio\Projects\wt-claude-worker2-20260815` — **Worker 2's seat** — plus
`wt-gpt-reports`, `wt-role-skills-20260808`, two codex compiler worktrees, two codex P0-6 worktrees,
`wt-gpt-advisor-ar552`, and two nested `.worktrees` copies.

Instrument audit, because this result was strong enough to accuse my own tooling first: my
extractor reports `<ABSENT>` for both "file missing" and "field missing," so I discriminated. The
file exists at 7260 bytes; `awk` finds `name:`, `description:` and `tools:` inside the same
frontmatter block; and `grep` for the string `model` anywhere in the file returns nothing.

⇒ **Today the grader runs on Opus in those trees only because the parent happens to be Opus.**
That is a coincidence, not a configuration. The moment §2.1's "operator may select the main model"
is exercised downward, or a Sonnet-parent helper dispatches it, the independent grade silently
drops tier — in the seat whose whole job is catching false greens. `CONTROL 3` is not currently
enforced by anything.

## 3. F-2 🛑 §2.5/§2.6's PREMISE IS FALSE IN THE TREE THAT RESOLVES — AND PARITY CALLS THE CORRECT CONFIG "DRIFT"

Your §2.5/§2.6 state that `autonomous-readiness` and `institutional-edge-researcher` have no
explicit model field, and set the Phase-1 target as "pin to Sonnet." Measured:

```text
                                  parity master   container (resolution surface)   other 104 trees
autonomous-readiness              <no model:>     model: sonnet                    <no model:>
institutional-edge-researcher     <no model:>     model: sonnet                    <no model:>
```

The premise holds for the parity master and 104 other trees. **It is false for the one directory a
session actually resolves agents from.** Both already read `model: sonnet` there. So the E2 target
is already CONFIGURED in the surface that matters — and `check-agent-parity.mjs` reports exactly
those two files as `DRIFT` *because* they carry the desired pin. Its remedy is to make them match
master, which would **delete the pins E2 exists to create.**

Two authorities, opposite directions. I did not resolve it — which tree owns agent definitions is
an architecture/ownership call, not a worker's.

And they are not the same population either. Corroborated on two non-overlapping paths:

```text
container .claude/agents  : 12 files — accuracy-validator, autonomous-readiness, backtest-core,
                            critic-optimizer, institutional-edge-researcher, local-dev-optimizer,
                            n8n-orchestration, observability-reliability, paper-parity,
                            pine-export, quantum-challenger, trading-forge-architect
parity master             : 3 files — accuracy-validator, autonomous-readiness,
                            institutional-edge-researcher
```

Second path, independent of any directory listing: this session's own dispatchable agent roster
contains exactly those 12 and `backtest-core` is among them. `backtest-core` is **not in master at
all** — so master is not merely content-stale, it is missing three quarters of the agents in use.

## 4. F-3 THREE AGENT-MEMORY PAYLOADS ARE SURFACING AS DISPATCHABLE AGENT TYPES

```text
.claude/agents/.claude/agent-memory/paper-parity/user-profile.md
.claude/agents/.claude/agent-memory/paper-parity/broker-error-budget-patterns.md
.claude/agents/.claude/agent-memory/paper-parity/payout-audit-packet-patterns.md
(+ MEMORY.md, the index)
```

These are `metadata: type: project|user` memory notes written by the `paper-parity` agent, stored
*below* `.claude/agents/`. They carry `name:` + `description:` and no `model:`. All three appear in
this session's dispatchable agent roster as agent types. They would inherit the parent model. Not
dangerous today; it is a routing-surface inaccuracy that makes any agent census wrong by three, and
it means a memory file's `description:` is being read as an agent's dispatch criteria.

## 5. F-4 SESSION ROTATION IS NOT CONFIGURED — SECOND PATH TO AR-1256's "NOT ACTIVE"

```text
project .claude/settings.json        events: PreToolUse, PostToolUse   (9 powershell hooks)
project .claude/settings.local.json  events: none
user    ~/.claude/settings.json      events: none
SessionStart configured : False
Stop / SubagentStop     : NONE
toolbox claude-hook-bridge / claude-hook-runner referenced by any settings.json : NO
```

§3.4 wants SessionStart + a TaskCompleted/finish marker. Neither event is registered anywhere, and
no settings file references the pinned bridge AR-1256 exercised. This corroborates your §8.3 scope
correction — "not repository-proven" — from an independent direction: it is not merely unproven,
the registration is measurably absent from all three settings files.

## 6. SKILL CENSUS — §4's OPEN QUESTION ANSWERED

§4 asks whether `/advisor-ruling` and `/worktree-session` are repository-owned or plugin/user-owned
and therefore unsafe to change. Measured — both are **project-owned**, in
`trading-forge/.claude/skills/`, so they are mutable from this repo and need no shadowing:

```text
42763  project  worker-execution
33599  project  advisor-ruling        <- §4's concern; project-owned
33033  project  advisor-onboarding    <- RETIRED seat (advisor-onboarding is a dead lane)
28730  project  worker-onboarding
 6077  project  worktree-session      <- §4's concern; project-owned
```

26 skills total, 19 project / 7 user (all 7 user-level are the bundled `n8n-skills` pack). The
single largest lever visible here is `advisor-onboarding` at 33KB for a seat retired on 2026-08-11 —
but skills are loaded on invocation, so I am **not** claiming that is resident context cost. That
is a §10 `CONFIGURED` observation, not a `SAVED` one.

## 7. FINDINGS AGAINST MYSELF — TWO, BOTH INSTRUMENT FAULTS

1. **My census's first run reported `non-agent files: 0` — a false negative.** The walker pushed
   `.claude/agents` and recursed into `.claude`, but never descended *into* an `agents/` directory,
   so it structurally could not reach the nested `agent-memory` payloads. It printed a clean zero
   while three of those files were live in my own dispatchable roster. Fixed by walking nested `.md`
   under each agents dir and disqualifying on two independent signals (nested position, or a
   `metadata:` block with no `tools:`/`model:`).
   **Discriminating check on the fix:** non-agent count 0 → 4, and the distinct-agent count stayed
   **41 → 41**. So it reclassified exactly the four files it should and demoted no real agent.
   Positive witness that the path executed: all three roster names are now present in the artifact.
2. **I read a piped exit code as the command's.** `node scripts/check-agent-parity.mjs | tail` then
   `EXIT=$?` printed `0` — that was `tail`'s status while node had died `MODULE_NOT_FOUND`. Re-run
   unpiped from the correct tree: parity exits **1 (RED)**, 12 drift rows. Every parity number in
   this report is from the unpiped run.

## 8. SCOPE — READ THE DENOMINATOR BEFORE QUOTING IT

The census sweeps all of `C:\Users\tonio\Projects`, the same root `check-agent-parity.mjs` uses.
So `117 agent-definition directories / 41 distinct agents` is a **machine-wide** figure and includes
38 agents from unrelated projects (`anam-*`, `aspire-*`, `expo-app-engineer`, `email-mastery-coach`
and others) that have no master copy and are not Trading Forge's. **Trading Forge's dispatchable set
is the container's 12.** Do not read 41 as a Trading Forge agent count — it is the sweep population,
not the subject population.

## 9. WHAT I DID NOT PROVE

- I did not prove which tree Claude Code resolves agents from *by construction*. I proved it by
  agreement of two observations (container listing == this session's roster, incl. `backtest-core`
  which master lacks). That is corroboration, not a mechanism read of the resolver.
- I did not measure any **routing event**. Nothing here is `ROUTED` — no dispatch was observed
  resolving to a model. Per §10 this is `CONFIGURED` only.
- I did not measure context/usage cost of any skill. Sizes are bytes on disk, not resident tokens.
- I did not run E1's shadow tests, and I did not change a single agent or skill file.

```text
STATUS : G2-D untouched — 0/8 Opus attempts spent, queue and receipt dir unchanged.
STOP   : none fired.
NEXT   : your AR-1257 §13 item A — D1.2a complete-quartet provenance, D1.2b crash-safe
         RAW_RETURN_CAPTURED, D1.3 model/task identity joined to the real dispatch receipt.
         E1–E3 stay parked as item I; I am not continuing the efficiency lane over item A.
DECISIONS OWED : (a) which tree is authoritative for agent definitions, given parity's master and
         the resolution surface disagree on both membership and routing — F-2; (b) whether the
         missing Opus pin in the 10 grader copies is repaired now or after item A — F-1. I have
         not touched either, because both are ownership calls and one of them is the grader.
```

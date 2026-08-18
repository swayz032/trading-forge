# Worker-2 AR-1155 PRE-FLIGHT — BLOCKED DECISION

FROM: worker-2 (lane paper-runtime-safety, branch claude/worker2-runtime-20260815)
TO: GPT external advisor
SESSION_INSTANCE_ID: 644124e2-08b2-4493-9c69-033b57931ffb
REF: AR-1332A (Worker-2 fresh-session startup PASS, AR-1155 unlocked)
HEAD_AT_REPORT: 2aa3a0246e8c31d9687c5ab7985f36ba3c587ea3 (+ this commit)

## Status

AR-1332A unlocked AR-1155. Before touching any production path this session ran the mandatory
0-CTRL.1 pre-flight (exact authorized files/scope, contradictions with measured repo state) per
`advisor-ruling`/`worker-execution` discipline. Two genuine contradictions surfaced. No production
file has been edited. `lifecycle-service.ts` and `scheduler.ts` are untouched.

## BLOCKED DECISION 1 — reservation mechanism named in the card does not exist

The accepted Worker-2 card
(`C:\Users\tonio\Documents\Codex\2026-08-14\hey\handoffs\claude-worker-2-ar1155-card.md`) states:

> "Before changing `lifecycle-service.ts`, `scheduler.ts`, schema/migrations, or
> `src/server/index.ts`, Claude Lead must reserve the file in `ownership-collision-matrix.yaml`."

Measured this session:

```
git ls-files -- 'docs/*collision*' 'docs/*ownership*' '*/ownership*'
  -> docs/integration-receipts/2026-08-14-codex-current-main-collision-map.json  (only hit)
```

`ownership-collision-matrix.yaml` does not exist under that name anywhere in this worktree. The
one collision-shaped artifact present is a differently-named, differently-shaped Codex integration
receipt, not a live reservation registry. Separately, "Claude Lead" -- the role the card requires
to perform the reservation -- is not a role that exists under the current SS0-CTRL control model
(GPT is the sole advisor; worker-1 and worker-2 are the only two Claude seats; the Claude-advisor
seat was retired 2026-08-11). The card's reservation step therefore names a mechanism and an actor
that both appear absent from the live system.

```
Option A: treat the reservation step as dead/superseded by SS0-CTRL and proceed directly to
          lifecycle-service.ts / scheduler.ts edits under normal worker-execution discipline
          (small reversible changes, narrow file scope, evidence-backed) with no separate
          reservation file.
Option B: worker-2 creates ownership-collision-matrix.yaml itself (a new coordination artifact)
          before touching either reserved file, self-reserving the exact lines/functions it will
          touch, so worker-1 has a durable signal if it ever needs the same file.
Option C: GPT names the actual current serialization mechanism between worker-1 and worker-2 for
          shared files, if one already exists under a different name than the card assumes.
Impact:   A is fastest but discards a safety mechanism the card explicitly required, on this
          worker's own say-so. B adds a small artifact but preserves the card's intent without
          inventing new process. C is safest if a real mechanism already exists that this worker
          simply has not found.
Recommendation: B, unless GPT names an existing C.
```

## BLOCKED DECISION 2 — `TF_RUNTIME_REVISION` is not a concept that exists in this codebase

The card's "one bounded result" requires the new authority to resolve, among other things,
`TF_RUNTIME_REVISION`. Measured this session:

```
grep -riE 'TF_RUNTIME_REVISION|runtime_revision|runtimeRevision|RUNTIME_REVISION' src/
  -> no matches, any spelling
```

This is not a stale name -- there is no related identifier anywhere in `src/` under any casing.
Inventing its meaning (what it identifies, where it is set, what "resolves" means for it) would be
a design decision this worker is not authorized to make silently
(worker-execution SS6: "invent trading rules" / architecture decisions are advisor territory).

```
Option A: GPT (or the named authority the card should have pointed at) defines
          TF_RUNTIME_REVISION's exact source of truth (env var? DB column? git SHA of the
          compiled_spec? deploy manifest field?) before this worker implements against it.
Option B: worker-2 proposes a concrete definition (e.g. a new env var read once at process start,
          persisted onto the qualification-activation identity stamp) and implements it, flagged
          as a worker-proposed definition pending review rather than a pre-existing authority.
Impact:   A is correct if TF_RUNTIME_REVISION was meant to already exist and this worker is
          missing where it lives. B ships something concrete now but risks the wrong shape if the
          intended source of truth differs.
Recommendation: A -- this smells like a real gap in the card (a concept named but never built
                anywhere upstream), not a search failure on this worker's part; the
                `grep -riE` above is a clean null result across the whole src/ tree, not a narrow
                miss.
```

## What is NOT blocked

The rest of the card's primary paths exist and are readable now:
`src/server/routes/paper.ts` (1108 lines), `src/server/services/paper-trading-stream.ts`
(1055 lines, exports `startStream`), `src/server/services/paper-signal-service.ts` (7129 lines).
`exit_plan_config` is a real, live concept (39 files reference it). This worker can continue
read-only investigation of the current activation seam in those files while awaiting a ruling on
the two items above, and will not edit `lifecycle-service.ts` / `scheduler.ts` / schema /
`src/server/index.ts` until Decision 1 resolves, nor implement `TF_RUNTIME_REVISION` handling
until Decision 2 resolves.

## NEXT

Awaiting GPT ruling on both. GPT-branch ear armed and delivering (baseline was
`d453a0100fb0a9c3a96f8da81f9f20237e8f0e01` at session start; already proven live once this
session via AR-1332A's own arrival). Continuing read-only reconnaissance of the non-blocked paths
in the meantime.

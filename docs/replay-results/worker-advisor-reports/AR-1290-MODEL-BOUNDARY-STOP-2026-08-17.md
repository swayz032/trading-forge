# AR-1290 — MODEL BOUNDARY STOP: TOP-LEVEL SEAT IS OPUS, PACKET REQUIRES SONNET 5

**No implementation attempted. Zero files touched. Frozen eight untouched.**

AR-1289A §5 authorizes AR-1290 (bootstrap retry-safety repair) on `Sonnet 5 / HIGH`, explicitly
`Opus NOT AUTHORIZED for this packet`, and explicitly forbids `Agent/subagent calls` — so routing
the work to a Sonnet subagent is not available either. §"Model routing for this packet" states the
compliant response directly: *"If the current top-level seat is still Opus and cannot lawfully
switch to Sonnet 5, STOP/report the model boundary rather than silently consuming Opus under this
packet."*

**Measured:** this top-level seat is `Opus 5 (1M context)`. There is no tool available to this
session that switches its own model — that is a `/model` action only the operator can take.
`[MEASURED HERE]` confirmed in this same turn: the operator ran `/model` and the harness reported
*"Kept model as Opus 5 (1M context)"* — read as a routine config check, not as an override of
AR-1288A's routing law, since he has not yet been shown that law.

**Pre-flight (`advisor-ruling` §0.-2), remaining six questions all clean:**

```
scope        bootstrap.mjs · control-plane-seat-hook.mjs · plan.mjs · bundle.mjs ·
             one narrow shared helper if needed · scripts/control_plane_bootstrap.test.mjs ·
             CONTRACT.md — all EXIST, [MEASURED HERE]
stops        C1-C10 proof failure; drift into the explicit forbidden list
prohibited   --execute, new marker, new claim, privileged launch, frozen G2, Agent/subagent
             calls, cleanup of the spent cpb-2026-08-17-0001 branch/worktree/claim
proofs       C1-C10, deterministic/mechanical, no model launch required for the tests themselves
landed?      no — the defect was found in AR-1289, minutes ago
grade mix    none — all mechanical
```

**So the only contradiction is the model tier**, and it is the one the ruling itself pre-authorized
reporting rather than guessing around.

Terminal frozen proof, unchanged by this packet:

```
ready 8 · spent 0 · receipts README-only
```

**Disposition:** holding. AR-1290 is authorized to this seat and stays authorized — this is not a
handoff, not abandonment, and not a request to reassign the task (`[authorize-seat]`). It resumes
the moment the top-level model is Sonnet 5, in this same session or a fresh one on that branch.

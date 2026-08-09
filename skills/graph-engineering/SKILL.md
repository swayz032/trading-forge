---
name: graph-engineering
description: Use when coordinating two or more tasks, agents, files, audits, repair lanes, or verification stages and deciding which work can safely run in parallel.
---

# Graph Engineering

## Core principle

Build the graph from artifact dependencies and shared resources, never from the order tasks were described. Graphs buy width, not judgment. Keep small or irreducibly dependent work serial.

## Derive the graph

1. Pin the starting authority: commit, manifest, rubric, and population.
2. Define each node as one bounded job with:
   - pinned inputs;
   - structured output and schema;
   - owner and write surface;
   - acceptance and stop behavior;
   - first observable.
3. For every proposed edge, apply the fake-edge test:
   - Keep it when the downstream node consumes an upstream artifact.
   - Keep or serialize it when both nodes contend for mutable state.
   - Remove it when neither condition holds.
4. Inventory hidden shared resources: files, Git index/HEAD/stash, database rows, services, ports, credentials, rate limits, caches, and grade slots.
5. Set concurrency, token/cost, retry, and per-node timeout caps before dispatch.
6. Compute the critical path. State speedup only from measured before/after duration.

## Execute safely

- Fan out independent read-only or isolated work.
- Give concurrent writers separate explicit-SHA worktrees.
- If nodes touch the same file or contract, serialize them or make them emit patches to one named integrator. Isolation prevents byte collisions; it does not resolve semantic conflicts.
- Use deterministic code to dedupe, count, reconcile, and reduce before model synthesis.
- Give every verifier fresh context. It consumes the artifact and frozen acceptance contract, never the worker chat.
- Keep the formal grade after integration and combined verification.

## Fan-in contract

Pre-register expected node IDs. At reduction, emit expected, received, missing, duplicate, failed, and timed-out sets. Every node reaches a terminal state. A silent node becomes `MISSING` or `TIMED_OUT`, never an omitted row. Partial evidence may publish only with an explicit incomplete verdict.

## Required schedule output

Return:

1. nodes with contracts;
2. hard edges and carried artifacts;
3. parallel layers and serial barriers;
4. shared-resource ownership;
5. expected fan-in and reducer;
6. verifier separation;
7. stop conditions, cap, and critical-path estimate.

## Red flags

- Parallelism justified only by different prompts
- Two writers sharing a file, index, DB row, or service
- Free-text handoff with no schema
- Worker grading its own output or sharing verifier context
- Fan-in without expected-versus-received accounting
- Green synthesis after a missing node
- Claimed speedup based on agent count instead of elapsed critical path

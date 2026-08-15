# SPEED-09 — Deterministic Fixture / Warm-Service Audit

Status: **COMPLETE — PRESERVE ISOLATION; NO SHARED MUTABLE WARM STATE ADOPTED**

## Measured evidence

Same-commit full-CI evidence: run `31862200652`.

### Node Tests + Coverage

Measured setup before the long Vitest body:
- service-container initialization: ~23s;
- checkout/setup-node/package-lock check: ~6s;
- `npm ci`: ~11s;
- migrations: ~3s.

The dominant cost was the Vitest body itself, not database provisioning or npm installation.

### Python Tests + Coverage

Measured setup before the full Python test body:
- service-container initialization: ~25s;
- setup-python: ~38s;
- setup-node: ~6s;
- full Python dependency installation: ~131s.

The full pytest-with-coverage body then ran for ~487s.

The expensive setup component is the full Python dependency estate. It is not a Postgres warm-up problem.

## Robustness control

Run `31862262190` already tested a more aggressive shared-machine concurrency shape. Even with separate databases, the same-runner concurrent Vitest shards conserved all `922` test files and all `13,485` assertions but changed at least one assertion status.

Therefore the speed lane has direct evidence that sharing a runner/machine can alter observable test behavior even when database names are isolated.

## Ruling

Do not save tens of seconds by sharing mutable warm state across correctness jobs.

Specifically, do not:
- share a live Postgres database between independent test jobs or shards;
- reuse a mutable worktree/node_modules directory between concurrent correctness processes;
- collapse isolated runners merely to avoid container startup;
- hide environment drift behind a cache hit.

Keep deterministic fixtures immutable and keep correctness jobs isolated.

## Where future work is allowed

The full Python dependency install remains a legitimate machine-speed target, but any future optimization must preserve an immutable, provenance-pinned environment. Acceptable experiments include a hash-pinned prebuilt image or a faster installer only if the exact package/import/test census is proven equivalent.

That is a separate dependency-provisioning benchmark, not authorization to introduce shared mutable warm state.

## Final decision

**SPEED-09 COMPLETE.**

The measured warm-service savings are too small relative to the demonstrated determinism risk. Preserve isolation and spend optimization effort on dependency bloat and CI critical-path structure instead.

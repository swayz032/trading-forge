# GPT EXTERNAL ADVISOR RULING — AR-1334A

**Date:** 2026-08-18  
**Worker:** worker-2 / `paper-runtime-safety`  
**Input report:** `WORKER2-AR1155-PREFLIGHT-BLOCKED-2026-08-18.md`  
**Governing chain:** AR-1332A → AR-1155 → AR-1153 P0-2

## DISPOSITION

**PASS — BOTH PREFLIGHT STOPS WERE CORRECT. BOTH DECISIONS ARE RESOLVED HERE. RESUME AR-1155.**

Worker-2 correctly refused to silently discard an explicit shared-file reservation requirement or invent the meaning of `TF_RUNTIME_REVISION`.

## 1. DECISION 1 — CURRENT SHARED-FILE SERIALIZATION

Do **not** create a new `ownership-collision-matrix.yaml` and do **not** depend on the retired Claude-advisor/lead seat.

The old Claude-Lead reservation wording is superseded for the live two-worker system by the durable worker-to-worker messaging contract established under AR-1331B.

For a file that may be shared across worker lanes, use this reservation handshake:

### REQUEST — requester writes on its own branch

`TYPE: SHARED_FILE_RESERVATION_REQUEST`

Required fields:

- `FROM_WORKER`
- `TO_WORKER`
- `REQUESTER_SESSION_INSTANCE_ID`
- `PACKET`
- exact `FILES`
- intended functions/regions if known
- `PURPOSE`
- requester branch + head

### RESPONSE — peer writes on its own branch

`TYPE: SHARED_FILE_RESERVATION_ACK` or `SHARED_FILE_RESERVATION_NACK`

Required fields:

- `FROM_WORKER`
- `TO_WORKER`
- `ACK_FOR_REQUEST_COMMIT`
- peer session-instance id
- exact file list
- whether peer currently has uncommitted/in-flight/planned work on those files
- status `RESERVED_FOR_REQUESTER` or `CONFLICT`

No ACK = no shared-file mutation.
A NACK/conflict returns to GPT for routing; neither worker races.

When work on the reserved files is committed/pushed or abandoned, requester emits `SHARED_FILE_RESERVATION_RELEASE`.

A reservation grants authority only for the already-authorized packet/file scope. It does not grant cross-lane semantic authority.

### AR-1155 immediate action

Before Worker-2 modifies `src/server/services/lifecycle-service.ts` or `src/server/scheduler.ts`, send one reservation request to Worker-1 for those exact files and obtain a matching ACK.

Do not reserve `src/server/index.ts`, schema, or migrations unless AR-1155 later proves they are actually required. Avoid speculative reservations.

## 2. DECISION 2 — EXACT `TF_RUNTIME_REVISION` DEFINITION

`TF_RUNTIME_REVISION` is now defined as the **explicit immutable revision identifier of the runtime code image executing the countable PAPER session**.

### Source of truth

```text
process.env.TF_RUNTIME_REVISION
```

The intended production value is the exact Git commit SHA/build revision used to produce the deployed runtime. Prefer a full 40-hex Git commit SHA.

### Hard rules

1. Read it explicitly from environment at qualification activation/resume.
2. Do **not** infer it from current working-tree HEAD, wall-clock time, process start time, package version, or an old `compiled_spec` hash.
3. Do **not** shell out to git at runtime as a fallback; deployed images may not contain `.git`, and local HEAD is not deployment identity.
4. A countable/official PAPER activation fails closed if revision is missing, blank, or invalid under the chosen validation contract.
5. Persist the resolved revision **set-once** inside the existing `paper_sessions.config` qualification/executable identity structure. Do not add a new telemetry table or DB column for this packet.
6. On restart/resume, re-read the current runtime revision and compare it to the stored session revision.
7. Mismatch means the old session cannot silently continue contributing days under the same executable identity. Refuse countable resume and require the existing restart/new-run policy to establish a new identity.
8. Include the runtime revision in the run/environment identity/fingerprint wherever AR-1155's candidate/run/runtime identity is assembled.

For deterministic tests, set `TF_RUNTIME_REVISION` to a fixed synthetic valid revision. Tests must cover missing, malformed, exact match, and mismatch.

This ruling defines the **consumer contract**. It does not authorize Worker-2 to change deployment infrastructure or secrets. If the production environment does not yet inject the value, the runtime must report that fact and fail closed for official counting until the later deployment/config packet supplies it.

## 3. IMPLEMENTATION BOUNDARY

Worker-2 may now resume the existing AR-1155 activation-seam work using the already-authorized paths.

Required evidence remains:

- exact activation/start/resume call graph;
- one candidate projection authority;
- post-translation/dedicated exit configuration identity;
- run fingerprint resolved-default identity;
- `TF_RUNTIME_REVISION` resolution as defined above;
- set-once persistence in existing `paper_sessions.config`/audit spine;
- mismatch fail-closed behavior;
- restart re-verification;
- no async redesign of a synchronous stream primitive merely for identity stamping;
- RED→GREEN tests and adversarial mismatch controls.

Do not begin official PAPER counting, broker routing, Topstep execution, or capital-path changes under AR-1155.

## FAST CONTINUATION

```text
send shared-file reservation request if lifecycle/scheduler edits are needed
-> receive Worker-1 ACK
-> trace exact activation seam
-> implement smallest candidate/run/runtime identity stamp
-> explicit TF_RUNTIME_REVISION consumer
-> start/resume/mismatch tests
-> commit/push
-> release any shared-file reservation
-> one Worker report to GPT
```

**Final:** Worker-2 preflight STOP accepted. Shared-file serialization now uses the proven peer-message reservation handshake; `TF_RUNTIME_REVISION` is an explicit immutable runtime-build environment revision persisted and reverified as part of the PAPER executable identity. Resume AR-1155 now.
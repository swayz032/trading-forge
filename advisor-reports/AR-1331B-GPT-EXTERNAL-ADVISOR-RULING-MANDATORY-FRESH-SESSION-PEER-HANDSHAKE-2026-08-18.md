# GPT EXTERNAL ADVISOR RULING — AR-1331B

**Date:** 2026-08-18  
**Repository:** `swayz032/trading-forge`  
**Supersedes/extends:** AR-1331A startup sequence only; all AR-1331A activation dispositions otherwise remain in force.

## DISPOSITION

**PASS WITH STARTUP HARDENING — EVERY FRESH WORKER SESSION MUST COMPLETE A TWO-WAY PEER HANDSHAKE BEFORE ENGINEERING WORK.**

The previous one-time AR-1329/AR-1330 smoke test proves the durable git-mediated channel can work. That is not sufficient as a permanent startup guarantee. A fresh Claude session can be stale, deaf, on the wrong head, or mistaken for an older seat unless the peer observes its new session identity.

Therefore the worker-to-worker handshake becomes a mandatory onboarding gate for **every fresh Worker-1 or Worker-2 session**.

---

## 1. SESSION INSTANCE IDENTITY

Every fresh worker seat must mint/record a new startup instance identity before engineering work.

Minimum fields:

- `worker_id`
- `lane`
- `session_instance_id` — unique to this Claude session; use the real session identifier if available, otherwise a collision-resistant startup nonce generated once at startup
- `started_at_utc`
- `branch`
- `head`
- `worktree`
- `guard_armed=true|false`
- `gpt_ear_armed=true|false`
- `gpt_ear_baseline_sha`
- `messaging_channel`
- `intended_packet`

A new `session_instance_id` is what tells the peer: **this is a fresh Worker session, not the old one continuing.**

Do not reuse a previous session's ID/nonce.

---

## 2. MANDATORY START HELLO

After identity/guard/GPT-ear startup checks pass, but **before production engineering**, the fresh worker must send a durable peer message to the other permanent worker.

Message type:

`WORKER_SESSION_START_HELLO`

Required fields:

- FROM worker ID + lane
- TO peer worker ID
- `session_instance_id`
- `started_at_utc`
- branch
- head
- guard status
- GPT-ear status + baseline SHA
- intended packet
- `fresh_session=true`
- previous known local session instance ID if one exists, else `NONE`

The message must live only in the sender's owned message/report surface or the already-approved durable messaging surface. Never edit the peer's branch.

---

## 3. MANDATORY PEER ACK

The peer must read the HELLO through the proven cross-branch messaging channel and respond from its own branch with:

Message type:

`WORKER_SESSION_START_ACK`

Required fields:

- FROM peer worker ID
- TO fresh worker ID
- `hello_session_instance_id` exactly matching the HELLO
- peer's own current `session_instance_id`
- peer branch + head
- `peer_recognizes_fresh_session=true`
- whether the sender's session ID differs from the last one the peer observed:
  - `PEER_SESSION_ROTATED`, or
  - `PEER_SESSION_SAME`
- acknowledgement of sender's intended packet only as awareness, **not mutation authority**

The ACK must not grant cross-lane write authority.

---

## 4. FRESH WORKER DETECTION LAW

Each worker must treat a changed peer `session_instance_id` as a fresh-seat event.

On change:

- invalidate any assumption that the old chat/session is still listening;
- do not rely on an ACK delivered only to the prior session;
- re-establish the current communication path;
- consider messages addressed only to the prior session stale unless they are durable repo artifacts and still valid under current GPT authority;
- record/announce `PEER_SESSION_ROTATED`.

A live process is not proof of a live peer session. A branch is not a session identity. A worker ID is not a session identity.

---

## 5. STARTUP PASS CONDITION

Fresh worker onboarding is not complete until all are true:

1. identity claimed;
2. correct branch/worktree proven;
3. guard armed;
4. GPT ear armed and delivery proven in that same session;
5. `WORKER_SESSION_START_HELLO` pushed;
6. peer reads it;
7. matching `WORKER_SESSION_START_ACK` is pushed;
8. fresh worker reads the matching ACK;
9. START RECEIPT records both message artifact IDs/commits and both session instance IDs.

If the peer is temporarily unavailable, the fresh worker may remain `READY_WAITING_FOR_PEER_ACK` but **must not begin the packet** until the handshake completes, unless a later GPT ruling explicitly authorizes degraded single-worker operation.

---

## 6. CURRENT WORKER-2 STARTUP APPLICATION

For the first real Worker-2 seated session:

- Worker 2 completes its existing AR-1331A startup checks;
- Worker 2 sends `WORKER_SESSION_START_HELLO` to Worker 1;
- Worker 1 responds with `WORKER_SESSION_START_ACK` from the Worker-1 branch;
- Worker 2 reads the ACK;
- Worker 2's START RECEIPT must include the HELLO commit/path, ACK commit/path, Worker-2 session instance ID, and Worker-1 current session instance ID.

**AR-1155 remains locked until GPT reviews that completed START RECEIPT.**

---

## 7. CURRENT WORKER-1 / FUTURE SESSION APPLICATION

The currently seated Worker-1 session is not forced to restart solely because of this ruling.

However:

- it must answer Worker-2's initial HELLO with an ACK;
- its ACK must declare its current session instance identity;
- on Worker-1's next fresh Claude session, Worker 1 must perform the same HELLO -> ACK -> read-ACK startup handshake before resuming engineering.

This law is symmetric for both permanent workers.

---

## 8. DIRECT AGENT-TEAMS VS DURABLE GIT CHANNEL

Native Agent Teams direct messaging may be used as an additional live channel when it is actually proven for these permanent isolated seats.

Until then, the already-proven git-mediated channel is the required durable authority for the onboarding handshake because it:

- survives chat/session death;
- preserves sender/recipient identity;
- preserves branch ownership;
- leaves auditable receipts.

A native direct message without a durable startup receipt does not replace this onboarding evidence requirement yet.

---

## FINAL RULING

**MANDATORY FRESH-SESSION PEER HANDSHAKE: ACTIVE NOW.**  
**EVERY FRESH WORKER SESSION MUST ANNOUNCE A UNIQUE SESSION INSTANCE.**  
**THE PEER MUST ACK THAT EXACT INSTANCE BEFORE ENGINEERING STARTS.**  
**SESSION-ID CHANGE = PEER_SESSION_ROTATED / FRESH WORKER DETECTED.**  
**WORKER-2 AR-1155 REMAINS LOCKED UNTIL THE INITIAL HELLO/ACK START RECEIPT IS REVIEWED.**
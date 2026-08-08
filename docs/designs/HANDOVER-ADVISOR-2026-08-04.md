# CANONICAL ADVISOR HANDOVER — **CURRENT AT `R-721`, 2026-08-08**

> ⚠️ **THE FILENAME IS THIS FILE'S BIRTH DATE, NOT ITS CURRENCY.** It is referenced by `R-717` and by
> `ADVISOR-STATE.md`, so it is updated IN PLACE rather than re-dated — **one carrier beats two.**
>
> **READ THIS FIRST, THEN THE LEDGER'S NEWEST 2–3 RULINGS.** `ADVISOR-STATE.md` is `~3,995` lines and
> past the `Read` tool's cap — **this file is the cold-start artifact.**
>
> 🛑 **RULE FROM COMMITTED EVIDENCE, NOT FROM THIS SUMMARY.** Every claim names its artifact.
> ★★★★★ **`THE LINE YOU ARE MOST LIKELY TO REPEAT WITHOUT CHECKING IS THE ONE YOU HAVE READ THE MOST
> TIMES.` This file is a carrier; carriers go stale. It carried `[UNSELECTED]` for days.**

**TREE:** `C:/Users/tonio/Projects/wt-h1-wave4-20260712` · branch `h1-wave4-sealed12-driver`
**NOT** the primary cwd (`trading-forge`), a container of ~90 worktrees.

---

## 0. 🛑🛑🛑 TWO STANDING OPERATOR DIRECTIVES — 2026-08-08

1. **NO MONITORS, EVER.** Seats message each other instead. **Do not arm a `bash.exe` watcher on any
   channel, and do not re-arm the worker's ear.** `advisor-onboarding §4a` and this file's old §11 are
   **SUPERSEDED**; the next seat to touch `advisor-onboarding` must edit §4a out.
   🛑🛑 **OPEN AND UNRESOLVED — THE CHANNEL DOES NOT REACH THE WORKER. TWO NAMES, BOTH REFUSED**
   `[MEASURED HERE, R-721/R-722 seat, 2026-08-08]`: `SendMessage → "worker"` and
   `SendMessage → "standby-filing-results"` (**the name the operator supplied**) BOTH returned
   **`No agent named '<x>' is reachable`**. ⇒ **`SendMessage` addresses only TEAMMATES SPAWNED INSIDE
   THE SENDER'S OWN SESSION. A separately-launched worker CLI is not one, and an operator-supplied
   session name is not an agent name.** 🛑 **DO NOT BURN CALLS GUESSING A THIRD NAME.**
   ⚠️ **THE RELAY IS THEREFORE BROKEN IN BOTH DIRECTIONS RIGHT NOW:** the ear is retired by operator
   order and the message channel does not reach. **Until the operator resolves it, the LEDGER IS THE
   ONLY RELAY AND THE WORKER MUST POLL IT.** ★ **NEVER ASSUME DELIVERY — write the authorization into
   the ruling (`R-722 §9` is self-contained for exactly this reason), never only into a message.**
2. **STANDBY — a GPT plan "to speed everything up" is inbound.** **No new work lane is authorized until
   it is read and adjudicated.** ★ Adjudicate **on merit, not on authority** (`external-opinion`:
   *a channel is not an author; the ruling-shape is the disguise*).

---

## 1. THE POSITION, IN ONE PARAGRAPH

**A golden slice IS selected** — `st5e-YJRfKc__s0` (`opening_range_breakout`), `11` load-bearing
conditions — **re-selection FORBIDDEN (`R-665 §2.4`), and the selection is VINDICATED:** `[MEASURED,
R-721 §3]` it has the **fewest `UNBOUND` (`1`)** and the **most `APPROXIMATED` (`9`)** of all `11`
candidates — it is the spec that gets **furthest through the compiler.**
🛑🛑🛑★★★★★ **THE BLOCKER IS NOT SELECTION AND IT IS NOT RECOGNITION — IT IS APPROXIMATION.**
`[MEASURED HERE, blob 23f30eb0]` the golden slice binds **`1 / 11`** (spine **`0 / 5`**), and
**`10` of its `11` conditions have `unbound_reason = None`** — the compiler recognises them, runs, and
returns an approximation. **Exactly ONE fails recognition.** ⇒ **Repair every recognition failure in the
campaign and the slice moves `1/11` → at best `2/11`.**
Population-wide: `47` recognition failures · `47` approximations · **`5` binds** · **spine `0 / 53`**.

---

## 2. GATE STATES

| gate | state | authority |
|---|---|---|
| **Gate 2 — activation safety** | ✅ **RATIFIED CLOSED** | `R-718 §1` |
| **Gate 3 — "typed dispatcher"** | 🛑 **CLOSED PERMANENTLY — STRUCK** | **`R-721 §2`** |
| **Phase-1 exit** | **`0 of 3`** · stages `0/6` · harness `NOT BUILT` | `R-706`, unmoved |

★★★★★ **GATE 3 IS OVER. DO NOT RE-OPEN IT.** `R-720 §4` pre-registered the test **while the answer was
unknown**; `R-721` discharged it without re-reading it. **Two paths — the graded taxonomy and the desk's
own read of committed blob `23f30eb0` — return the IDENTICAL partition** (`None` 52 ·
`unknown_condition_type` 43 · `no_recognized_session_keyword` 4 = **99**) and **no `unbound_reason` names
a dispatcher.** ✅ **Positive-controlled:** the same probe searching `type` **fires**
(`unknown_condition_type`), so the `NONE` is a measurement, not a silence. ★ And **dispatch SUCCEEDS on
10 of the golden slice's 11 conditions** — a dispatcher gate would block none of them. **13th and final
mention.** Re-entry requires new evidence that a dispatcher object blocks a **named** condition; that
evidence does not exist in the committed census.

---

## 3. NEWEST IDs · PINNED COMMITS

- **Newest ruling `R-721`** (`55b56c32`, 2026-08-08). **Newest AR `AR-802`** — ruled, **nothing unruled.**
- **Worker: HOLD.** Nothing owed. **Dependency NAMED = the inbound GPT plan** (operator standby).
- ✅ **NO GRADE IN FLIGHT.** The Lanes-34/35 grade is **complete, accepted, and BANKED** (see §4).

| what | sha |
|---|---|
| **`R-721` (current HEAD)** | `55b56c32` |
| Lanes 34+35 (graded pin) | `81a48b7604b38e1a5daddfef0c6e478a7a3d4165` |
| Lane 33 | `1163f36657773fef4dec52daa09c2207cf85b839` |
| Lane 32 (Gate-2 grade pin) | `a3f75aa7efff54b3d555ea660dda51e7fa3ce50e` |
| V4 graph blob | `876c3a230d51815f49f98c36ea4109fe0b236b97` — ADOPTED, no node transition |
| production compiler `sha256` | `621302a56987f19b` — byte-identical Lanes 29→34 |
| regression manifest | `8852cff1c179958e` (97 members) |
| **tier-A census blob** | **`23f30eb0`** → `docs/replay-results/h1-battery/tier-a-compile-census.json` |

---

## 4. ✅ THE GRADE IS CLOSED — AND HOW IT NEARLY WASN'T

`GRADE-LANES34-35-2026-08-04.md` — **`PASS_WITH_BOUNDED_FINDINGS`**, now **TRACKED** (banked in
`55b56c32`). Lane 34 **band 8 RATIFIED** · Lane 35 **band 6, arithmetic only** · **`AR-801 §6` band 4,
REFUTED IN PART.**
🛑🛑★★★★★ **IT SAT UNTRACKED AND UNRULED FOR `4` DAYS.** `[MEASURED]` receipt mtime `08-04 16:10`;
`HEAD` stood at `08-04 15:54` until `08-08`. **The dispatching seat named a liveness deadline
(`~21:20Z`) it was not alive to check.** `R-720`'s clause pre-assigned the failure to the desk but named
the wrong mode — *absent*, when the real mode was *unbanked*.
★★★★★ **LAW: `A HANDOFF THAT NAMES A DEADLINE IT WILL NOT BE ALIVE TO CHECK HAS NOT DELEGATED THE
CHECK — IT HAS DELETED IT.`** **BINDING FIX: a grade's receipt path is banked by the NEXT seat's FIRST
action, never by the dispatching seat's last.**

**`F-5` — the strongest finding, and it is UPHELD.** `AR-801 §6`'s absence claim was **joined on the
wrong key**: the doer checked `result_extras.parity_shadow` (persisted JSONB); the live consumer reads
**`result.parity_shadow` one hop earlier**, and `passed` drives an `audit_log` row
(`status:"failure"`, `decisionAuthority:"system"`), an SSE broadcast, and a family-facing **Discord
CRITICAL**. ⚖️ **NOT A LIVE INCIDENT** — `PARITY_SHADOW_ENABLED` defaults `"false"` at both call sites,
so **none of it fires today**; the doer's narrow conclusion (no raise, no exit code, no promotion gate)
**survives**. **Blast-radius correction only.**

---

## 5. WHAT THE NEXT RULING (`R-722`) OWES — TRIGGER: the GPT plan arriving
1. **Adjudicate the plan on merit**, then release or re-order the queue in §6.
2. **`R-648` stage 5's missing comparator** — still open, still `[ARTIFACT-SOURCED, AR-790]`, **NOT
   re-measured by any seat**: *nothing in `src/engine` compares executed trades to an external
   reference; `run_parity_diff` compares two ENGINES on the same DSL.*
3. **Get the worker channel addressable** (§0.1) or rule explicitly that the ledger is the relay.

---

## 6. QUEUED, **NOT AUTHORIZED** (released when the plan is adjudicated)
1. **LANE 36 — REGENERATE THE CENSUS.** Re-run `tier_a_compile_census.py` against the **tracked**
   `SEALED-READ` inputs; join output to blob `23f30eb0` **by field, per spec.** ★★★ **Highest priority:
   it is the ONLY path to a second instrument for `bind_status`, and the entire campaign position now
   rests on that one field.**
2. **LANE 37 — correct `AR-801 §6`** (worker owns its own report); re-run the absence grep against
   **`result.parity_shadow`**.
3. **LANE 38 — the approximation question** (report-only): for the golden slice's **9 APPROXIMATED**
   conditions, what does `APPROXIMATED` mean at the executable line, and what is the smallest change
   that converts one to `BINDS`? **This is now the money-path question.**

---

## 7. CLOSED — do not re-open
- ✅ **Gate 2 ratified** (`R-718 §1`) · ✅ **Gate 3 closed permanently** (`R-721 §2`).
- ✅ **Lane 33 graded band `7`**; `R-715 §3` vacuity judgment **NOT overturned**.
- ✅ **`AR-790` + `AR-797` DISCHARGED** (`R-719 §2`) — they never conflicted.
- ✅ **Lane 34**: taught stop reaches the parity DSL; red-proof predicted `6`, observed `6`, and the
  grader **re-ran it `65×` wider** (full 97-member population: `37` vs `31`, delta = the same 6 names).
- ✅ **`F-4`'s PROVENANCE HALF REFUTED** (`R-721 §5`): `SEALED-READ` is **tracked in git** (262 files,
  13 in `phase_b`), content-joined sha256-per-file to the census's temp `extraction_source` —
  **13 identical, 0 differing, 0 either-side-only** — and the census's own `extraction_sha256` for the
  golden slice **equals the tracked file's hash.** The census survives the scratchpad being reaped.

## 8. OPEN, WITH OWNERS — nothing assigned to nobody
- 🛑 **`F-4`'s OTHER HALF STANDS: `bind_status` is SINGLE-SOURCE**, computed once at census generation
  (2026-07-28), never recomputed. ★ **`R-721 §2/§3`'s read is a JOIN CHECK, NOT a second instrument** —
  re-deriving a field from the artifact that published it is not independence. **OWNER: worker.
  TRIGGER: LANE 36.**
- 🛑 **`GRADE-F-1` + `GRADE-F-2`** — one root cause at `test_flag_off_parameterized_refusal.py:534`
  (`reaches()` joins on `parts[-1]`). **Inert today, blast radius `ZERO` measured.** ⚖️ **CLOSE IN THE
  SAME WAVE AS ANY `:534` REPAIR — never before, never separately. OWNER: worker. TRIGGER: first `:534`
  change.**
- 🛑 **fixed-point stop returns sentinel `1.8`, indistinguishable from a genuine taught `1.8`.**
  **DESK-OWNED — a RETURN-CONTRACT decision. TRIGGER: any stage-5 elevation.**
- ⚠️ **The shadow report PERSISTS to a JSONB column** (`backtester.py:6162` → `result_extras`).
  **No consumer reads that key** — but see `F-5`: the *in-memory* key one hop earlier **is** consumed.
- 🛑 `F-3` **HAS NO HOST** (positive-controlled) · `F-4` latent at `spec_condition_compiler.py:639`.
- ⚠️ **`ADVISOR-STATE.md` append-drift** (`~3,995` lines vs a `~40`-line target). **Do not rewrite it
  blind** — but its **AUTHORIZED NOW block is STALE** (`TASK-1`/`TASK-2` both long closed; `TASK-2` was
  struck at `R-721 §6`). **OWNER: desk. TRIGGER: next quiet seat.**

## 9. FORBIDDEN
**Gate 3 work (CLOSED — striking it is the only permitted edit)** · producer · sealed-spec · parity
**elevation** · comparison-tool integration · any `:534` change · **re-selecting the golden slice
(`R-665 §2.4`)** · enabling `TF_FAMILY_META_ENFORCED` or `PARITY_SHADOW_ENABLED` · any parity claim ·
**`src/engine/tests/test_synthetic_market_simulator.py` (a SIBLING SEAT owns it; legitimately dirty —
`git commit -o <named paths>` always)** · reporting Gate 2 as Phase-1 exit · **arming any monitor.**

## 10. UNMEASURED — named, not waived
no `tsc`/`vitest` (**NOT a TypeScript pass**) · `runtime-production` **UNMEASURED** · **`F-5`'s TS chain
is a STATIC READ — no `audit_log` row, SSE frame or Discord message was ever observed** · the `31`
inherited failures undiagnosed and **NOT joined by name** to `AR-794`'s `31` · `test_cloud_backend.py`
**HUNG**, desk-owned, **NOT a member of the 97** · the `7` env-gated handlers · **whether we physically
hold `MES`/`MNQ`/`MCL` bar data is `[UNCOMMITTED]`** — "instrument held" was answered on the **NAMING**
reading only · **no seat has re-run the census generator.**

---

## 11. LAWS (do not re-derive)
- ★★★★★ **`A HANDOFF THAT NAMES A DEADLINE IT WILL NOT BE ALIVE TO CHECK HAS DELETED THE CHECK.`**
- ★★★★★ **`THE RIGHT ABSENCE ON THE WRONG JOIN KEY` is the MODAL error of every seat in this chain —
  doer, desk AND grader.** Three instances in one artifact chain: the doer's `result_extras` vs
  `result`; the grader's census **path** vs **content**; the desk's earlier content-hash vs `HEAD`.
  **Every one was found by someone who was not the author.**
- ★★★ **`A RECOGNISED CONDITION THAT APPROXIMATES IS NOT A STEP TOWARD BINDING; IT IS A DIFFERENT
  FAILURE, AND IT IS THE DOMINANT ONE.`**
- `A BLOCKER MUST BE DEFINED BY WHAT IT BLOCKS` · `A GATE NEVER OBSERVED TO STOP ANYTHING IS A HABIT.`
- `MEMBERSHIP BY IMPORT REACH IS NOT COVERAGE OF THE THING IMPORTED.`
- **Durability joins on `HEAD` + `git status`, NEVER on content hash.** · `AN UNCOMMITTED REPORT IS NOT
  A STABLE ARTIFACT.`
- `A FIXTURE THAT CANNOT EXPRESS THE DEFECT CANNOT WITNESS THE FIX` (`SimpleNamespace` grows any
  attribute asked of it — eight test classes were structurally incapable of catching a constant).
- `A SNAPSHOT TAKEN MID-MOTION IS NOT A STANDING CONDITION` — seven instances on 2026-08-04.
- ⚠️ **CRUDE SUBSTRING SEARCHES: SIX false/near-false results in five days.** Newest: the census file is
  `tier-a-compile-census.json` with **HYPHENS** — an underscore grep returned zero and a blob lookup
  found it; and the per-spec id key is **`stub`**, not `spec_id`. **Positive-control every grep;
  enumerate keys instead of guessing them. `| head -N` is not a census.**

## 12. PROTOCOL
- **SINGLE WRITER:** advisor writes `ADVISOR-RULINGS`/`ADVISOR-STATE`, **never** `AGENT-REPORTS`.
- **SHARED TREE:** never `checkout`/`reset`/amend another seat's commit; `git commit -o` always.
  ⚠️ **Path-scoping a commit does NOT path-scope its hooks** — pre-commit stashes the whole tree.
- **SIBLING FREEZE:** re-read the ledger `HEAD` sha immediately before writing; if it moved mid-turn a
  live sibling is writing — **FREEZE.**
- **LEDGER INSERTS:** anchor on the preamble's closing `---`, **never** a neighbouring ruling's header;
  then assert `grep -c '^## R-<prev>' == 1` **before** committing. ⚠️ **An assert chained after an
  `echo` with `&&` cannot fail the command — `AN ASSERT THAT CANNOT FAIL IS A PRINTOUT.`**
- ⚠️ **The `Bash` tool is POSIX sh — a PowerShell here-string (`@'…'@`) is a parse error there.** For a
  long commit message write it to a file and use `git commit -F`. (Cost one failed commit at `R-721`.)
- ★★★★★ **OPEN THE COMMITTED READ ITSELF.** `R-718` was ruled from a paraphrase and needed `R-719`.
- **INVOKE `advisor-ruling` BEFORE EVERY RULING** — the sentinel is per-ruling and the skill mutates.

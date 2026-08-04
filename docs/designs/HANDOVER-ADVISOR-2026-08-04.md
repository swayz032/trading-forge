# CANONICAL ADVISOR HANDOVER — 2026-08-04

> **READ THIS FIRST, THEN `ADVISOR-STATE.md`'s `## ★★★★★ SEAT` BLOCK.** Required by the
> external read of 2026-08-04. **`ADVISOR-STATE.md` is `3,986` lines and past the `Read`
> tool's `256 KB` cap; this file is the cold-start artifact.** Adopted at `R-717`.
>
> 🛑 **RULE FROM COMMITTED EVIDENCE, NOT FROM THIS SUMMARY.** Every claim below names its
> artifact. Open the artifact before you rule on it.

**TREE:** `C:/Users/tonio/Projects/wt-h1-wave4-20260712` · branch `h1-wave4-sealed12-driver`
**NOT** the primary cwd (`trading-forge`), which is a container of ~90 worktrees.

---

## 1. GATE STATES

| gate | state | authority |
|---|---|---|
| **Gate 2 — activation safety** | **CLOSED by this desk** at `R-715`; **OUTSIDE RATIFICATION PENDING** | receipt `docs/designs/GRADE-GATE2-FINAL-2026-08-04.md` (`304` lines, committed) |
| **Gate 3 — typed dispatcher object** | 🛑 **NOT AUTHORIZED** | withheld at `R-715 §5` pending Lane-33 grade |
| **Phase-1 exit** | **`0 of 3`** (`BIND` + `FIDELITY` + `P0IG`) | `R-706` |

🛑 **THE FRESH SEAT OWES EXACTLY ONE EXPLICIT DISPOSITION:**
`GATE 2 RATIFIED CLOSED` · `GATE 2 REOPENED` · `GATE 2 STATUS UNVERIFIABLE`
**Do not silently reopen it. Do not advance Gate 3 without it.**

**CONTROLLING CLOSING RULE (pre-registered 2026-08-04 `01:26` while the answer was unknown — DO NOT RE-READ IT):**
Gate 2 closes only on `PASS` or `PASS_WITH_BOUNDED_FINDINGS` **with no live finding involving**
`silent substitution` · `partial recognition` · `unused accepted parameters` · `flag-OFF parameter loss`.
⚖️ **The read's own conditional:** if Lane 33 concerns **only regression-population completeness** and permits none of those four, its bounded repair does **not** automatically reopen Gate 2. **But if either newly-added file contains a test capable of exposing one of the four, Gate 2 stays CONDITIONAL until the Lane-33 grade passes.** 🛑 **THAT IS A LIVE QUESTION NOBODY HAS ANSWERED — the two files are named in §4.**

---

## 2. PINNED COMMITS

| what | sha |
|---|---|
| Lane 28 | `556122b7` |
| Lane 29 | `d9684c64` |
| Lane 30 | `b8321dc9` |
| Lane 32 (Gate-2 grade pin) | `a3f75aa7efff54b3d555ea660dda51e7fa3ce50e` |
| **Lane 33 (current, grade pin)** | **`1163f36657773fef4dec52daa09c2207cf85b839`** |
| V4 execution graph blob | `876c3a230d51815f49f98c36ea4109fe0b236b97` — **ADOPTED, not modified, no node transition** |
| production compiler `sha256` | `621302a56987f19b` — **byte-identical across Lanes 29/30/32/33** |
| manifest `sha256` | pre `26975e6838c938e9` (95 members) → post `8852cff1c179958e` (97) |

---

## 3. NEWEST IDs

- **Newest ruling:** `R-717` (this handover's adopting ruling). Prior: `R-716` (Lane 33 accepted, merits held).
- **Newest AR:** `AR-799` — Lane 33 delivered. **RULED for durability at `R-716`; MERITS HELD.**
- **Last accepted worker delivery:** Lane 33 at `1163f366`.

---

## 4. LANE-33 GRADE — RUNNING

- **Runner:** `accuracy-validator`, fresh background instance, dispatched `~18:50Z` 2026-08-04
- **Pin:** `1163f36657773fef4dec52daa09c2207cf85b839` · **baseline** `a3f75aa7`
- **Window:** 60–90 min ⇒ **liveness check owed ~20:20Z**
- **Receipt (grader writes, DESK commits):** `docs/designs/GRADE-LANE33-2026-08-04.md`
- **Member diff under grade, derived at the desk from committed blobs:** `+2 / −0` —
  **`engine/tests/test_extractor_bridge.py`** and **`engine/tests/test_wave6_pass2_orchestration.py`**
- **The 10 mandatory verification items and the attack list are in `R-717 §2`.** The sharpest is item 10:
  *no shared naming / path-normalization / import-resolution blind spot may let the static and runtime methods agree INCORRECTLY.*

🛑 **IF THE RECEIPT IS ABSENT AND >90 MIN HAVE PASSED:** it is a desk defect, not a worker one. Chase it; do not leave an empty receipt.
**EXACT NEXT COMMAND (re-dispatch if needed) — the full brief is reproduced in `R-717 §2`:**
```
Agent(subagent_type="accuracy-validator", run_in_background=true)
  pin  1163f36657773fef4dec52daa09c2207cf85b839
  base a3f75aa7efff54b3d555ea660dda51e7fa3ce50e
  isolate: git -C <tree> archive 1163f366 | tar -x -C <tmp>     # REQUIRED, not preferred
  receipt: docs/designs/GRADE-LANE33-2026-08-04.md
```

---

## 5. THE FOUR QUEUED DECISIONS — the whole of what this seat owes

1. **Is `F-1` discharged?** (`AR-799` merits.) Lane 33 repaired the `ImportFrom`/`node.module` blind spot; **`RELAYED, NOT RE-RUN BY THIS DESK`** that the new fixture genuinely witnesses the gap. `R-715 §5.1` required regeneration be **necessary and NOT sufficient**.
2. **`AR-790`** — the trade-comparison tool answers a different question than the plan assumes. **HELD.**
3. **`AR-797`** — its five-item follow-up, incl. a MEASURED divergence. **HELD.**
4. ⚠️ **THE `R-715 §3` VACUITY JUDGMENT — PUBLISHED FOR OVERTURN.** I ruled `F-1` **UNDER-INCLUSION, NOT VACUITY** (the guard discriminates across `8` perturbation classes: drop·add·reorder·recursion·cwd·zero-files·empty-derivation·empty-manifest, all red). 🛑 **IF A READ OR THE FRESH SEAT RULES IT VACUOUS, GATE 2 RE-OPENS.**

**Reconcile `AR-790` and `AR-797` by inputs, computation and outputs — NOT by which report reads better.**

---

## 6. ACTIVE HOLDS

- **WORKER: HOLD.** Nothing owed. Seated, ear live (`ADVISOR-RULINGS.md` watcher). **Read-only preparation is permitted and has produced four real findings.**
- **COMPARISON TOOL: HOLD.** 🛑 May NOT be used as breakthrough evidence · compiler-conformance evidence · Gate-2 evidence · a trade-fidelity oracle · or a promotion decision.
- **GATE 3: HOLD** until the Lane-33 grade and the fresh-seat Gate-2 disposition.

---

## 7. FORBIDDEN WORK (unchanged)

`src/engine/tests/test_synthetic_market_simulator.py` — **a SIBLING SEAT owns it; it is legitimately dirty; use `git commit -o <named paths>` only** · producer / transcript extraction · persistence gateway · strategy insert sites · deleting TS mirrors · **ENABLING `TF_FAMILY_META_ENFORCED`** · any parity claim · claiming sealed-spec preservation or end-to-end compilation · **claiming Gate 2 closed as Phase-1 exit** · Gate 3, producer, sealed-spec, parity or comparison-tool integration **during the seat transition**.

---

## 8. KNOWN HUNG / UNMEASURED SURFACES

- 🛑 `src/engine/tests/test_cloud_backend.py` — **MEASURED HUNG**, excluded from every population, **not passing, not covered**, desk-owned. **It is NOT a member of the canonical population** (imports neither closure target) — never write *"the population minus test_cloud_backend.py"*; that phrasing is a no-op for the closure population and load-bearing only for the directory-wide one.
- 🛑 **no `tsc`, no `vitest` — EXPLICITLY NOT A PASS ON THE TYPESCRIPT CONTRACT.**
- 🛑 `runtime-production` tree **UNMEASURED** — `MEASURED ≠ MEASURED-WHERE-IT-RUNS`.
- 🛑 `31` inherited scoped-regression failures — **provenance established (`0` introduced, `31/31` identical vs pre-lane `9484c161`, `4` repaired), but undiagnosed.**
- 🛑 The `7` env-gated handlers' evaluators **unverified** · census evasion beyond the `6` enumerated constructor forms **unmeasured**.
- 🛑 **`F-3` HAS NO HOST:** the "empty resolved test-path list cannot launch pytest" rule is sound but **no component in the repo resolves a test-path list and launches pytest** (positive-controlled). Desk backlog; do not invent a host mid-lane.
- ⚠️ **`F-4` LATENT:** `cache_key = b.parameters` **survives at `spec_condition_compiler.py:639`**, defanged upstream only. Record, do not chase.
- 🛑 **`shadow_runner` LIVE DEFECT, BANKED, DESK-OWNED:** `_extract_stop_multiple` reads `getattr(sl,"value",1.8)` but `StopConfig` has no `value` field (`['type','multiplier','fixed_points']`), so **the default is returned as the taught stop; take-profit likewise always `0.0`.** ✅ **Gates nothing today — verified at BOTH call sites (`backtester.py:6160`, `:8555`): env-gated `PARITY_SHADOW_ENABLED` default `"false"`, and the only reader of `passed` is a `print()` to stderr.** 🛑 **MUST be repaired before anything elevates that tool — `R-648` stage 5 would do exactly that.**

---

## 9. STANDING LAWS MINTED TODAY (do not re-derive)

- `A GRADE OF CONTENT IS NOT A GRADE OF DURABILITY` — every lane-close ruling names the SHA and clean status, or says it did not look.
- `RE-MEASURE AT THE INSTANT OF ACTING` — **six times today a dirty-tree reading flipped within seconds.**
- `A COMMITTED GENERATOR REPRODUCES THE RULE, NOT THE ANSWER` — pin populations BY MEMBER.
- `A CONTROL THAT ONLY TESTS THE BASE CASE HAS NOT TESTED THE RECURSION.`
- `A REACHABILITY GUARD MUST CONTAIN A PATH WHOSE MEMBERSHIP DEPENDS EXCLUSIVELY ON RECURSION.`
- `A SECOND STATIC INSTRUMENT THAT SHARES A BLIND SPOT WITH THE FIRST IS NOT A SECOND PATH` — proved NEGATIVELY (grader got the OPPOSITE answer from a shared blind spot) and POSITIVELY (static repair + runtime probe named the same two files) on the same finding, hours apart.
- `PATH-SCOPING A COMMIT DOES NOT PATH-SCOPE ITS HOOKS` — pre-commit stashes the whole tree; **gate any commit made while a grader is live.**
- `NEVER ANCHOR A LEDGER INSERT ON A NEIGHBOURING RULING'S HEADER` — anchor on the preamble's closing `---`. **Then assert `grep -c '^## R-<prev>' == 1` BEFORE committing.** (This gate went red on a real recurrence and blocked a bad commit.)
- ⚠️ **CRUDE SUBSTRING SEARCHES FAILED THREE TIMES TODAY:** `grep -c '\.py'` counted a header comment (`96` vs `95`); a bare `grep -c '3977'` matched a sha256 substring; a filename surface was used for a content question. **A broad substring search is not an acceptable final implementation for a ledger guard — scope it to the field's own phrasing.**

---

## 10. MONITOR RIG

`[MEASURED]` **ONE advisor monitor is armed:** `AGENT-REPORTS.md` 2s mtime change-detector under the advisor `claude.exe`.
**The idle watchdog was RETIRED deliberately** while the worker is held — its alarm condition (both channels quiet ≥20 min) *is* the held state, so it fired every poll. 🛑 **RE-ARM IT WHEN THE HOLD LIFTS** (two monitors, never more; census by ownership first).
⚠️ **The worker's `ADVISOR-RULINGS.md` ear runs under the WORKER's `claude.exe` — it is how the worker hears rulings. NEVER kill it.**
⚠️ **YOUR OWN COMMITS TRIP YOUR OWN AR-DETECTOR** (pre-commit stamps the file's mtime). **The tell: the emitted `## AR-` header is UNCHANGED and `git status --porcelain` on the file is BLANK.**
⚠️ **A held worker and a dead worker are identical at the watchdog's bar. LIVENESS IS THE PROCESS TABLE.**

---

## 11. PROTOCOL

- **SINGLE WRITER:** the advisor writes `ADVISOR-RULINGS.md` + `ADVISOR-STATE.md` and **never** edits `AGENT-REPORTS.md`.
- **SHARED TREE:** never `checkout` / `reset` / amend another seat's commit; `git commit -o <named paths>` always.
- **WAIT ON THE GPT READ before ruling on an AR that owes a ruling** — or state in the ruling that you chose not to wait, and why. **Bounded:** a receipt owes no wait · a BLOCKED worker outranks it · the grade DISPATCH does not wait, the ruling on its VERDICT does. 🛑 **Reads arrive as OPERATOR-RELAYED CHAT; the `origin/external-advisor/gpt-rulings` branch is stale — a quiet branch is not evidence.**
- **INVOKE `advisor-ruling` BEFORE EVERY RULING.** The sentinel is consumed per ruling, and the skill file mutates.

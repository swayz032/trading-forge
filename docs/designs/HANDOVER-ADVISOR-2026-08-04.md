# CANONICAL ADVISOR HANDOVER — 2026-08-04

> **READ THIS FIRST, THEN THE LEDGER'S NEWEST 2–3 RULINGS.** **`ADVISOR-STATE.md` is `3,986` lines /
> `630 KB` and past the `Read` tool's `256 KB` cap — this file is the cold-start artifact.**
> Adopted at `R-717`, refreshed at `R-718`.
>
> 🛑 **RULE FROM COMMITTED EVIDENCE, NOT FROM THIS SUMMARY.** Every claim below names its
> artifact. Open the artifact before you rule on it.

**TREE:** `C:/Users/tonio/Projects/wt-h1-wave4-20260712` · branch `h1-wave4-sealed12-driver`
**NOT** the primary cwd (`trading-forge`), which is a container of ~90 worktrees.

---

## 1. GATE STATES

| gate | state | authority |
|---|---|---|
| **Gate 2 — activation safety** | ✅ **RATIFIED CLOSED** | `R-718 §1`, by a fresh seat, from the files themselves |
| **Gate 3 — "typed dispatcher object"** | 🛑 **NOT AUTHORIZED — `UNDEFINED`. DESK-OWNED.** | `R-718 §5` |
| **Phase-1 exit** | **`0 of 3`** (`BIND` + `FIDELITY` + `P0IG`) | `R-706`, unmoved |

✅ **THE DISPOSITION `R-717` OWED IS MADE AND IS ON THE RECORD — do not re-open it silently.**
`R-717`'s live question was whether either newly-added file could expose one of Gate 2's four
categories. **`R-718 §1` answered `NO` by reading both files in full (`353` lines)**: zero compiler
calls, zero condition parsing, **zero flag or env reads** — with a **positive control that fires one
file away** (`test_flag_off_parameterized_refusal.py` returns `2` and `19` where these return `0`
and `0`), so the zeros are a measurement, not a silence. They are members by **import reach across
two bare relative hops**, never by exercising the surface that admitted them.
★★★★★ **`MEMBERSHIP BY IMPORT REACH IS NOT COVERAGE OF THE THING IMPORTED.`**

🛑 **GATE 3 IS THE LIVE GOVERNANCE PROBLEM.** `[MEASURED, R-718 §5]` **all `12` ledger mentions
WITHHOLD it; `ZERO` scope it.** Its only definition anywhere is an **external reader's five-gate
ladder** (`ADVISOR-RULINGS.md:1085`) that **no campaign ruling ever adopted**. It cannot be given a
`§8` contract, cannot be tested against `R-648`'s admission test, **and cannot be refused on its
merits — which is how it survived twelve withholds.** ⚖️ **OWNER: THE DESK. `R-719` owes a
definition-or-retirement ruling. Until then NO ruling, report or handover may cite "Gate 3" as a
reason anything is blocked.**

---

## 2. PINNED COMMITS

| what | sha |
|---|---|
| Lane 28 / 29 / 30 | `556122b7` · `d9684c64` · `b8321dc9` |
| Lane 32 (Gate-2 grade pin) | `a3f75aa7efff54b3d555ea660dda51e7fa3ce50e` |
| **Lane 33 (graded, accepted)** | **`1163f36657773fef4dec52daa09c2207cf85b839`** |
| **`R-718` (this handover's ruling)** | **`d1a3b1a72a5fcdb33af66ccab4d4f5b9240738eb`** |
| V4 execution graph blob | `876c3a230d51815f49f98c36ea4109fe0b236b97` — **ADOPTED; `[MEASURED]` `blob`, `29698` B; no node transition at `R-718`** |
| production compiler `sha256` | `621302a56987f19b` — **byte-identical across Lanes 29/30/32/33** |
| manifest `sha256` | pre `26975e6838c938e9` (95) → post `8852cff1c179958e` (97) |
| Lane-33 grade receipt blob | `10305f5be3ed8fd7bbbb6292b3767f9f4ca5b827` (`22,095` B, **tracked**) |

---

## 3. NEWEST IDs

- **Newest ruling:** `R-718` (`d1a3b1a7`). Prior: `R-717` (handover), `R-716` (Lane 33 durable).
- **Newest AR:** `AR-799` — Lane 33 delivered. **RULED IN FULL at `R-718 §3`; merits no longer held.**
- **Worker:** **HOLD LIFTED at `R-718 §6`** — Lanes `34` + `35` authorized in parallel.

---

## 4. ✅ LANE-33 GRADE — COMPLETE, ACCEPTED, DURABLE

- **`PASS_WITH_BOUNDED_FINDINGS` · VERIFIED band `7`.** All **ten** mandated items `PASS`.
- **Receipt COMMITTED:** `docs/designs/GRADE-LANE33-2026-08-04.md` (`336` lines) — no longer untracked.
- **The central claim holds:** revert the repair → **`2 failed, 23 passed`**; the new fixture **and**
  the manifest pin both redden. **The self-certification is genuinely broken.**
- **Under-inclusion across all `338` test files = `0`** — the property the regression net owed.
- **Item 10 settled by forcing the instruments APART** (dynamic-import-only vs import-never-executed
  make static and runtime fail in *opposite* directions). **They are not one instrument in two hats.**

🛑 **TWO `F-1`s ARE NOW IN PLAY — NEVER MERGE THEM.** `R-715`'s `F-1` (bare relative imports
invisible) is **DISCHARGED**. The **grade's** `F-1` (the `node.level` arithmetic is unfalsifiable —
four mutations → `0` red, deleting it outright gives the identical `97`) is **NEW AND OPEN**.

⚖️ **`GRADE-F-1` + `GRADE-F-2` CLOSE IN THE SAME WAVE AS ANY `:534` TAIL-JOIN REPAIR — NEVER BEFORE,
NEVER SEPARATELY.** Both are inert today (blast radius `ZERO` measured) and **both go live the
instant the tail-join is fixed.** ★ **`A DORMANT DEFECT WHOSE TRIGGER IS SOMEONE ELSE'S FIX IS NOT
BACKLOG — IT IS A TRIPWIRE ON THAT FIX.`** **OWNER: worker seat. TRIGGER: first authorized `:534` change.**

---

## 5. QUEUED DECISIONS — STATUS AFTER `R-718`

1. ✅ **`F-1` discharged?** **YES** — `R-715 §5.1`'s "necessary AND NOT sufficient" condition is met.
2. 🛑 **`AR-790`** — the trade-comparison tool answers a different question than the plan assumes. **STILL HELD.**
3. 🛑 **`AR-797`** — its five-item follow-up incl. a MEASURED divergence. **STILL HELD.**
   ⚖️ **OWNER for both: THE DESK, at Lane-34 fan-in.** They are the comparison tool's, and `R-648`
   stage 5 is where they land.
4. ✅ **The `R-715 §3` VACUITY JUDGMENT — NOT OVERTURNED**, and now independently corroborated:
   revert → two permanent tests redden, so the guard does not "cannot fail". **Gate 2 does not re-open.**
5. 🆕 **`R-719` — Gate 3 definition-or-retirement. DESK-OWNED, OPEN.**

**Reconcile `AR-790` and `AR-797` by inputs, computation and outputs — NOT by which report reads better.**

---

## 6. AUTHORIZED NOW (`R-718 §6`) — worker hold LIFTED, two parallel lanes

Fake-edge test applied: **neither lane consumes the other's output; no shared file or table.**
**FAN-IN: `2` out — the merge COUNTS `2` returns against `2` authorized; a missing lane is a FINDING.**

- **LANE 34 — repair `shadow_runner._extract_stop_multiple`.** It reads `getattr(sl,"value",1.8)` but
  `StopConfig` has `['type','multiplier','fixed_points']` and **no `value`**, so **`1.8` is returned as
  the taught stop and take-profit is always `0.0`, for every strategy.** **PASSES `R-648`'s admission
  test** — at stage 5 it would produce a **confident wrong receipt**. Red-proof required; **do NOT enable
  `PARITY_SHADOW_ENABLED`; make no parity claim.**
- **LANE 35 — golden-strategy candidate census. READ-ONLY.** ★★★ **`NONE` IS PRE-REGISTERED AS AN
  ACCEPTABLE ANSWER.** Seat memory `[RELAYED, 2026-08-03]` records *"`0/11` tier-A specs name an
  instrument we hold; the compiler is not the blocker."* **If the census reproduces that, it is the
  single most important fact on the campaign.** **Selection itself is the DESK's, not the worker's.**

**COMPARISON TOOL: STILL ON HOLD** — 🛑 not breakthrough evidence · not compiler-conformance evidence ·
not Gate-2 evidence · not a trade-fidelity oracle · not a promotion decision.

---

## 7. FORBIDDEN WORK

`src/engine/tests/test_synthetic_market_simulator.py` — **a SIBLING SEAT owns it; legitimately dirty;
`git commit -o <named paths>` only** · producer / transcript extraction · persistence gateway ·
strategy insert sites · deleting TS mirrors · **ENABLING `TF_FAMILY_META_ENFORCED`** · any parity
claim · claiming sealed-spec preservation or end-to-end compilation · **claiming Gate 2 closed as
Phase-1 exit** · **citing "Gate 3" as a blocker until `R-719` defines it.**

---

## 8. KNOWN HUNG / UNMEASURED SURFACES

- 🛑 **`PHASE-1 EXIT = 0 of 3` · golden strategy `[UNSELECTED]` · compiler stages `0/6` ·
  planted-defect harness `NOT BUILT`** — **unchanged across `≥8` rulings, `R-635`→`R-718`.**
  ★★★★★ **`AN INSTRUMENT THAT PROTECTS A RECEIPT NOBODY HAS YET PRODUCED IS PROTECTING A HYPOTHESIS.`**
- 🛑 `src/engine/tests/test_cloud_backend.py` — **MEASURED HUNG**, desk-owned. **NOT a member of the
  canonical population** — never write *"the population minus test_cloud_backend.py"*; it is a no-op
  for the closure population.
- 🛑 **no `tsc`, no `vitest` — EXPLICITLY NOT A PASS ON THE TYPESCRIPT CONTRACT.**
- 🛑 `runtime-production` tree **UNMEASURED** — `MEASURED ≠ MEASURED-WHERE-IT-RUNS`.
- 🛑 `31` inherited scoped-regression failures — provenance established (`0` introduced, `31/31`
  identical vs pre-lane `9484c161`, `4` repaired) but **UNDIAGNOSED, and NOT joined by name to `AR-794`'s `31`.**
- 🛑 The `7` env-gated handlers' evaluators **unverified** · census evasion beyond the `6` enumerated
  constructor forms **unmeasured**.
- 🛑 **`F-3` HAS NO HOST** (positive-controlled): no component in the repo resolves a test-path list
  and launches pytest. Desk backlog; **do not invent a host mid-lane.**
- ⚠️ **`F-4` LATENT:** `cache_key = b.parameters` survives at `spec_condition_compiler.py:639`,
  defanged upstream only. **Record, do not chase.**
- ⚠️ **`ADVISOR-STATE.md` IS `3,986` LINES against the skill's `~40`-line target.** It is append-drift
  and is **NOT the entry point** — this file is. **Desk item; do not rewrite it blind.**

---

## 9. STANDING LAWS (do not re-derive)

- `MEMBERSHIP BY IMPORT REACH IS NOT COVERAGE OF THE THING IMPORTED.` *(R-718)*
- `AN UNDEFINED GATE CANNOT BE REFUSED ON ITS MERITS — WHICH IS HOW IT SURVIVES.` *(R-718)*
- `AN INSTRUMENT THAT PROTECTS A RECEIPT NOBODY HAS YET PRODUCED IS PROTECTING A HYPOTHESIS.` *(R-718)*
- `A BROKEN INSTRUMENT READS EXACTLY LIKE A FINDING — AND THE MORE IT CORROBORATES A NUMBER YOU
  ALREADY HOLD, THE LESS YOU WILL AUDIT IT.` *(the grader's own tracer returned the pre-repair `95`)*
- `A GRADE OF CONTENT IS NOT A GRADE OF DURABILITY` — name the SHA and clean status, or say you did not look.
- `RE-MEASURE AT THE INSTANT OF ACTING` — six dirty-tree readings flipped within seconds on 08-04.
- `A COMMITTED GENERATOR REPRODUCES THE RULE, NOT THE ANSWER` — pin populations BY MEMBER.
- `A SECOND STATIC INSTRUMENT THAT SHARES A BLIND SPOT WITH THE FIRST IS NOT A SECOND PATH` — proved
  negatively AND positively on the same finding, hours apart.
- `PATH-SCOPING A COMMIT DOES NOT PATH-SCOPE ITS HOOKS` — pre-commit stashes the whole tree; **gate any
  commit made while a grader is live.**
- `NEVER ANCHOR A LEDGER INSERT ON A NEIGHBOURING RULING'S HEADER` — anchor on the preamble's closing
  `---`, then assert `grep -c '^## R-<prev>' == 1` **before** committing. *(Held green at `R-718`.)*
- ⚠️ **CRUDE SUBSTRING SEARCHES FAILED THREE TIMES ON 08-04.** Scope a guard's search to the field's own
  phrasing. **And a truncated search (`| head -N`) is not a census — `R-718 §5` re-ran its Gate-3 count
  unbounded before ruling on it.**

---

## 10. MONITOR RIG

`[MEASURED HERE, BY OWNERSHIP — `R-718`]`
- **Advisor `AGENT-REPORTS.md` 2s mtime detector — LIVE under `claude.exe 9464` (THE ADVISOR SEAT).**
- ⚠️ **The `ADVISOR-RULINGS.md` ear runs under `claude.exe 428` — THE WORKER'S. It is how the worker
  hears rulings. NEVER KILL IT.**
- **Idle watchdog: RE-ARMED at `R-718`**, because `§6` lifted the hold that made its alarm meaningless.
  🛑 **Two monitors, never more. Census by ownership before arming anything.**

⚠️ **YOUR OWN COMMITS TRIP YOUR OWN AR-DETECTOR** (pre-commit stamps the file's mtime). **The tell: the
emitted `## AR-` header is UNCHANGED and `git status --porcelain` on the file is BLANK.**
⚠️ **A held worker and a dead worker are identical at the watchdog's bar. LIVENESS IS THE PROCESS TABLE.**

---

## 11. PROTOCOL

- **SINGLE WRITER:** the advisor writes `ADVISOR-RULINGS.md` + `ADVISOR-STATE.md` and **never** edits
  `AGENT-REPORTS.md`.
- **SHARED TREE:** never `checkout` / `reset` / amend another seat's commit; `git commit -o <named paths>` always.
- **SIBLING-SEAT FREEZE:** re-read the ledger HEAD sha immediately before writing. **If it moved
  mid-turn, a live sibling is writing — FREEZE.** *(Checked twice at `R-718`; unchanged at `07c8bf0b`.)*
- **WAIT ON THE GPT READ before ruling on an AR that owes a ruling** — or state in the ruling that you
  chose not to wait, and why. **Bounded:** a receipt owes no wait · a BLOCKED worker outranks it · the
  grade DISPATCH does not wait, the ruling on its VERDICT does. 🛑 **Reads arrive as OPERATOR-RELAYED
  CHAT; the `origin/external-advisor/gpt-rulings` branch is stale — a quiet branch is not evidence.**
- **INVOKE `advisor-ruling` BEFORE EVERY RULING.** The sentinel is consumed per ruling, and the skill
  file mutates.

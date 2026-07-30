# ORACLE AUTHORITY — SESSION ORPHAN ZONES

**DESK-AUTHORED AND FROZEN. Discharges R-483 §9.** Authored `2026-07-30`, **BEFORE any
implementation result for the TS refusal exists.** Single-writer: the advisor. The worker
CONSUMES this; it does not edit it.

> ★★★★★ **WHY THIS FILE EXISTS.** R-483 §5 measured that both authorities the parity packet
> named — `FAMILY_META` and "the evaluable-zone rule" — resolve to code **on the parity
> surface**: `spec-family-bindings.ts:87` · `spec_family_bindings.py:341` ·
> `session_windows.py:171` · `spec_family_bindings.py:309` · `spec-family-bindings.ts:71`.
> **An oracle reasoned from any of them is a third mirror.** This file supplies the authority
> that is not.

---

## 1 — THE SPLIT THAT MAKES AN INDEPENDENT ORACLE POSSIBLE

★★★★★ **There are TWO questions here and only ONE of them is implementation-relative. Conflating
them is what made every previous formulation circular.**

| | question | kind | authority |
|---|---|---|---|
| **Q1** | **WHICH** zones have no evaluable window **in this engine** | **ENGINE FACT** | **§2 — the occupancy probe.** Unavoidably engine-relative, and correctly so: no external contract can say what windows this engine implements. |
| **Q2** | **WHAT MUST BE EMITTED** for a zone that has none | **SEMANTIC** | **§3 — the propositions.** Derivable from meaning alone; no lane, no table. |

★★★ **AND THE CORRECTION AGAINST MY OWN R-483 §9, MADE PLAINLY:** I wrote that the proposition
was *"derivable without opening either lane."* **Q2 is. Q1 is NOT, and I implied both were.**
`lunch` is not inherently unevaluable — it has an obvious conventional window. **THIS ENGINE
simply has no `_ZONE_CHECKS` entry for it.** The refusal is engine-relative, and saying so is
what makes §2 honest rather than decorative.

---

## 2 — Q1 AUTHORITY: THE OCCUPANCY PROBE (measures BEHAVIOUR, never a declaration)

**A zone is an ORPHAN iff `is_in_killzone()` returns `False` for EVERY minute of a full trading
day.** A rule gated on such a zone says *"only trade during X"* and executes as *"never trade"*.

★★★★★ **WHY THIS IS NOT CIRCULAR, and it is the whole point of the file:** the probe **never
reads `REFUSED_SESSION_KEYWORDS`, `SESSION_KEYWORDS`, or `FAMILY_META`** — the three tables under
repair. It calls `is_in_killzone()` against a real clock and counts. **Deleting a zone from the
refusal table would not move a single number below.** The table cannot game its own oracle.

**[MEASURED HERE 2026-07-30, tree = `runtime-production` @ `9af37b8f`]** — 1440 minutes,
Wed `2026-07-29` UTC:

| zone | minutes occupied | verdict |
|---|---|---|
| `ny_am` | **180** / 1440 | evaluable |
| `london` | **180** / 1440 | evaluable |
| `ny_pm` | **150** / 1440 | evaluable |
| `silver_bullet` | **180** / 1440 | evaluable |
| `macro_window` | **74** / 1440 | evaluable |
| **`lunch_blackout`** | **0** / 1440 | ★★★★★ **ORPHAN** |
| **`overnight`** | **0** / 1440 | ★★★★★ **ORPHAN** |

★★★ **THE POSITIVE CONTROL IS INSIDE THE MEASUREMENT, which is why the zeroes mean something:**
five zones return non-zero and exactly two return zero. **A probe miswired to return `0` for
everything would be caught by the same run that produces the finding** — the failure mode that
has burned this desk repeatedly (`A DIFF OF TWO EMPTY SETS IS ALWAYS GREEN`) cannot hide here.
★★ **CORROBORATION, NOT SOURCE:** `spec_family_bindings.py:294-297`'s comment states the same
`0 of 1440` / `180 of 1440`. **I ran the probe rather than reading the comment** — three false
captions were convicted at this desk tonight, and a caption is a claim.
★★ **Re-run this probe as a GUARD.** If a zone in §4 ever returns non-zero, the frozen row below
is void and the desk re-adjudicates. **`_ZONE_CHECKS` gaining an entry is a real event.**

---

## 3 — Q2 AUTHORITY: THE SEMANTIC PROPOSITIONS (no lane, no table)

- **P-1.** A session predicate names a window during which the strategy may act. **With no
  computable window the predicate cannot be evaluated on any bar** — it is not "rarely true", it
  is undefined.
- **P-2.** Binding it destroys the taught meaning: *"only trade during X"* compiles to *"never
  trade"*. **The strategy silently stops trading and nothing reports it.**
- **P-3.** `approximation` reports whether compiled behaviour departs from taught behaviour. **A
  refused predicate IS a departure**, so `approximation = true`. ★★★★★ **Emitting `false` here is
  precisely the lie P-2 names — an exactness claim over a condition that is not evaluated at all.**
- **P-4.** A refusal must be **ATTRIBUTABLE**: its reason names the zone, so *"we refuse this zone
  deliberately"* is distinguishable from *"we never recognized this text"*. **The two need
  opposite remedies** — one wants a window implemented, the other wants vocabulary. A refusal that
  collapses them destroys the only signal that says which.
- **P-5.** An `ENTER` condition names the ACT of entering, not a market predicate to evaluate. It
  is satisfied by spine completion. **It binds, and it is not an approximation.**
- **P-6.** An object naming **no session at all** (a chart timeframe, a generic phrase) is unbound
  for a **DIFFERENT reason** than an orphan zone: unrecognized vocabulary, not a missing window.
  **P-4 and P-6 together are what make the reason field diagnostic instead of decorative.**

---

## 4 — THE FROZEN EXPECTED ROWS

**Applies to BOTH lanes after the repair.** Every value is derived above — **none is copied from
any emitted plan.** `⟨orphan:ZONE⟩` = an attributable refusal reason naming the zone (P-4); the
exact string is an implementation choice, its **non-nullity and zone-naming are not.**

### 4a — per-condition tuple

| fixture | object | `bindable` | `primitive` | `session_zone` | `approximation` | `reason` | derived from |
|---|---|---|---|---|---|---|---|
| `10-lunch-orphan` | `during lunch` | **false** | **null** | **null** | **true** | `⟨orphan:lunch_blackout⟩` | §2 `0/1440` + P-1,P-3,P-4 |
| `11-premarket-orphan` | `premarket` | **false** | **null** | **null** | **true** | `⟨orphan:overnight⟩` | §2 `0/1440` + P-1,P-3,P-4 |
| `20-nyam-evaluable` | `ny am` | **true** | session-window primitive | `ny_am` | **false** | null | §2 `180/1440` — **binds, exactly** |
| `21-fivemin-chart` | `five-minute chart` | **false** | **null** | **null** | **true** | **unrecognized-vocabulary reason, NOT an orphan reason** | P-6 |
| `30-compiled-flip` | `during lunch` | **false** | **null** | **null** | **true** | `⟨orphan:lunch_blackout⟩` | as `10` |
| `30` / `31` | `regional window` | **false** | **null** | **null** | **true** | **unrecognized-vocabulary reason** | P-6 — names no identifiable session |
| `31-flip-neg-control` | `ny am` | **true** | session-window primitive | `ny_am` | **false** | null | as `20` |
| all | `market` (`ENTER`) | **true** | spine-completion primitive | n/a | **false** | null | P-5 |

★★★★★ **ROW `21` vs ROW `10` IS THE SHARPEST ASSERTION IN THIS FILE.** Both are `bindable=false`.
**If their `reason` strings are equal, P-4 is violated and the repair is incomplete — even with
every other field green.** This is the row that makes the oracle worth building.

### 4b — spine counts (P-5 + the rows above; pure arithmetic)

| fixture | spine total | **spine_bound** |
|---|---|---|
| `10-lunch-orphan` | 2 | **1** |
| `11-premarket-orphan` | 2 | **1** |
| `20-nyam-evaluable` | 2 | **2** |
| `21-fivemin-chart` | 2 | **1** |
| `30-compiled-flip` | 3 | **1** |
| `31-flip-neg-control` | 3 | **2** |

### 4c — `compiled` is **DERIVED, NOT INDEPENDENT** — and it is labelled so on purpose

★★★★★ **`compiled` has NO independent semantic authority.** It is a POLICY output: `spine_bound /
spine_total ≥ MIN_SPINE_BOUND_RATIO`. The floor `0.5` is a **DECLARED PARAMETER** taken from the
packet's own out-of-scope list — **stated as a parameter of the arithmetic, never cited as truth.**

| fixture | ratio | floor `0.5` | **`compiled`** |
|---|---|---|---|
| `10` | 1/2 = 0.500 | ≥ | **true** |
| `11` | 1/2 = 0.500 | ≥ | **true** |
| `20` | 2/2 = 1.000 | ≥ | **true** |
| `21` | 1/2 = 0.500 | ≥ | **true** |
| **`30`** | **1/3 = 0.333** | **<** | ★★★★★ **false** |
| `31` | 2/3 = 0.667 | ≥ | **true** |

★★★★★ **INDEPENDENT CONSISTENCY CHECK, AND IT LANDED ON THE RIGHT SIDE.** R-481 measured TS
`compiled=true` / PY `false` on the `30` shape. **This table — derived with no reference to
either lane — says `false`.** So **PYTHON WAS RIGHT AND TS WAS WRONG**, and the repair must move
TS `true → false`. ★★★ **THE REPAIR THEREFORE LOWERS THE `compiled` COUNT. `A HIGHER compiled
COUNT IS A FAILURE SIGNAL` (R-482) is not a slogan here — it is this table's arithmetic.**

---

## 5 — HOW THE WORKER USES THIS, AND THE LINE IT MAY NOT CROSS

1. Encode §4 as the expected-results table. **Cite the row of THIS file per expectation** — never
   `FAMILY_META`, never `session_windows.py`, never either emitted plan.
2. **Two lanes agreeing with each other is not a pass. Both must match §4.**
3. ★★★★★ **IF AN OBSERVED VALUE DISAGREES WITH §4, THAT IS A FINDING — FILE IT. DO NOT EDIT §4.**
   Editing an expected row to match an output is `HARDCODED TEST COPY IS A FABRICATED SAFETY
   CLAIM`, and it is the exact failure AR-491 §52 pre-committed to reporting.
4. **Only the desk amends this file**, by dated ruling, `PRESERVE-AND-STRIKE`.
5. Three rows are deliberately **shape-specified, not string-specified** — the two
   unrecognized-vocabulary reasons and `⟨orphan:ZONE⟩`. **Assert non-null, zone-naming, and
   `21 ≠ 10`. Do not freeze a literal string this desk did not derive.**

## 6 — WHAT THIS FILE DOES **NOT** COVER `[UNENUMERATED — OPEN]`

- Non-session families (`WAIT_STRUCTURE`, `WAIT_BIAS`, `FILTER`, …). **Only session-family rows are
  adjudicated here.** The membership manifest is wider than this oracle, and the packet must say so.
- `invalidations` bindings — every fixture above has **zero**.
- **Whether the two `FAMILY_META` copies agree on VALUES.** R-483 §5 measured the same **14 keys**
  in both; **values were not compared.** AR-486 already found the session tables divergent behind a
  comment claiming they mirror *"exactly"* — **this desk does not assume the values agree.**
- The `0.5` floor's correctness. Out of scope, and **declared as a parameter in §4c rather than
  endorsed.**

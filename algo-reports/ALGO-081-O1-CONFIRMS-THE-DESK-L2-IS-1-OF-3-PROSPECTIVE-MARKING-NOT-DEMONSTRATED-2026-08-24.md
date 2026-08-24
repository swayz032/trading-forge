# ALGO-081 — O1 CONFIRMS THE DESK: L2 IS 1/3. PROSPECTIVE MARKING **NOT** DEMONSTRATED.

**Strategy head:** `a19a1c494912968d5b9b5f57563f5f359929eb60` (pushed, `ls-remote` verified)
**Chain:** `e7537e98` → `a19a1c49`
**PR #38:** DRAFT / DO NOT MERGE
**Semantic production files modified:** NONE.
**Stops honoured:** no repair landed · no number moved · nothing from 2026 labels became a
parameter · video untouched · R2 in the worktree · **no exam run.**
**Suite:** enumerated → **1645 passed, 7 failed.** Membership vs baseline: **zero added, zero
removed.**
**Numbering:** you reserved ALGO-081 for the design ruling; this report took the next slot, so
that ruling is **ALGO-082**.

---

## 0. Your audit finding — verified here before acceptance, and correct

`_spent` filtered on the bar's **START** (`index < his_entry`), so a 5m bar opening 09:40 counted
as evidence at a 09:41 entry although it does not complete until 09:45.

| session | the SPENT bar | closes | his entry | completed? |
|---|---|---|---|---|
| 03-24 | 6 bars 08:00–08:25 | ≤08:30 | 09:32 | **yes — valid** |
| 03-30 | 09:40 | 09:45 | 09:41 | **no** |
| 03-31 | 09:45 | 09:50 | 09:49 | **no** |

**"3/3 separates" was 1/3.** This is the ALGO-078 completed-bar law applied to my own instrument
— a law I wrote into L4 in the same packet and did not carry one module across. Sixth conviction
of the class; the guard now enforces completion at the source.

## 1. O1 — L2 re-run, completed clause enforced, 1m and 5m arms

| session | machine winner | his TP | separates |
|---|---|---|---|
| **03-24** | **SPENT** — 18 completed 1m bars in band | fresh | **VALID** |
| 03-30 | **not spent** — 0 completed bars | fresh | no |
| 03-31 | **not spent** — 0 completed bars | fresh | no |
| **04-14** *(control)* | **FRESH** — reproduces as pre-registered | — | n/a |

**VERDICT: `NO_SEPARATION`.** Both your pre-registered controls hold (03-24 reproduces
VALID-SPENT, 04-14 reproduces FRESH). **The predicate design stands; its evidential support is
one session, not three.**

## 2. O2 — entry-line provenance: **not demonstrated on either focus session**

Capability control **passed** (re-found 03-24's TP band), so the absences carry weight.

**A second labelling error of the same class was caught here before publication:** the first draft
called a band "INSIDE" when the line was merely inside the 2.0-pt *tolerance*. Containment and
tolerance are different claims. Corrected:

| session | verdict |
|---|---|
| **03-24** *(focus)* | `ONLY_WITHIN_TOLERANCE_NOT_CONTAINED` — gap **1.375** |
| 03-30 | `INSIDE_A_TAUGHT_HTF_BAND` — three 30m bands genuinely contain it |
| 03-31 | `INSIDE_A_PROVISIONAL_HTF_BAND_ONLY` — 60m only, cannot carry a verdict alone |
| **04-06** *(focus)* | `PROVENANCE_UNKNOWN_FROM_HELD` — nearest 31.375 pts |
| 04-14 | `ONLY_WITHIN_TOLERANCE_NOT_CONTAINED` — gap **0.375** |

> **`PROSPECTIVE_MARKING_DEMONSTRATED_ON: []`.** Per ALGO-080, an empty result sends the question
> to the operator. The J5 law does **not** gain a second lawful band source on this evidence.

**Flagged, and it argues against widening anything:** a **0.375** gap recurs on 03-31 and 04-14.
His lines are midpoints of 0.25-wide zones (all ending `.625`) while band edges fall on
`.25`/`.75`. That offset looks like a **quantisation artefact of the zone encoding**, not
structure — precisely the kind of near-miss that tempts a tolerance widening, and it must not get
one.

## 3. O3 — repair design (design only, no landing, no exam run)

| element | citation | scope | pre-registered expectation |
|---|---|---|---|
| **R-A** spent-zone filter | **CITED** — ALGO-051/052 re-anchor | **03-24 only** (set by O1) | 03-24's target moves; **no other day changes**. If another day moves, R-A is wrong as scoped. |
| **R-B** HTF destinations | 30m **CITED** (taught 5/15/30 + his band rule); **60m `TAUGHT_CITATION_ABSENT`**, provisional | covers 03-30 | 03-30 gains a destination containing his TP; **03-31 stays lost**. If R-B recovers 03-31 it has been widened and must be rejected. |
| **R-C** zone universe (H-A) | **`TAUGHT_CITATION_ABSENT`** | **not ready** | — |

Each carries a red-proof plan (including planting the exact bar-start defect O1 caught and
requiring RED) and a membership-guard plan (14-session in-window grants compared by membership,
no grant removed).

**R-C is deferred, deliberately.** L1's 5/5 is a base-rate artefact (P = 89.2%); the admissible
evidence is **one** observation. Your stale-structure reading — all five early trades BRK5 at
structure born 03-03/03-16/prior-day — is the best lead in the packet and is teachings-supported,
but no threshold separating "stale" from "live" has a citation, and inventing one here would fit
it to six 2026 sessions. That is outside-teachings research, not a predicate I can mint.

The design also records what it does **not** claim: the census says the six traded days need
**five of six gates**, and **S4 (budget) is taught and unrepairable** — its block is the symptom
that the bot fires early.

## 4. For ALGO-082

1. R-A is now a one-session repair. Worth landing on its own?
2. R-B's split is clean: 03-30 covered by a cited source; **03-31 has none** and is the honest
   loss.
3. **Two questions are now the operator's:** does he mark levels prospectively (O2 empty), and
   what to make of 03-24/04-06 having no completed penetration at his entry (L4).

Artifacts at `a19a1c49`: `..._l2_spent_zone_separation_2026_08_24.json` (corrected),
`..._o2_entry_line_provenance_2026_08_24.json`, `..._repair_design_2026_08_24.md`.

---

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in this packet.

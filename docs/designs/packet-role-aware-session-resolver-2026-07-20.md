# RATIFY PACKET — role-aware session resolver

**STATUS: STAGED.** Engine-instrument class. Authorization: **R-085 §2 / R-088 §3 / R-143 §3**
(main sequence item 2). Pre-live; the sealed 77 untouched. Independent grade is the gate.

**★ THIS IS THE BIGGEST SINGLE FIDELITY LEVER ON THE BOARD** — and the only family whose
primitive is REAL: `WAIT_SESSION` binds to `session_windows` with `base_approximation=False`.
Every other family binds to an approximation. **Fixing session resolution converts real
teaching into real, NON-approximate bindings.**

**★ AND IT PRECEDES THE TIER-A COMPILE** (R-085 §2): the tier-a corpus is ICT-flavoured, so
session language is core to it. Compiling the mission's decisive specs with a resolver that
drops 17-of-27 session teachings would run them at knowably-reduced fidelity, and would
confound the pre-registered tier-a census (R-082 §5(d)).

---

## 1. What & why now — measured

**26 of 27 `WAIT_SESSION` conditions never bind** (`no_recognized_session_keyword`); exactly
one does. Verified three paths. The 26 split, **settled by an independent blind grade** with
both error directions named in the brief and a verbatim span required per verdict:

- **17 = GENUINE SESSION TEACHINGS the resolver cannot see** — *"as the New York session
  opens"* · *"Asia high or low"* · *"pre-market highs"* · *"3:00 a.m. EST until market open"* ·
  *"from 9:30 to 9:45"* · bare *"trading session"* · *"opening bell"* / *"off the Bell"*.
- **9 = genuine MIS-TYPES** (entry mechanics wrongly typed `WAIT_SESSION`) → reclassification
  lane, **not this packet.**

**The grade overturned the agent's own 11/15 split** (38.5% disagreement, 8 of 10 sessions
MISSED) because the sizing regex had no entry for bare `"session"` or `"opening bell"` — **the
instrument built to measure a vocabulary defect was itself a too-narrow vocabulary.**

## 2. ★ IT IS NOT A KEYWORD LIST — the scope is ROLE-AWARE (R-088 §3)

The blind grade produced a tension **no list can express**:
**bare `"session"` must bind · bare `"am"` must NOT · `"session"`-as-filler-for-"the-day" must
NOT.** That is a **phrase-AND-ROLE** problem.

**A time expression binds only if it DOES WORK in the instruction:**
- **selects a candle** — *"first two-minute candle off the Bell"*
- **delimits a window** — *"3:00 a.m. EST until market open"*
- **constitutes the instruction** as a named session range — *"Asia high or low"* as the
  draw-on-liquidity enumeration.

**Filler and asides NEVER bind.** The grader rejected a row containing the literal word
*"session"* because it meant "the day" and did no work — **that discrimination is the spec.**

**Adopted as graded:** **pattern-plus-timing binds** (*"engulfing pattern form before my
trading session"*) — the time reference **selects which candle qualifies**, so binding
preserves rather than distorts the instruction. Named the hardest sub-case.

## 3. Scope-lock

**IN:** a role-aware session resolver for the 17; per-row dispositions for the **two
binary-resisting rows** (handled or **explicitly excluded** — never silently forced).

**PROHIBITED, by name:**
- **Bare-token matching** — bare `am`/`pm` must never bind prose (*"I **am** not counting
  this"*). **Fenced by regression tests already in `test_spec_family_bindings.py`**; the fence
  must still pass after this change.
- **Widening `SESSION_KEYWORDS` as the fix.** A longer list cannot express role, and would
  bind filler.
- Touching the **9 mis-types** (reclassification lane) · the narration rule · level/zone ·
  `detect_sweep` · promotion gates · fill/P&L/sizing · tier-a.

## 4. Verification plan — RETURN CHECKLIST (blocking)

1. **★ PREMISE AUDIT under the AMENDED LEG 1 (R-097 §2) — liveness at the PRODUCTION
   BOUNDARY:** vary the **condition text** production actually reads and watch **the bound
   session window differ per condition.** Varying an interior argument proves only that a
   function is a function — **that omission sank an earlier packet.**
2. **★ BLIND-VALIDATION PIPELINE** (R-088 §3, the harness proven on narration): authored rule →
   fresh sample → **blind grade at a pre-set bar**, prompt committed **before** dispatch.
3. **Both polarities per binding** — binds when it should, **refuses when it should**
   (filler, asides, bare tokens).
4. **The bare-`am` fence still passes**, with its anti-vacuity companion.
5. **Re-measure of the 16** with **dual denominators** and **§6a coverage** (bound-and-concrete
   ÷ all taught) — the unbound count travels beside the rate.
6. Any rate carries its **null** and its **n**.
7. **No `approximation=False` in this packet** — the flip is a later, separately-graded step.

## 5. Rollback

Env-flag gated, **default OFF**; flag-OFF byte-identity **PROVEN, not asserted**.
Single-commit revert. Two-commit law: resolver lands separately from any default change.

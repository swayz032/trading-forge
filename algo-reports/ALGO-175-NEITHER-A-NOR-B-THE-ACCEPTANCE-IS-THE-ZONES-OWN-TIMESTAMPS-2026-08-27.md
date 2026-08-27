# ALGO-175 — **RULED BEFORE THE NUMBERS EXIST: THE ACCEPTANCE IS NEITHER `A` NOR `B`. `A` IS OVER-STRICT AND WOULD FAIL A CORRECT REPAIR — YOU PROVED THAT WITHOUT RUNNING IT. `B` IS NOT A TEST AT ALL: THE KERNEL SELECTS FROM EXACTLY THE SET `B` TESTS AGAINST, SO BOTH SIDES OF THE CHECK COME FROM ONE LAYER AND `[same-layer-agreement]` SAYS THEIR AGREEMENT IS NOT EVIDENCE.** **🛑 THE ACCEPTANCE IS `PREDICATE C`, AND IT IS THE SAME EVIDENCE CLASS THAT MADE THE DEFECT LEGIBLE IN THE FIRST PLACE: FOR EVERY CHOSEN LOCATION, IS THE LATEST CONSTITUENT PIVOT'S `confirm` AT OR BEFORE THE DECISION'S `ts`? THAT NEVER CALLS THE BUILDER, SO IT CANNOT BE TAUTOLOGICAL; IT PERMITS A `09:15` DECISION TO USE AN `08:45` LEVEL, SO IT CANNOT BE OVER-STRICT; AND IT IS ARITHMETIC ON COMMITTED FIELDS RATHER THAN A RE-INVOCATION OF THE THING UNDER TEST.** **`S:2026-03-30T08:45:00:93755` AT `08:05` FAILS `C` BY READING THE STRING. THAT IS THE INSTRUMENT.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Channel head at drafting:** `29787198`.
**PR #38: DRAFT / DO NOT MERGE. Ruled before the post-repair numbers exist, at the worker's request.**

---

## 1. YOU KILLED YOUR OWN ACCEPTANCE CRITERION BEFORE IT COULD FLATTER YOU

**Predicate `A` — *absent from the `08:00` build* — was correct for a kernel with ONE anchor and is
wrong for a kernel with none.** After the repair a `09:15` decision may **legitimately** use a level
that formed at `08:45`. **`A` scores that AFFECTED and fails a correct repair.** **One of the five
originally-affected decisions is at `09:15`, so this is not hypothetical.**

> ## **A CONVICTING INSTRUMENT IS PRESERVED SO A FIX CANNOT BE PROVED BY A FRIENDLIER TOOL. IT IS NOT PRESERVED SO THAT A REPAIR CAN BE FAILED BY A TOOL THAT NO LONGER DESCRIBES THE SYSTEM. `[red-path-decay]` PROTECTS AGAINST THE FIRST AND SAYS NOTHING ABOUT THE SECOND.**

**Declaring this before the run is what makes it a correction rather than a goalpost move, and the
timing is the whole of the difference.**

## 2. 🛑 AND `B` IS NOT A WEAK TEST — IT IS NOT A TEST

**Your own words, and they are the ruling:** *"post-repair, `B` is close to tautological, because the
kernel now SELECTS from exactly the set `B` tests against."* **Drop the "close to."**

`B` rebuilds the location set at `ts` and asks whether the chosen location is in it. **The kernel
builds the location set at `ts` and chooses from it.** ⇒ **same function, same inputs, same layer, and
a zero is guaranteed by construction rather than earned.**

> ## **`[same-layer-agreement]`: BOTH SIDES OF A CHECK FROM ONE RESEALABLE LAYER ⇒ AGREEMENT IS NOT EVIDENCE. `B` IS A WIRING-CONSISTENCY CHECK. REPORT IT, NEVER RULE ON IT — AND A NON-ZERO `B` WOULD BE A REAL ALARM ABOUT THE PLUMBING, WHICH IS THE ONLY INFORMATION IT CARRIES.**

## 3. **PREDICATE `C` — THE ACCEPTANCE**

> ## **FOR EVERY BULLET, AND FOR EVERY IN-WINDOW DECISION: `max(constituent pivot .confirm) ≤ decision ts`. REQUIRED: `0` VIOLATIONS, ACROSS ALL DECISIONS — NOT ONLY THE FIVE.**

| property | why `C` has it |
|---|---|
| **not tautological** | **it never calls `build_entry_locations_v24`.** It reads the zone's own constituent timestamps. **Different layer.** |
| **not over-strict** | a `09:15` decision using an `08:45` level **passes**, because `08:45 ≤ 09:15`. |
| **it is the property** | ALGO-174 §4 stated *"derivable from bars at or before `T`"*; `C` is that sentence with the field names filled in. |
| **already demonstrated** | `S:2026-03-30T08:45:00:93755` chosen at `08:05` **fails `C` by reading the string.** The instrument is one that has already convicted. |

**REQUIRED WITH IT — a positive control, because `C` is an absence claim** (`[absence-claim]`): **run
`C` against the PRE-REPAIR walk pinned at `e420e3a0` and show it returns exactly the `4 HARD` rows.**
**If `C` cannot re-find the known defect, `C` is broken and its zero means nothing.** ⇒ **that control
is not optional and the verdict does not exist without it.**

**AND REPORT ALONGSIDE, as corroboration and not as verdict:**
1. **`A` restricted to the five originally-affected decisions** — and **report the DISPOSITION of each,
   not a pass/fail**: vanished · same clock different level · same level now legitimately available ·
   moved session. **A trade that disappears cannot be scored by `A` at all, which is exactly why `A`
   is a narrative here and not a criterion.**
2. **`B`**, as the wiring check.
3. **The five pre-registered expectations from ALGO-174 §4**, each answered.

## 4. THE REPAIR ITSELF — RATIFIED, WITH ONE PROOF OBLIGATION

**Rebuilding inside the bucket loop at each decision's own `ts`, with no fixed anchor substituted, is
exactly what was authorized.** **Implementing the naive version because it is the most correct one,
and costing the alternative without adopting it, is the right order** — you did not let a runtime
number choose your semantics.

**🛑 The surviving `09:30` stamp, renamed `warmup_ref`: the restraint is RATIFIED and the CLAIM is
UNPROVEN.** *"It never reaches the location set"* is a **mechanism claim**, and this campaign's rule is
that mechanism claims carry the executable line or an `UNPROVEN` label in the same sentence.
⇒ **prove it by call graph or AST — `warmup_ref` reaches no argument of `build_entry_locations_v24` on
any path — and paste the proof, not the reasoning.** **Leaving it alone is right: moving it changes
WHICH SESSIONS ARE SCOREABLE, which is a different behaviour change and is NOT authorized.**

**Baseline protection ratified.** New file, `algo141` pinned at `e420e3a0` untouched, runner differs by
one line verified by diff. **Overwriting the artifact the defect was measured on, while claiming to
have fixed the defect, is the failure mode — and you named it before I did.**

## 5. THE COST — RULED, BECAUSE IT BLOCKS HIS DESTINATION

**`0.887 s × 96 buckets = 85 s/session` ⇒ `19.9 min` for 14 sessions (fine) and `45.5 HOURS` for
`1,925` sessions (prohibitive).** **The backtest is the operator's stated destination, so this is not
an optimisation nicety — it is the gate.**

**AUTHORIZED, AFTER the acceptance verdict lands and not before:** implement the **15m-close zone
rebuild with per-bucket state re-evaluation**, **on this proof obligation and no other justification:**

> **EXACT MEMBERSHIP EQUALITY WITH THE NAIVE PER-DECISION BUILD, BY KEY, ON ALL 14 SESSIONS AND EVERY BUCKET. NOT A SAMPLE, NOT A COUNT, NOT A SPOT-CHECK — THE SETS ARE EQUAL OR THE OPTIMISATION IS REFUSED.**

**Its licence is a fact about the data — pivots on a 15m frame cannot change between 15m closes — and
NOT a runtime figure.** ⇒ **if the sets are exactly equal it is a memoisation and carries no semantic
change; if they differ anywhere it is a different strategy wearing a speed argument, and
`[precommit-stash]`'s lesson applies: an instrument you cannot prove exact is a writer.** **There is
precedent — a pure-memo `run_day` accel was verified exact before.**

## 6. AUTHORIZED

1. **Finish the acceptance run. Verdict = `C` with its positive control. `A`-on-the-five and `B` are
   reported as corroboration and neither is the verdict.**
2. **Prove the `warmup_ref` isolation by call graph, or label it `UNPROVEN` in the report.**
3. **Then the 15m-close optimisation under §5's exactness obligation.**
4. **STILL NOT AUTHORIZED:** any PnL · any Monte Carlo · any re-score of `-$21,075 / 42%` · any map
   build · any adoption decision inside a result message · moving `warmup_ref`.

---

**LESSON, minted:**

> **THE REPAIR MADE THE OLD TEST WRONG IN BOTH DIRECTIONS AT ONCE: `A` NOW FAILS CORRECT BEHAVIOUR, AND THE OBVIOUS REPLACEMENT `B` PASSES BY CONSTRUCTION. A FIX THAT CHANGES A SYSTEM'S SHAPE CAN INVALIDATE ITS ACCEPTANCE CRITERION, AND THE REPLACEMENT WRITTEN IN THE FIX'S OWN VOCABULARY IS THE ONE MOST LIKELY TO BE TAUTOLOGICAL.**

**The escape is to test the OBJECT rather than the PROCESS.** `A` and `B` both ask the builder what it
would build. **`C` asks the level when it was born** — and that question has an answer stored in the
data, independent of every function the repair touched.

> **WHEN A REPAIR BREAKS ITS OWN ACCEPTANCE TEST, DO NOT REACH FOR THE NEAREST RESTATEMENT. FIND THE FIELD THAT WAS ALWAYS TRUE AND COMPARE AGAINST THAT — AND MAKE THE NEW TEST RE-CONVICT THE OLD DEFECT BEFORE YOU TRUST ITS ZERO.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.*

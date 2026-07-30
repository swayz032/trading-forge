# LEDGER-E PARITY RATIFY PACKET — closing the TS↔Python binding-plan false green · 2026-07-30

> **STAGED, NOT IMPLEMENTED** at the moment of writing. Deliverable of **R-481 §90**.
> **CLASSIFICATION (`ratify-packet`, operator amendment 2026-07-11): the AUTONOMOUS class.**
> `[MEASURED, R-481 §49]` the live library is reachable and **read-only-proven**; `backtests_total = 0`;
> **no funded account is trading.** So this is **NOT** in the irreversible / live-capital class.
> ★★★★★ **THE GATE IS THE INDEPENDENT GRADE — a fresh `accuracy-validator` dispatched by the DESK at
> R-481 §92, adversarially tasked to find another false green. I am the DOER and I do not grade it.**
>
> ★★★ **WHY IT IS INSTRUMENT-TOUCHING:** the binding plan decides `compiled`, which decides whether a
> spec is condition-compiled or queued, and `bindable`/`approximation`, which decide whether a rule is
> reported as CONCRETE. **Its output is a number other decisions trust.**
>
> ★★★★★ **THE PROPERTY THIS PACKET EXISTS TO ESTABLISH, STATED AS A PROPERTY AND NOT A MECHANISM
> (R-481 §90):**
> > **For identical input, TypeScript and Python emit the same COMPLETE normalized binding plan, and no
> > session token is bindable unless the runtime has an evaluable implementation.**

⚠️★★★★★ **REVISED 2026-07-30 AT DELIVERY TIME (R-495 §5A) — SEE `## 8 — DELIVERY ADDENDUM` AT THE END OF
THIS FILE. §1–§7 BELOW ARE THE STAGING-TIME RECORD AND ARE PRESERVED EXACTLY AS WRITTEN BEFORE ANY CODE
EXISTED. NOTHING MEASURED AFTER STAGING HAS BEEN EDITED INTO THEM.** ★★★ **`NEVER BACKDATE AN UPDATE INTO
THE ORIGINAL RECEIPT` — the pre-registrations in §4 are only worth reading if they still say what they
said before the run. Where §4/§6/§7 have been OVERTAKEN by measurement, §8 says so explicitly rather than
silently amending them.**

---

## 1 — WHAT & WHY NOW (receipts, not narrative)

### 1.1 — The defect: a parity gate that certifies its fixture, not its domain

**[MEASURED BY GRADED INSTRUMENT — the desk ran the SHIPPED comparator, R-481 §5 / §44-47.]**
Not a hand-rolled two-lane diff: `check-spec-binding-plan-parity.ts` was pointed at corpora through its
own `TF_SPEC_BINDING_SAMPLES_DIR` override (`:36-38`), so **the production comparison path did the work.**

| command | result |
|---|---|
| `npm run check:spec-binding-plan-parity` (shipped corpus) | `Checked 1 sample specs.` · `PASS: TS and Python binding plans agree on every sample spec.` · **exit `0`** |
| `ls ci/fixtures/spec-binding-parity/` | **ONE** file — `all-families.spec.json`, `1,690` B — against the script's own docstring `:11-13` claiming *"every real sample spec in the **25-sample generalization corpus**"* |
| `TF_SPEC_BINDING_SAMPLES_DIR=<5-fixture corpus> npx tsx scripts/check-spec-binding-plan-parity.ts` | **`FAIL: 2 spec(s)`, exit `1`** — `10-lunch-orphan`: `spine_bound ts=2 py=1` · `bindable ts=true py=false` · `primitive ts="session_windows" py=null` · `approximation ts=false py=true` · `session_zone ts="lunch_blackout" py=null`; `11-premarket-orphan`: same shape, `session_zone ts="overnight"` |
| same run, GREEN members | `00-control-shipped` (untouched) · `20-nyam-evaluable` · `21-fivemin-chart` |
| `TF_SPEC_BINDING_SAMPLES_DIR=<3-spine corpus>` | **`FAIL: 1 spec(s)`, exit `1`** — adds **`compiled: ts=true py=false`** |
| **same-shape NEGATIVE CONTROL** (`ny am` for `during lunch`) | ★★★★★ **GREEN** — the flip is caused by the ORPHAN ZONE, not by fixture shape |

★★★★★ **THE GATE IS NOT BLIND. `bindable`, `session_zone`, `spine_bound` and `compiled` are all in its
compared sets. IT IS SIMPLY NEVER GIVEN THE INPUT.** `A GATE THAT PASSES EVERY FIXTURE IT WAS GIVEN
CERTIFIES ITS FIXTURES, NOT ITS DOMAIN.`

### 1.2 — The three defects, at the executable line (`runtime-production` @ `9af37b8f`)

**F-B — THE TABLES HAVE DIVERGED AND THE TS CAPTION DENIES IT.**

| | `src/server/lib/spec-family-bindings.ts` | `src/engine/spec_family_bindings.py` |
|---|---|---|
| `SESSION_KEYWORDS` | **`:65-73` — SEVEN zones**, incl. `lunch_blackout`, `overnight` | **`:285-291` — FIVE zones** |
| `REFUSED_SESSION_KEYWORDS` | ★★★★★ **ABSENT** (grep exit `1`) | `:309-312` |
| WAIT_SESSION bind path | `:159-160` resolves via the 7-zone table ⇒ **`during lunch` BINDS** | `:572-600` checks `refused_session_zone(obj)` **FIRST** ⇒ `bindable=False`, `primitive=None`, `approximation=True`, `executed=False`, `reason=session_zone_refused_uncomputable_window:<zone>`, `session_zone=None` |
| the caption | ★★★★★ **`:64` — *"mirror `src/engine/spec_family_bindings.py::SESSION_KEYWORDS` EXACTLY"*. IT DOES NOT.** | `:274-279` — *"DELIBERATELY NO LONGER MATCHES … do not resync"*; `:283-284` declares *"it (and the TS mirror) are reported as adjacent work"* |

★★★ **THIS IS A DECLARED, KNOWN, UN-CLOSED CARRY-FORWARD — not a hidden bug.** The Python author
measured it on 2026-07-28 and deferred the TS side to keep that release to one concept.
★★ **PATH NOTE, carried because it cost the desk a false alarm (R-481 §30): the file is
`src/server/lib/`, NOT `src/server/services/`. `LOCATE, DO NOT ASSUME, THE DIRECTORY.`**

**F-G — THE COMPARATOR UNDER-COMPARES WHAT IT COLLECTS.** `:60-84` builds a per-binding record with
**ten** fields (`condition_id · type · role · object · bindable · primitive · approximation · executed ·
reason · session_zone`); the loop at `:131` compares **five** (`condition_id · bindable · primitive ·
approximation · session_zone`). ★★★★★ **`reason`, `type`, `role`, `object`, `executed` are collected and
NEVER COMPARED — including `reason`, the field carrying `no_recognized_session_keyword` vs
`session_zone_refused_uncomputable_window:*`, i.e. the key the entire Gate-B population is defined by.**

**F-A — THE GATE IS NOT CI-WIRED.** `package.json:28` defines `check:spec-binding-plan-parity`;
`.github/workflows/` holds exactly `ci.yml`, `fast.yml`, `metric-snapshot.yml`; a grep across all three
returns **zero matches, exit `1`.** ★★ **FOUR POSITIVE CONTROLS, so this is a measured absence and not a
failed search: `check:ts-python-exit-parity` → `ci.yml:343` · `check:2026-compliance` ·
`check:production-isolation` · `system-map:check` → 2 workflows each.** `EXISTENCE IS NOT WIRING.`

### 1.3 — Why now

★★★★★ **R-481 §81-83 RULED IT A PREREQUISITE, NOT A PARALLEL ITEM.** Gate B's tripwire (R-480 §5-3)
reads `spineBound`, denominator, ratio and `compiled` **record-for-record**. With the lanes diverged and
the gate never fed, **that tripwire's LANE IS UNDEFINED** — computing it in TS while the claim is about
Python is `I MEASURED THE NEIGHBOURING OBJECT`, this campaign's most-convicted failure.
★★★ **And F-G makes R-481's own acceptance criterion circular:** *"refuse identically in both lanes with
the same reason"* is **structurally uncheckable** by today's comparator. **F-G gates the criterion.**

### 1.4 — The semantic direction, ruled

★★★★★ **`TS/PYTHON PARITY IS SEMANTIC OUTPUT PARITY, NEVER TABLE-TEXT EQUALITY` (R-481 §55).**
**PYTHON IS CORRECT. TYPESCRIPT MOVES.** `lunch_blackout` and `overnight` have **no entry in
`session_windows._ZONE_CHECKS`**, so `is_in_killzone()` returns False for **every minute of the day**
(Python `:295-308`: measured `0 of 1440`, against `180 of 1440` for `ny_am`). Binding one produces a rule
that reads *"only trade during X"* and executes as *"never trade"* — **while reporting
`approximation=False`, an exactness claim.**
★★★★★ **FORBIDDEN, EXPLICITLY (R-481 §101): making Python accept an unevaluable orphan zone in order to
turn parity green. That is `NEVER TAKE A REAL RISK TO REMOVE AN APPEARANCE` (invariant #9) in its purest
form — it would convert a loud refusal into a silent never-trade.**

---

## 2 — BLAST RADIUS

### 2.1 — What this INVALIDATES

- ★★★★★ **THE CURRENT ONE-FIXTURE `PASS` — ZERO AUTHORITY, AND R-481 §84 FORBIDS ANY FUTURE RULING FROM
  CITING IT.** Every prior statement of the form "TS and Python binding plans agree" traces to that run.
- **AR-484 §1's *"CONFIRMS the Ledger-E parity gate is REAL and enforced in CI"*** — REFUTED on
  `ENFORCED`, stands on `REAL`. Already corrected in Gate-B packet rev 2 §0.
- **AR-483 §3's *"a one-sided edit fails CI by design"*** — the mechanism it relies on does not run.
- ★★★ **Any Gate-B tripwire figure computed before this closes.** Its lane is undefined.

### 2.2 — Which downstream consumers CHANGE BEHAVIOUR

★★★★★ **THIS IS A REAL BEHAVIOUR CHANGE IN THE TS LANE, NOT A TEST-ONLY FIX. Stated loudly because a
"parity fix" sounds cosmetic and is not.** After the change, a `WAIT_SESSION` clause naming an orphan
zone stops binding in TypeScript. Consequences, traced through the Gate-B packet's own decision graph:

| consumer · tree | before | after |
|---|---|---|
| `spec-family-bindings.ts` `compileBindingPlan` | orphan clause `bindable=true`, counts toward `spineBound` | `bindable=false`, `approximation=true`, `executed=false`, carries a refusal `reason` |
| `spineRatio` / `compiled` | inflated numerator | ★★★ **`compiled` CAN FLIP `true → false`** where the orphan binding was carrying the spec across the `0.5` floor |
| `spec-onboarding-service.ts:454-460` | `conditionCompiled=true` ⇒ route `CONDITION_COMPILED` | may become `false` ⇒ route **`NEEDS_ARCHETYPE`** |
| `:526-530` category | `deriveCategoryFromConditionSpec` | may become `deriveCategoryFromArchetype(null)` — blanket CONTINUATION |
| `playbook_router.py` `allowed_strategies` | one regime set | ★★★ **possibly a different regime set** — F-E: the four lists are consumed individually |
| `scripts/bandc-measure-mapped-queued-split.ts` | a mapped/queued split | **a different split** — ★★ **and this is EXPECTED, not a regression** |

★★★★★ **PRE-REGISTERED, SO IT CANNOT BE RE-READ LATER: `compiled` GOING DOWN IS THIS FIX WORKING.**
A spec that only compiled because an unevaluable zone was counted as bound **was never honestly
compiled.** A HIGHER compiled count after this change is a **FAILURE SIGNAL.** `FIDELITY OUTRANKS COUNT.`
★★★ **AND THE MATERIALITY COUNT RECEIPT IS MANDATORY AT LAND TIME** (extraction-campaign law 5; the
OR-branches incident is the precedent): the exact set of specs whose `compiled`, route or category moves,
enumerated **per spec**, never as a delta.

### 2.3 — What this does NOT touch

- ★★★★★ **THE `C8-EMPTY-SPINE` REFUSAL — UNTOUCHED** (invariant #9).
- **THE FROZEN EVIDENCE BASE** — 40 canonical specs, `eed65514…`, `ad4335f0…`, the 40 transcripts.
  **No backfill, no re-stamping, no re-extraction.**
- **Gate-B treatment code** — no admission-contract change here. **Different packet.**
- **`session_windows.py`** — its own copy of the orphan zones is dormant (`[MEASURED 2026-07-28]`, zero
  non-test callers). ★★ **Named as adjacent, deliberately NOT adopted: `DON'T ADOPT ANOTHER THREAD'S
  QUEUED ITEM`, and widening scope mid-repair is how one concept becomes three.**

---

## 3 — THE EXACT CHANGE, SCOPE-LOCKED

### IN SCOPE

**(a) TS ORPHAN-ZONE REFUSAL, MATCHING PYTHON SEMANTICS.** Add `REFUSED_SESSION_KEYWORDS` +
a refusal-reason helper to `src/server/lib/spec-family-bindings.ts`, checked **BEFORE**
`resolveSessionKeyword` inside the `requiresSessionKeyword` branch — **the same order as Python `:572`,
and scoped INSIDE the session-family branch on purpose** (a refusal in the generic dispatch would also
reject a `FILTER` whose object merely mentions "lunch" — an over-refusal). Emit the identical tuple:
`bindable=false` · `primitive=null` · **`approximation=true`** · `executed=false` ·
`reason=session_zone_refused_uncomputable_window:<zone>` · `sessionZone=null`.
★★★ **`approximation=true`, NEVER false — an exactness claim is precisely what the defect wore. The trio
`bindable=false` + `primitive=null` + `approximation=true` is what keeps the row out of the concrete
count; change any one and the false concrete returns.** (Python's own comment, `:584-590`.)
**And REMOVE the two orphan zones from the TS `SESSION_KEYWORDS` table, and CORRECT the `:64` caption**
so it describes the real contract rather than denying the divergence.

**(b) COMPLETE NORMALIZED-PLAN COMPARISON — NOT ANOTHER HAND-PICKED FIELD LIST.**
★★★★★ **THE LOAD-BEARING REQUIREMENT. R-481's STOP CONDITION NAMES "another hand-selected
comparison-field list" AS A HALT.** So the comparator must not enumerate fields at all: it must
canonicalize both plans into one normalized structure and compare them **whole** — deep equality over
the full object, with **key-set equality asserted in BOTH directions**, so a field ADDED to either lane
and not the other is itself a drift. **A new field must be a NEW DRIFT by default, never a silent pass.**
**EXPLICITLY IN THE COMPARED SURFACE (R-482 correction 3), because each was omitted by the old
five-field loop:** every per-binding field incl. **`reason`** · **array MULTIPLICITY** (not just length —
a reordered or duplicated binding must not compare equal) · **`invalidations` bindings**, which the old
comparator never reached · **queue reasons** · **duplicate-`condition_id` detection.**

**(b2) ★★★★★ A SEMANTIC EXPECTED-RESULTS ORACLE, INDEPENDENT OF BOTH IMPLEMENTATIONS (R-482 correction 3).**
**THIS IS THE DIFFERENCE BETWEEN *"THE TWO LANES AGREE"* AND *"THE TWO LANES ARE RIGHT".`** A whole-plan
diff can only ever prove agreement — **two identically-wrong lanes compare equal.** So each fixture
carries a hand-authored expected plan derived from the **SOURCE CONTRACT**, not from either lane's output.
★★★★★ **AND THE TRAP THAT MAKES THIS DELICATE: copying either lane's emitted JSON into the expected
table is `HARDCODED TEST COPY IS A FABRICATED SAFETY CLAIM` — it would look like an oracle and assert
nothing.**

> ⚠️★★★★★ **STRICKEN 2026-07-30 by R-483 §8-2 — PRESERVE-AND-STRIKE, NOT OVERWRITTEN. THE
> WRONG WORDING IS RETAINED BELOW SO THE AUDIT TRAIL SHOWS WHAT WAS ORDERED AND WHEN.**
> ~~*"The expected values must be reasoned from the contract (`FAMILY_META` semantics + the
> evaluable-zone rule) and must be reviewable line by line against it."*~~
> ★★★★★ **WHY IT IS WRONG — AND IT IS CIRCULAR, NOT MERELY VAGUE. [MEASURED BY THE DESK,
> R-483 §5, `runtime-production` @ `9af37b8f`, at the executable line] BOTH HALVES OF THAT
> NAMED AUTHORITY ARE CODE ON THE PARITY SURFACE:**
> - **`FAMILY_META` IS NOT A CONTRACT.** It is a literal defined in **both lanes'
>   implementation files** — `spec-family-bindings.ts:87` and `spec_family_bindings.py:341`.
>   **Those two files ARE the surface under test.** The instruction cannot even say WHICH copy.
> - **THE "EVALUABLE-ZONE RULE" RESOLVES TO THREE FILES THAT ALREADY DISAGREE:**
>   `session_windows.py:171-172` lists both orphan zones in its lookup ·
>   `spec_family_bindings.py:309-311` holds them in `REFUSED_SESSION_KEYWORDS` ·
>   `spec-family-bindings.ts:71-72` holds them **in its BINDABLE table — the divergence this
>   packet exists to repair.** `spec_family_bindings.py:276-277` records the split in writing.
> ★★★★★ **`AN ORACLE DERIVED FROM THE IMPLEMENTATION IT JUDGES IS A THIRD MIRROR, NOT
> INDEPENDENT TRUTH.`** An oracle built on that wording would have asserted only *"the code
> agrees with the code"*, while carrying an independence claim in its name — **a stronger
> false-safety shape than the five-field loop it was meant to replace, because it would have
> looked like the fix.**
> ★★★ **AND THIS SEAT WAS ONE STEP FROM SHIPPING IT.** AR-491 §51-52 pre-committed to
> deriving rows *"from the session-window semantics"* — **which R-483 §64 names as pointing at
> one of the three disagreeing files.** The instinct (author before observing, never adjust a
> row to match output) was right; **its named source was not.** `NAMING AN AUTHORITY IS NOT
> CHECKING WHERE IT LIVES — OPEN THE FILE.`

★★★★★ **REPLACEMENT REQUIREMENT, BINDING (R-483 §8-1): PER-ROW NORMATIVE CITATION.**
**Every expected value in the oracle MUST cite a normative authority that lives OUTSIDE both
emitted plans, and the citation is part of the row — a row without one is not an oracle row and
must not be written.** ★★★★★ **AND WHERE NO SUCH AUTHORITY EXISTS, THE DESK AUTHORS AND FREEZES
IT — NOT THE IMPLEMENTER (R-483 §9).** A missing authority is a **STOP**, never a licence to
reason one out from the code that happens to be nearby.
★★★★★ **CURRENTLY HELD ON EXACTLY THIS GROUND: THE ORPHAN-ZONE ROWS (`lunch_blackout`,
`overnight`).** R-483 §5 measured that no independent authority for them exists anywhere in the
codebase, so R-483 §9 makes the frozen row-by-row table a **DESK DEBT owed before the oracle can
close.** ★★ **UNTIL IT LANDS AND IS HASHED, ORPHAN-ZONE ORACLE ROWS DO NOT EXIST AND MUST NOT BE
GUESSED.** The normative proposition the desk will freeze under is a claim about MEANING,
derivable without opening either lane — **which is precisely what makes it admissible**: *a
session predicate naming a zone with no computable window cannot be evaluated; binding it yields
"only trade during X" executing as "never trade" while reporting `approximation=false`.*
★★★ **ADMISSIBLE CITATION CLASSES** (each external to both plans): the frozen desk adjudication
above · a dated ruling's explicit normative statement · published CME/exchange session
definitions for a wall-clock zone · the source transcript's own words for a spec-level claim.
★★★ **INADMISSIBLE, NAMED SO THE IMPLEMENTER CANNOT DRIFT: `FAMILY_META` (either copy) ·
`session_windows.py` · `spec-family-bindings.ts` · `spec_family_bindings.py` · either lane's
emitted JSON · this packet's own prose restating any of them.**
★★ **STOP CONDITION, RESTATED HERE SO IT SITS WITH THE REQUIREMENT (R-483 §105): an oracle row
citing any inadmissible source above is a HALT, and so is a row whose value was adjusted after
an implementation output was observed.**

**(c) EXHAUSTIVE MEMBERSHIP FIXTURES.** Every condition family in `FAMILY_META` × every evaluable zone ×
every refused zone, plus the unbindable-in-both control and the shipped fixture untouched.
★★★★★ **AND A MEMBERSHIP ASSERTION, because R-481's acceptance list requires that deleting any required
fixture turns the check RED: the corpus is declared, and a missing member DENIES the claim rather than
shrinking the denominator.** `A SURFACE IS NOT FAIL-CLOSED UNTIL ITS ENUMERATION IS` (R-474's minted law) —
**this is the same defect class that retired `absence_claim_control.py`, and I am not rebuilding it.**

**(d) CI **AND** FAST-LANE WIRING.** `check:spec-binding-plan-parity` runs in `ci.yml` **and** `fast.yml`.
★★ **Both, per R-481 §91 — CI alone was the shape that let this rot.**

### OUT OF SCOPE (named so the implementer cannot drift)

★★★★★ **CHANGING PYTHON TO ACCEPT AN ORPHAN ZONE — FORBIDDEN (R-481 §101).**
Also OUT: `session_windows.py` · Gate-B admission-contract code · the empty-spine refusal ·
`c8_provenance_ledger.py` · any DB / spec / frozen-artifact write · any backtest · any re-extraction ·
any edit to `runtime-production` or `tf-deep-scan` **directly** · `MIN_SPINE_BOUND_RATIO`'s VALUE (the
`0.5` floor is not this packet's question) · `FAMILY_META`'s primitive assignments.
★★ **`spec_family_bindings.py` is editable ONLY if contract alignment genuinely requires it (R-481 §100).
My current expectation is ZERO Python change; if that changes, it is a finding I report, not a silent widening.**

---

## 4 — VERIFICATION PLAN

### 4.1 — Red-proof, both halves, pre-registered BEFORE the run

★★★ **Every fixture's expected exit code is written down before it executes — a code chosen after the
fact is not a prediction.**

| # | fixture / mutation | pre-registered expectation |
|---|---|---|
| 1 | `during lunch` WAIT_SESSION, 2-spine | **GREEN after fix** (both lanes refuse identically). **RED before fix** on 5 fields |
| 2 | `premarket` WAIT_SESSION | **GREEN after / RED before**, `session_zone ts="overnight"` |
| 3 | 3-spine orphan (the `compiled`-flip shape) | **GREEN after / RED before** incl. `compiled: ts=true py=false` |
| 4 | `ny am` — evaluable zone | **GREEN before AND after** — the discriminating control; a fix that refuses everything is not a repair |
| 5 | `five-minute chart` — unbindable in both | **GREEN before AND after** |
| 6 | shipped `all-families.spec.json`, untouched | ★★★★★ **GREEN before AND after — non-negotiable** |
| 7 | ★★★★★ **REASON-ONLY mutation** — perturb only the refusal `reason` string in one lane | **RED.** ★★★ **THIS IS THE F-G RED-PROOF: today it passes, because `reason` is never compared. If it does not go RED after the change, F-G IS NOT CLOSED and the packet's central claim is unproven** |
| 8 | **field-ADDITION mutation** — add a field to one lane's plan only | **RED** (key-set equality, both directions) |
| 9 | **MEMBERSHIP mutation** — delete a required fixture from the corpus | **RED**, naming the missing member |
| 10 | full unmutated corpus | **GREEN, exit `0`** — the control that makes 7/8/9 diagnostic rather than "always red" |

★★★★★ **DISCRIMINATION REPORTED IN BOTH HALVES: the mutation goes RED **and** the unmutated control stays
GREEN, both published. A mutation suite without its control cannot tell "catches breakage" from "always red".**
★★★ **AND A NEGATIVE ASSERTION NEEDS A POSITIVE WITNESS: "the orphan zone no longer binds" is satisfied by
a function that does nothing. Fixture 4 proves the session-binding path still RUNS and still binds.**

### 4.2 — Wiring proof

`grep` for `check:spec-binding-plan-parity` in `ci.yml` **and** `fast.yml` returning a hit is **necessary
and not sufficient** — ★★ **F-A was exactly a name that existed in one file and executed in none.**
The proof is an **observed non-zero exit in the pipeline on a deliberately drifted corpus**, then green
on the real one.

### 4.3 — The grader, and the restriction trap

**Independent grader: a FRESH `accuracy-validator`, dispatched by the DESK (R-481 §92).**
★★★★★ **NEITHER THE DESIGNER NOR THE BUILDER MAY GRADE. I am the builder; I hand over a frozen commit
and a working access recipe, never a score.**
★★★★★ **`A RESTRICTION IN THE GRADER'S BRIEF IS A HOLE IN THE RESULT.`**

| if the brief withholds | which claim dies |
|---|---|
| **Python execution** | **the entire parity claim** — one lane cannot demonstrate two-lane agreement |
| the `TF_SPEC_BINDING_SAMPLES_DIR` override recipe | the false-green reproduction; the grader is left with the one-fixture `PASS` that has zero authority |
| permission to author its OWN fixtures | ★★★★★ **the whole point.** `REGISTERED-FIXTURE CLOSURE ESTABLISHES NOTHING ABOUT UNREGISTERED SHAPES` — three consecutive rounds of that on `absence_claim_control.py` |
| repo-wide grep (CI files included) | the F-A wiring claim |

★★ **The honest null is a complete answer: *"no refutation found, here is what I covered and what I could
not."*** ★★★ **ASK IT EXPLICITLY TO HUNT A SIXTH FALSE GREEN.** The retired absence suite went
`9/9 → 17/17 → 6/6` green while the law kept holding — **the suite shrank and the defect survived.**

---

## 5 — ROLLBACK

### ★★★★★ THERE IS NO FLAG. THE CORRECTION SHIPS UNCONDITIONALLY. (R-482 correction 1)

★★★★★ **`YOU DO NOT FLAG-GATE A CORRECTNESS REPAIR. THE OFF BRANCH IS THE DEFECT.`**
**`TF_TS_ORPHAN_ZONE_REFUSAL_ENABLED` IS REMOVED FROM THIS PACKET.** Rev 1 of this file proposed it
default-ON "as the documented one-line rollback". ★★★★★ **THAT WAS A DEFECT, AND ITS FALSE CAPTION —
*"the flag gates the FEATURE, never the FIX"* — HAS BEEN DELETED RATHER THAN REWORDED, because the thing
behind the flag WAS the fix.** With the flag OFF, TypeScript resumes binding `lunch`/`overnight` while
Python still refuses them: **the lanes are divergent again and CI, running default-ON, is green
throughout. THE OFF STATE WOULD HAVE BEEN A PRODUCTION MODE NO PROOF COVERS.**
★★★ **AND THE EVIDENCE THAT IT WAS BROKEN ALREADY EXISTED WHEN IT WAS PROPOSED: the RED baseline in
`ci/fixtures/spec-binding-parity-expanded/` IS the OFF state, measured and committed.**
★★★★★ **MINTED INVARIANT (R-482 §47), NOW BINDING ON THIS PACKET: `A CORRECTNESS REPAIR SHIPS
UNCONDITIONALLY. ROLLBACK IS REVERT. IF AN EMERGENCY SWITCH IS RETAINED IT MUST HALT OR QUARANTINE,
NEVER RESTORE THE DEFECT.`**

- **ROLLBACK = `git revert` of the single parity commit.** The change is **additive** in TS (a refusal
  table + a branch ahead of an existing resolver) plus a comparator rewrite plus two CI lines.
  **No historical artifact is mutated, so revert restores prior behaviour exactly.** There is no partial
  rollback and no runtime switch.
- ★★★ **IF AN EMERGENCY SWITCH IS EVER ADDED, ITS OFF STATE MUST HALT OR QUARANTINE ONBOARDING — NEVER
  RESTORE DIVERGENT BINDING.** A switch that can run the known-wrong behaviour multiplies production
  modes and the proof covers only one of them. **The comparator's completeness and the CI wiring are
  likewise unswitchable — a gate you can silently disable is not a gate.**
- ★★★★★ **EVERY RECEIPT THIS WORK EMITS NAMES THE EFFECTIVE CONFIGURATION** — so no future reader has to
  infer which mode produced a number.
- **No frozen artifact, DB row, or emitted spec is written by this change.** Nothing to un-write.
- **No live default in effect during live trading is altered** — `backtests_total = 0`, nothing live.
- ★★ **The materiality receipt is what makes revert an informed choice rather than a panic:** it names,
  per spec, every `compiled` / route / category movement **before** anyone decides to keep it.
  ★★★★★ **A HIGHER `compiled` COUNT AFTER THIS CHANGE IS A FAILURE SIGNAL.**

---

## 6 — LANE, PIN, AND WHAT I HAVE NOT DONE

**IMPLEMENTATION LANE:** a **NEW isolated worktree** pinned to `runtime-production`'s then-current SHA,
recorded here per R-481 §91:
> ★★★★★ **PIN = `9af37b8ff36a13c05fb0ec26752c42a97fc300d7`**
> `[MEASURED HERE]` `git rev-parse HEAD` in `trading-forge/runtime-production`;
> `9af37b8f 2026-07-29 "Fix Night Desk language and embedded room sizing"`;
> branch `hardening/slumhouse-shared-office-parity-20260723`.

★★★ **PINNED TO AN EXPLICIT SHA, NOT A BRANCH NAME** — a branch-name base tracks a moving shared HEAD
(CLAUDE.md §11b rule 2, the Deep-Scan #16 incident). **NEVER `git stash` in the worktree** (`refs/stash`
is shared). **`runtime-production` and `tf-deep-scan` are NOT edited directly.**

### `[UNPROVEN / NOT DONE]` at packet-staging time — stated because a partial that reads as complete is this campaign's most-convicted shape

- **No code written yet.** Every §4 expectation is a **PRE-REGISTRATION**, not a result.
- **`[UNVERIFIED HERE — RELAYED]`** Python's exact reason string. **Structurally unprintable until F-G
  closes** — which is why fixture 7 is the packet's central red-proof rather than a nice-to-have.
- ★★★★★ **`[UNMEASURED]` — POPULATION INCIDENCE.** How many real specs in the source-keyed Gate-B
  population actually contain an orphan-zone `WAIT_SESSION` clause. **Every claim above is a MECHANISM
  proven at the executable line; the incidence is the number that decides THEORETICAL vs LIVE**, and
  R-481 §93 sequences it AFTER a SOUND grade. **I am not merging the two.**
  ★★ **A bound, not a measurement: all `232` C8-ANNOTATION rows carry `no_recognized_session_keyword`, a
  label neither lane emits for an orphan-zone phrase. That this implies token-absence in all 232 is
  `[HYPOTHESIS, UNTESTED]` — it holds only if the census producer ran one of these two code paths, and
  that producer (`pop120_census.py`) is unrecoverable.**
- **`[UNVERIFIED]`** whether the Band-C instrument's hardcoded `extraction-100` path still names the
  intended population.
- **`[NOT RE-MEASURED BY ME]`** `playbook-registration.ts` internals — carried from AR-483. The §2.2
  category-consequence row inherits that limitation.
- **No independent grade exists**, because no repair exists yet. ★★ **The desk dispatches it; I do not.**

---

## 7 — ACCEPTANCE COMMANDS (R-481 §105, restated as the contract I will be held to)

1. `during lunch` **and** `premarket` refuse identically in **BOTH** lanes **with the same reason**
   — ★★★ **requires F-G closed first, and fixture 7 is what proves it.**
2. `ny am` remains **bindable** in both.
3. `five-minute chart` remains **unbindable** in both.
4. **A REASON-ONLY mutation turns parity RED.**
5. **Deleting any required fixture turns MEMBERSHIP red.**
6. **The FULL normalized plan compares equal — not a selected subset.**
7. The gate **executes in CI *and* fast lane.**
8. **Unmutated controls stay GREEN.**
9. **The shipped `all-families.spec.json` still passes.**
10. **An independent grader re-derives through two non-overlapping paths.**

★★★★★ **AND THE SENTENCE THIS PACKET WILL NOT WRITE: that a green parity run proves the lanes are
equivalent. It proves the lanes agree ON THE CORPUS THEY WERE GIVEN. The membership assertion (3c) and
the grader's own fixtures (4.3) are what carry the claim past its fixtures — and `A PARITY GATE THAT
PASSES ITS FIXTURE WHILE ITS DECLARED DOMAIN CONTAINS A COUNTEREXAMPLE IS A FIXTURE DEMO, NOT A PARITY
GATE.`**

---

# ★★★★★ 8 — DELIVERY ADDENDUM · ADDED 2026-07-30 AT DELIVERY TIME (R-495 §5A)

> ★★★★★ **THIS IS AN ADDENDUM, NOT A REWRITE.** §1–§7 are the pre-implementation record. Every value in
> §8 was **re-derived by the builder in the parity worktree at `3dcc6739`** for this addendum — not
> copied from a ruling, a report, or an earlier session's number. ★★★ **`A NUMBER CARRIED ACROSS A FIX IS
> STALE EVEN WHEN THE WORDS AROUND IT ARE FRESH.`**
>
> ★★★★★ **THE BUILDER WROTE THIS AND THE BUILDER DOES NOT GRADE IT.** §8.9 states, without softening,
> that the independent grade **does not exist**.

**LANE:** `C:/Users/tonio/Projects/wt-ledger-e-parity-20260730`, branch `hardening/ledger-e-parity-20260730`.
**BASE PIN:** `9af37b8f` — `[MEASURED HERE]` `git merge-base --is-ancestor 9af37b8f 3dcc6739` → **true**.
**WIP HEAD:** `3dcc6739`. **REVIEWED NET DELTA:** `[MEASURED HERE]` `git diff --stat 9af37b8f..3dcc6739` =
**`22 files changed, 2477 insertions(+), 81 deletions(-)`**; the sorted 22-path list hashes to
`9057df03531ff94cbb5f55a5ab3c6a2dc9ee6a662c5bf9ab3c2c4439c8e530e6`.

---

### 8.1 — THE AUTHORITY IS READ AND HASHED AT RUN TIME, AND IT FAILS CLOSED

★★★★★ **The oracle no longer asserts its own freshness. `scripts/check-spec-binding-plan-parity.ts`
imports `createHash` (`:46`), reads the frozen authority declared by `ORACLE.json`, computes its SHA-256
(`:873`) and compares it to the pinned value. `A VALUE A FILE ASSERTS ABOUT ITSELF IS NOT A CHECK` (`:806`).**

| | `[MEASURED HERE]` |
|---|---|
| authority file | `docs/designs/ORACLE-AUTHORITY-ORPHAN-ZONES-2026-07-30.md` |
| its sha256, computed from bytes | **`3494d4bbe6f10a9da3c6d79d594212b5542f904bae17209cfe3d68c0ea2214e2`** |
| where pinned | `ci/fixtures/spec-binding-parity-expanded/ORACLE.json:21-22` (`authority_file` · `authority_sha256`) |
| `ORACLE.json` sha256 | `4fee4e1d9eb1d7da1568e83b9a3c337a5e2fc67ee9676d4086109ee3d30c7300` |

**FOUR FAIL-CLOSED CASES, each an explicit `AUTHORITY FAILURE` at the executable line — not a warning:**
`:842` no `authority_file` declared · `:849` `authority_sha256` absent or not 64-hex · `:863` the
declared authority cannot be read · `:876` computed hash ≠ pinned hash.
★★★ **AND THE LINE THE RECEIPT PRINTS WAS CHANGED TO REPORT WHAT THIS PROCESS COMPUTED, NOT WHAT
`ORACLE.json` CLAIMS (`:1056`, `:1064`).** A receipt that echoes the asserted value cannot distinguish a
verified pin from a copied one.
★★ **RESIDUAL, NAMED AND NOT IMPLIED (carried from `ORACLE.json:27`): the check is hermetic ABOUT THIS
TREE.** It proves the committed authority copy matches the pin; it **cannot** see the campaign-tree
original drifting away from both. **Binding on the desk: any future amendment re-encodes the parity copy
AND this pin in the same motion, or this gate's green is VOID until it does.**

### 8.2 — THE P-7 OVER-REFUSAL PROPERTY, ASSERTED OVER A POPULATION RATHER THAN A FIXTURE

★★★★★ **P-7 is checked as a PROPERTY over the full non-session family × refused-phrase grid in BOTH
lanes (`:571`, `:609`), not as a hand-picked row.** The property it actually asserts is **INDEPENDENCE**:
a non-session family's evaluability must not move because a session zone was refused (`:717-744`,
`[authority §4d / P-7]`).

**Its own preconditions fail closed, which is what stops the property from passing vacuously:**
`:633` the declared population changed → **MEMBERSHIP FAILURE** · `:651` a probe phrase no longer names a
refused zone → **PRECONDITION FAILURE** · `:659` the NEUTRAL twin now names a refused zone →
**PRECONDITION FAILURE** · `:708`/`:713` a generated probe or its neutral twin is missing from the plan.
★★★ **POSITIVE CONTROL INSIDE THE PROPERTY (`:755`, `:761`, `:775`): a `WAIT_SESSION` row carrying the
SAME text must still be refused, and must be DISCRIMINABLE from the non-session row.** Without it,
"nothing over-refuses" is satisfiable by a check that reaches nothing.
★★ **P-7 failures are counted into `oracleFailures`, reported SEPARATELY from agreement failures
(`:960-978`, `:1107`) — see §8.4. `AGREEMENT IS NOT A DEFENCE` (`:617`).**

### 8.3 — WHOLE-PLAN, BIDIRECTIONAL, WITH ITS OWN PLANTED SELF-CONTROLS

**CLAIM 1 is a whole-plan structural comparison (`:252-288`), not a selected subset:**
- **BIDIRECTIONAL key-set equality** (`:266-271`) — a field present in either lane and absent in the
  other is itself drift. ★★ **`A NEW FIELD IS A NEW DRIFT BY DEFAULT.`**
- **Arrays compare ELEMENTWISE AT INDEX** (`:277-283`) — length equality alone was the old gate's blind
  spot, so a reorder is not a no-op.
- **Duplicate `condition_id` is checked PER LANE, not as a diff** (`:290-305`). ★★★ **`TWO LANES
  AGREEING ON A DUPLICATE IS STILL A DEFECT` — a diff-only check would call that green.**

★★★★★ **AND THESE ARE RED-PROOFED IN-RUN BY PLANTED SELF-CONTROLS, EACH WITH ITS CLEAN NEIGHBOUR — so a
detector that stopped detecting fails loudly instead of passing quietly (`:506-568`):**

| axis-4 self-control | planted | clean neighbour |
|---|---|---|
| **D-1 duplicate id** | duplicated `condition_id` must be **DETECTED AND NAMED** (`"PLANTED_DUP", 2x`) — `:520` *"a detector that cannot name what it caught is half a green"* | same-shape plan with DISTINCT ids must be **SILENT** (`:527`) |
| **D-2 MULTIPLICITY** | element duplicated → comparator must report `length ts=2 py=3` (`:537-538`) | — |
| **D-2 ORDER** | same elements swapped → comparator must report a `condition_id` divergence (`:539-540`). ★★ **`A REORDER IS NOT A NO-OP`** | two IDENTICAL plans must produce **zero** output (`:553-562`) — *"a comparator that reports drift on identical input makes every drift it reports uninterpretable"* |

★★★ **All planted IN-RUN on synthetic plans. NO CORPUS MEMBER IS LEFT PERMANENTLY INVALID (`:564-567`) —
this closes R-488 §3's two `[UNPROVEN]` checks.**

### 8.4 — THE 14 UNADJUDICATED CELLS, ENUMERATED — AND AGREEMENT ≠ CORRECTNESS

★★★★★ **THE GATE REPORTS TWO CLAIMS SEPARATELY AND REFUSES TO LET ONE STAND IN FOR THE OTHER
(`:1076`, `:1107`): `AGREEMENT ok / CORRECTNESS failed` is a REACHABLE STATE, printed as such.** Where no
external authority adjudicates a value, the oracle must say so — a field may not be both expected and
declared-unadjudicated (`:336`, enforced at `:433`), and an omission with no stated reason is itself a
failure (`:397-401`). ★★ **A fixture with no oracle row cannot pass (`:385`, `:941`).**

**`[MEASURED HERE]` — enumerated from `ORACLE.json`, 14 condition-level cells across 6 fixtures:**

| fixture | condition · field(s) | n |
|---|---|---|
| `00-control-shipped.spec.json` | `unknown-session` · `approximation` | 1 |
| `21-fivemin-chart.spec.json` | `sess` · `approximation` | 1 |
| `30-compiled-flip.spec.json` | `third` · `approximation` | 1 |
| `31-flip-neg-control.spec.json` | `third` · `approximation` | 1 |
| `40-overrefusal-boundary.spec.json` | `filter_lunch` · `bias_overnight` · `retest_midday`, each `primitive` + `session_zone` + `approximation` | 9 |
| `50-family-axis-invalidations.spec.json` | `inv_in_entry` · `bindable` | 1 |
| **total** | | **14** |

**Plus 1 `scalars_unadjudicated` and 2 `conditions_unadjudicated` plan-level declarations, printed at
`:1072-1076` under `DECLARED ORACLE COVERAGE GAPS (agreement still enforced on these; CORRECTNESS is
not)`.** ★★★ **`required_members` = 12 — and the membership manifest is DELIBERATELY WIDER than the
oracle's adjudicated surface. The gap is DECLARED AND PRINTED ON EVERY RUN, not inferred from a blank.**

### 8.5 — CI + FAST-LANE WIRING, AND THE F-A SHAPE IT CLOSES

★★★★★ **THIS IS THE ONE WHERE "THE NAME EXISTS" WAS NEVER THE CLAIM.** `[MEASURED HERE]` at base
`9af37b8f`: the npm script `check:spec-binding-plan-parity` **already existed** (`package.json:28`) and
executed in **NEITHER** workflow — `ci.yml` **0** references, `fast.yml` **0**. ★★★ **POSITIVE CONTROL:
the same grep finds `20` `npm run` lines in base `ci.yml`, so the search reaches and the absence is
real.** **That is F-A exactly: a name that existed in one file and ran in none.**

**NOW:** `.github/workflows/ci.yml:370` and `.github/workflows/fast.yml:153`, both `run: npm run
check:spec-binding-plan-parity`.
⚠️★★★ **DECLARED GAP, NOT PAPERED OVER: the materiality receipt emitter is NOT wired into either
workflow** — `[MEASURED HERE]` `grep -c materiality` in `ci.yml` and `fast.yml` = **0** in both. It is a
**generated delivery artifact run by hand**, not a standing CI gate. **Its non-zero exit (§8.6) protects
the run that produces the receipt, and nothing else.** ★★ **A grep hit was never sufficient here and it
is not sufficient now: the pipeline claim is only closed by an OBSERVED non-zero exit in the pipeline,
which `[UNPROVEN]` this tree has not produced — no pipeline run exists (§8.9).**

### 8.6 — THE MATERIALITY CONTROL: REACHABLE WITNESS **AND** ENFORCEMENT

**The receipt's failure signal has three parts and `[MEASURED HERE]` all three are present in
`scripts/materiality-receipt-ledger-e.ts`:**

| part | evidence |
|---|---|
| **REACHABLE** | `ci/fixtures/materiality-control/00-compiled-false-baseline.spec.json` — **OUTSIDE** the 12-spec efficacy population, which cannot produce a `false→true` transition at all. The control's own `false→false` baseline is asserted (`:211-215`), so a control that quietly stopped licensing anything fails loudly. ★★★ **It is built from `EXCEPTION`/`unsupported: true` — a reason THE REPAIR DOES NOT OWN. `A CONTROL MUST NOT BE ENTANGLED WITH THE THING IT MEASURES.`** |
| **DETECTED** | the transition is identified and the control **NAMED BY FILE** (`:216-222`, `FORBIDDEN compiled TRANSITION false→true`) |
| **STOPS THE RUN** | ★★★★★ **`process.exit(1)` at `:244`, inside `if (violations.length > 0)` (`:241`)** — plus `:200`, which exits non-zero when the control directory is EMPTY, because a PASS with no reachable witness is unfalsifiable |

⚠️★★ **PRECISION, BECAUSE THE COUNT ITSELF WAS ONCE THE DEFECT: the token `process.exit` appears `3`
times in that file — `:192` is a COMMENT, `:200` and `:244` are EXECUTABLE. The enforcement claim rests
on the two executable lines, read, not on the token count.** `A GREP MATCHING A COMMENT IS NOT A
VERIFICATION.` **At R-494 the same file contained `0`; it printed `STOP AND FILE IT` and returned `0`.
`A DECLARED FAILURE SIGNAL THAT RETURNS SUCCESS IS NOT A GATE.`**
★★★★★ **AND THE CRITERION IS UNCHANGED IN DIRECTION: `A HIGHER compiled COUNT AFTER THIS CHANGE IS A
FAILURE SIGNAL.` The main 12-spec receipt moved `12 → 11`.**

### 8.7 — ROLLBACK, RESTATED AGAINST WHAT WAS ACTUALLY BUILT

★★★★★ **§5's ruling holds and the delivered tree obeys it: THERE IS NO FLAG. `[MEASURED HERE]`
`TF_TS_ORPHAN_ZONE_REFUSAL_ENABLED` appears **0** times in the 22 delivered paths.**
- **The correction ships UNCONDITIONALLY.** `YOU DO NOT FLAG-GATE A CORRECTNESS REPAIR — THE OFF BRANCH
  IS THE DEFECT.`
- **ROLLBACK = `git revert` of the single delivery commit.** No historical artifact, DB row, frozen spec
  or emitted receipt is mutated by this change, so revert restores prior behaviour exactly. There is no
  partial rollback and no runtime switch.
- **NO SWITCH MAY RESTORE DIVERGENCE.** If an emergency switch is ever added, its OFF state must **HALT
  OR QUARANTINE** onboarding — never resume divergent binding. **The comparator's completeness and the
  CI wiring are likewise unswitchable: a gate you can silently disable is not a gate.**
- **Nothing live is altered** — `backtests_total = 0`, no funded account trading.

### 8.8 — THE GRADER'S RE-PLANT LIST (R-495 §4) — DISPATCHED BY THE DESK, NOT BY ME

**FIVE independent re-plants, plus a novel hunt. Named here so the grader does not have to re-derive the
attack surface, and so a short brief is visibly a short brief:**
1. **two-lane `C4`** — re-plant it and confirm RED in BOTH lanes.
2. **all four authority fail-closed cases** (§8.1: missing `authority_file` · malformed
   `authority_sha256` · unreadable authority · hash mismatch).
3. **`D`'s detector-reports-on-everything** — the duplicate-id / multiplicity / order self-controls with
   their clean neighbours (§8.3).
4. **`E-2` ratio loosening** — the materiality control's `false→true` transition, asserting the **exit
   code**, not the banner (§8.6).
5. **ONE NOVEL FALSE-GREEN HUNT** of the grader's own design.

★★★★★ **THE BRIEF MUST CARRY A WORKING ACCESS RECIPE, NOT PROHIBITIONS. `A RESTRICTION IN THE GRADER'S
BRIEF IS A HOLE IN THE RESULT` (§4.3 lists which claim dies for each withheld capability — Python
execution, the `TF_SPEC_BINDING_SAMPLES_DIR` override, permission to author its OWN fixtures, repo-wide
grep).** ★★★ **THE HONEST NULL IS A COMPLETE ANSWER. The agent is `accuracy-validator`, it is dispatched
by the DESK, and its agent id is named in the consuming ruling.**

### 8.9 — ★★★★★ STATUS, STATED SO A PARTIAL CANNOT READ AS COMPLETE

| | state |
|---|---|
| **WIP evidence** | ✅ **EXISTS** — steps A–E, in the parity worktree at `3dcc6739` |
| **FINAL DELIVERY OBJECT** | ❌ **DOES NOT EXIST** at the time this addendum is written (R-495 §5B is the next step) |
| **§5C re-verification against the SHIPPED tree** | ❌ **NOT RUN** — `VERIFY THE TREE YOU SHIP, NOT THE ONE YOU BUILT` |
| **INDEPENDENT GRADE** | ❌ **DOES NOT EXIST, AND NONE IS DUE** until the delivery object exists AND §5C passes on it |

★★★★★ **STILL `[UNMEASURED]`, CARRIED FORWARD FROM §6 AND NOT QUIETLY RETIRED: POPULATION INCIDENCE —
how many real specs in the source-keyed Gate-B population actually contain an orphan-zone `WAIT_SESSION`
clause. Everything above is a MECHANISM proven at the executable line. THE INCIDENCE IS THE NUMBER THAT
DECIDES THEORETICAL vs LIVE, and it has not been measured.**
★★★★★ **AND THE SCOPE SENTENCE A TIRED SESSION WOULD DROP: this closes a PREREQUISITE. It leaves P0 at
its final assembly step. It does not complete the compiler, does not produce a trading-ready strategy,
and P1–P3 and Gate B still follow. `A PREREQUISITE CLOSING IS NOT THE PHASE EXITING.`**

⚠️★★★★★ **§8 IS SUPERSEDED IN PART BY §9 BELOW. THE DELIVERY IT DESCRIBES — `2011e8de` — WAS GRADED
`NOT-SOUND` AND IS NOT RATIFIED. §8 IS RETAINED UNCHANGED AS THE REJECTED RECEIPT. DO NOT READ IT AS THE
CURRENT STATE.**

---

# ⚠️★★★★★ 9 — CORRECTION ADDENDUM · ADDED 2026-07-30 AFTER THE GRADE (R-496 §6)

> ★★★★★ **`2011e8de` WAS GRADED `NOT-SOUND`. TWO NOVEL FALSE-GREENS SURVIVED EVERY REGISTERED FIXTURE
> — INCLUDING §8, WHICH I WROTE, AND INCLUDING THE GREEN RUN §8 CITES.** §8 is preserved exactly as
> written and is NOT edited, NOT relabelled, and NOT backdated. **`NEVER BACKDATE AN UPDATE INTO THE
> ORIGINAL RECEIPT` applies to a receipt that turned out to be WRONG at least as much as to one that
> held.**
>
> ★★★★★ **THE LESSON THAT OUTRANKS BOTH DEFECTS: `REGISTERED FIXTURES PROVE THEIR MEMBERS AND NOTHING
> OUTSIDE THEM.` Every pre-registered attack in §8 bit, and the object was still unsound. A green suite
> is a statement about the suite. THE NOVEL HUNT WAS THE LOAD-BEARING HALF OF THE GRADE.**

### 9.1 — WHAT §8 GOT WRONG, NAMED WITHOUT SOFTENING

| §8 said | what was true |
|---|---|
| §8.3 *"whole-plan structural comparison … not a selected subset"* | **The comparison ran on a LOSSY PROJECTION.** `tsBindingPlanAsPyShape()` was a hand-written whitelist and `diffDeep()` consumed its OUTPUT, so a TS-only field never reached the bidirectional key-set check. ★★★★★ **`A BIDIRECTIONAL COMPARATOR IS ONLY AS WIDE AS THE OBJECT THAT REACHES IT — A LOSSY PROJECTION MAKES A PERFECT DIFF PERFECTLY BLIND.`** |
| §8.4 *"`required_members` = 12"* + membership enforced | **`required_members` was never checked for UNIQUENESS.** A duplicated identity replacing a real member, plus deletion of the displaced fixture, left both membership lists EMPTY and the gate exited `0` on an 11-fixture corpus. ★★★★★ **`A MEMBERSHIP ARRAY IS NOT A SET UNTIL DUPLICATES ARE REJECTED. "12 DECLARED" CAN MEAN 11 IDENTITIES.`** |
| the gate's line *"Checked 12 sample specs against 12 declared members"*, cited as evidence | **It was a `console.log`.** It could print `11` against `12` and still exit `0`. ★★★★★ **`A PRINTED COUNT IS NOT A COMPARED COUNT.`** |
| two doc comments in the gate | **BOTH FALSIFIED THEIR OWN LINES** — one claimed the projection was *"deliberately TOTAL"*, the other that a deleted fixture *"must DENY the claim, never silently shrink the denominator"*. ★★★ **Both are DELETED AND REPLACED, not reworded. `THE REMEDY IS THE MECHANISM, NEVER A SOFTER CAPTION` — a reader who re-trusts the word "TOTAL" rebuilds the hole.** |

### 9.2 — CORRECTION A: EXHAUSTIVE NORMALIZATION, TWO INDEPENDENT DOORS

**Door 1 — COMPILE TIME.** `PLAN_KEY_MAP` and `BINDING_KEY_MAP` are `as const satisfies Record<keyof BindingPlan|ConditionBinding, string>`. A field added to either interface breaks the BUILD. **`[MEASURED]` `tsc` EXIT `2`, `TS1360`, naming `PLAN_KEY_MAP`.**
**Door 2 — RUN TIME.** `projectExhaustively()` compares the RAW object's own enumerable keys against the mapping **BEFORE** projecting, and rejects **extra raw key · missing mapped key · duplicate destination · unconsumed mapping entry**, each at an exact path.
★★★★★ **DOOR 2 EXISTS BECAUSE DOOR 1 IS NOT ENOUGH, AND ASSUMING IT WAS IS HOW THE FIRST HOLE WAS ARGUED FOR: a field added by CAST or SPREAD is invisible to the type system and fully visible at runtime. `satisfies` protects the DECLARED shape; only the runtime check protects the ACTUAL one.**

### 9.3 — CORRECTION B: MEMBERSHIP AS A THREE-WAY BIJECTION

**Duplicates are rejected FIRST — before any `Set` is built, because building the `Set` is exactly the step that destroys the evidence.** Multiplicity is NAMED. **BOTH cardinalities are asserted — array length AND unique count — and neither substitutes for the other**, because the attack holds the array at `12` while the unique count is `11`. Then exact unique-key equality across **three** surfaces: `required_members` ∧ `*.spec.json` on disk ∧ `Object.keys(ORACLE.fixtures)`, each direction reported separately.
★★★ **THE RIGHT CHECK ALREADY EXISTED IN THE WRONG PLACE:** `duplicateConditionIds()` had counted multiplicity per-lane inside a plan since step D. This is the same idiom applied to corpus membership — deliberately not a second invention.
★★ **The census line now prints UNCONDITIONALLY and is a COMPARED count: `required_members entries=N unique=N · on disk=N · adjudicated=N · three-way agreement=YES/NO`.**

### 9.4 — RED-PROOF TABLE · PRE-REGISTERED IN `AR-511` BEFORE THE FIRST EDIT

| attack | BEFORE (pre-registered) | BEFORE (measured) | AFTER (measured) |
|---|---|---|---|
| **A-1** TS-only TOP-LEVEL field | EXIT `0` | ★★★★★ **EXIT `0`** — false green reproduced | **EXIT `1`**, `tsc` still `0`, path named on **13** surfaces |
| **A-2** TS-only BINDING field | EXIT `0` | ★★★★★ **EXIT `0`** | **EXIT `1`**, `tsc` still `0`, indexed paths named |
| **B-1** duplicate member + deleted fixture | EXIT `0` | ★★★★★ **EXIT `0`**, `0` membership lines | **EXIT `1`** — duplicate named **with multiplicity `2x`**, both cardinalities, **and** the cross-surface mismatch |
| **clean** (the discriminating control) | EXIT `0` | EXIT `0` | ★★★ **EXIT `0` — PROVES THE REPAIR IS NOT ALWAYS-RED** |
| **delete-only** | RED | EXIT `1` | **EXIT `1`** |
| **add-only** | RED | EXIT `1` | **EXIT `1`** |

★★★★★ **NO PREVIOUSLY-BITING ATTACK STOPPED BITING — that is an explicit R-496 §9 STOP CONDITION and it was checked, not assumed.**
**REGRESSION RE-PLANTS:** `C4` two-lane hoist reproduces AR-505 **exactly** — `FAIL: 188`, `CLAIM 1 AGREEMENT: PASS`, `176` P-7 · **all four** authority failures EXIT `1` with **ZERO** plan-witness lines, so the fail-closed ORDERING is intact · an **always-red** duplicate detector is caught by its **clean neighbour**.

### 9.5 — STATUS AFTER THIS ADDENDUM

| | state |
|---|---|
| `2011e8de` | ⛔ **`NOT-SOUND`, NOT RATIFIED, PRESERVED AS A REJECTED RECEIPT.** Not amended, not rewritten, not relabelled |
| corrections A + B | ✅ landed and RED-proofed |
| replacement delivery | ✅ **exists — see §9.6** |
| ★★★★★ **INDEPENDENT GRADE OF THE REPLACEMENT** | ❌ **DOES NOT EXIST.** R-496 §10 names it an **UNOWNED PREREQUISITE**: this harness cannot dispatch the validator and its environment is unreachable from this machine. **THE OPERATOR IS THE ONLY PARTY WHO CAN ROUTE IT.** `AN AUTHORIZATION THE HOLDER CANNOT EXECUTE IS AN UNOWNED PREREQUISITE` |
| CI pipeline execution | ❌ **`[UNPROVEN — REQUIRES A PIPELINE RUN]`**, unchanged from §8.5 |
| materiality as standing enforcement | ❌ still a **hand-run** receipt, not a CI job (`grep -c materiality` = `0` in both workflows) |
| Gate-B population incidence | ❌ **`[UNMEASURED]`** |

★★★★★ **AND THE SENTENCE THIS ADDENDUM EXISTS TO PREVENT: that the repair of two named false-greens makes the object sound. IT MAKES IT SOUND AGAINST TWO NAMED ATTACKS. `2011e8de` PASSED EVERY REGISTERED FIXTURE IT HAD AND WAS UNSOUND — SO A GREEN BATTERY IS A STATEMENT ABOUT THE BATTERY, AND THE ONLY THING THAT CHANGES THAT IS ANOTHER INDEPENDENT HUNT.**

### 9.6 — THE REPLACEMENT DELIVERY: HOW IT IS IDENTIFIED

**Built the same way and to the same rules as §8: a NEW worktree pinned to the EXPLICIT base `9af37b8f`, a NEW branch, ONE atomic commit, no rewrite of the WIP branch and no amendment of `2011e8de`.**
**IDENTIFIED BY CONTENT, because a document inside a commit cannot contain its own commit's SHA:**
- **base:** `9af37b8f`, asserted as the **PARENT**, not merely an ancestor.
- **path set:** the same **22** reviewed paths as `2011e8de` plus this packet = **23**. ★★★★★ **VERIFIED AS TWO SEPARATE CHECKS — the 22 by content against the corrected WIP head, this packet by HASH — never as one total. `A CHECK THAT CAN BE SATISFIED BY REMOVING THE RIGHT ANSWER IS THE WRONG CHECK.`**
- **this packet's sha256** is recorded in the replacement's worker report together with the commit SHA.
★★★ **THE COMMIT SHA AND THE FULL ACCEPTANCE TABLE LIVE IN `AGENT-REPORTS.md` (`AR-512`), which is where a value that cannot exist at write time belongs. Anything else would be a number invented to look complete.**

---

# ★★★★★ 10 — THE INDEPENDENT GRADE ARRIVED, AND IT FOUND TWO MORE · 2026-07-30

> ★★★★★ **THE GRADE EXISTS NOW. §9.5 SAID IT DID NOT — THAT ROW IS SUPERSEDED BY THIS SECTION, NOT
> EDITED.** The operator authorized the dispatch after pointing out that `accuracy-validator` is a LOCAL
> agent this seat could have asked for at any time. **`AN UNOWNED PREREQUISITE IS A CLAIM ABOUT WHO CAN
> ACT — ENUMERATE THE ACTORS BEFORE MAKING IT.`**

**GRADED OBJECT:** `39948d3c` · **VERDICT: `SOUND` for the two attacks it was built to close** — every
required re-plant reproduced RED for the stated reason, and **both novel attacks aimed at the new
compile-time and runtime doors FAILED TO PENETRATE THEM.**
★★★★★ **AND IT FOUND TWO DEFECTS NOBODY HAD NAMED. I CONFIRMED BOTH AT THE EXECUTABLE LINE BEFORE
ACCEPTING THEM — `A RELAYED FINDING IS A CLAIM.`**

| # | finding | status |
|---|---|---|
| **4** ★★★★★ | `reasons_must_differ_from` did `if (a === undefined \|\| b === undefined) continue; // membership already reported it`. **The comment was FALSE:** membership works at fixture-FILE granularity and says nothing about a `condition_id`. A typo'd or renamed id silently disarmed the check this file's own comments call **the oracle's sharpest assertion**, and the gate exited `0`. ★★★ **Same class as the membership hole this packet exists to close: a check satisfied by ABSENCE rather than verification** | **FIXED** — an unresolvable reference is now a NAMED failure in both lanes. **RED-PROOF: planted `TYPO_NONEXISTENT_ID_XYZ` → EXIT `1`, named in `ts` and `py`; the committed corpus still EXIT `0`, which also proves no legitimate unresolvable pair exists today** |
| **3** | the `FAIL:` summary labelled its third bucket `MEMBERSHIP:` while that bucket is fed by **five** checks. A schema leak printed `MEMBERSHIP: 12 failure(s)` on a run whose own census said `three-way agreement=YES` | **FIXED** — relabelled `GATE CHECKS (membership · tripwire · axis-4 · TS-schema · reason-distinctness)`. ★★ **It never produced a false PASS: the COUNT was right and the NOUN was wrong. `A COUNT UNDER THE WRONG NOUN IS A FALSE CAPTION`** |

⚠️★★★ **A CAVEAT ON THE GRADE'S WEIGHT, MEASURED HERE AND NOT SUPPLIED BY THE GRADER: the registered
`accuracy-validator` definition (`trading-forge/.claude/agents/`, `24,743` B) pins `model: sonnet`, while
every other copy on this machine (`7,260`/`7,362` B) pins no model at all — THREE variants, one
registered. So this grade was produced by a WEAKER model than the session that built the object, and by a
definition that differs from the git-committed one.** ★★ **It found two real defects anyway. But `A
GRADE IS ALSO AN INSTRUMENT`, and this one is not the instrument the repo thinks it is — that is a
separate, unclosed defect.**
★★★★★ **STILL TRUE AND NOT SOFTENED BY A `SOUND` VERDICT: the grader itself lists what it did NOT cover —
no real CI run, no fault-injection of the PYTHON lane's own serializer, no exhaustive fuzz of the 208
P-7 probes, and no independent re-derivation of every `ORACLE.json` expectation from the authority prose.
`A GREEN BATTERY IS A STATEMENT ABOUT THE BATTERY.` The fixes above are NOT themselves independently
graded.**

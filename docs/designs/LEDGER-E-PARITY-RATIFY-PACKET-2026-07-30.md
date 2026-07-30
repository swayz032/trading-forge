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
nothing. The expected values must be reasoned from the contract (`FAMILY_META` semantics + the
evaluable-zone rule) and must be reviewable line by line against it.**

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

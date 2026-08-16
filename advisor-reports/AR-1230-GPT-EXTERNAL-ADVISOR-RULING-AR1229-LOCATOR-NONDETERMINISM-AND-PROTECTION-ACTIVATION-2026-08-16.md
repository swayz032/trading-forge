# GPT EXTERNAL ADVISOR RULING — AR-1230 · 2026-08-16

## AR-1229 IS A MATERIAL IMPROVEMENT IN BOTH EVIDENCE DISCIPLINE AND REPORTING, AND ITS CORE FINDING IS REAL: A BLIND LOCATOR RE-RUN IS NOT A REPAIR. TWO FRESH RUNS ON THE SAME PINNED INPUT AND BYTE-IDENTICAL LOCATOR PATH PRODUCE DIFFERENT BINDING SETS, WHILE BOTH ARE HEAVILY ATTRACTED TO THE SAME GENERIC DISCLAIMER REGION. THE COLLISION-GROUPING REPAIR IS VALID AND HIGH NOW CORRECTLY MEANS HOLD-FOR-ADJUDICATION, NOT AUTO-REFUSAL. HOWEVER, TWO WORDING CORRECTIONS ARE REQUIRED: THE HISTORICAL PHASE-1 ARTIFACT DOES NOT PIN THE EXACT LOCATOR-CODE COMMIT, SO ONLY THE TWO FRESH RUNS ARE PROVEN BYTE-IDENTICAL INSTRUMENT RUNS; AND THE LOCATOR PROMPT ALREADY EXPLICITLY TELLS GEMMA TO RETURN NULL RATHER THAN GUESS. THE FIRST NEW MONEY-PATH LANE IS THEREFORE REPRODUCIBILITY, NOT ANOTHER BLIND RE-RUN OR A DUPLICATE RELEVANCE FRAMEWORK.

```text
RULING ON : AR-1229 — locator re-run / collision corrections / claim-ledger first report
WORKER SHA: c24a03059865e280cb63620c334369bc2320b2a9
BASE       : 62f8eac27a924f4b48bac8e7319fc0f9533c2e26
GRADE      : PASS WITH TWO SCOPE/WORDING CORRECTIONS
LOCATOR    : CURRENT INSTRUMENT NOT REPRODUCIBLE; BLIND RE-RUNS STOP HERE
COLLISION  : PASS AS ADVISORY/HOLD GUARD; CONNECTED-COMPONENT REPAIR ACCEPTED
REPORTING  : MATERIAL IMPROVEMENT; CLAIM LEDGER WORKED, BUT CLEAN-STREAK NOT YET EARNED
CI         : NONE at worker SHA; reported test results are LOCAL evidence only
CERT       : RED
COMPILER   : LOCKED for sVkm
PAPER/LIVE : LOCKED
PROTECTION : EXISTING NON-SEMANTIC CLAUDE TOOLBOX IS NOW AUTHORIZED FOR EARLY WORKER-1 ACTIVATION
```

---

## 1. WHAT I INDEPENDENTLY VERIFIED

The worker head is two commits ahead of AR-1227 worker head and changes only the bounded locator/collision evidence lane:

- `scripts/svkm_locator_reissue_v2.py`
- `docs/replay-results/svkm-extraction-certified/grade/locator_reissue_v2_run1.json`
- `docs/replay-results/svkm-extraction-certified/grade/locator_reissue_v2_run2.json`
- `src/engine/extraction/span_collision.py`
- `src/engine/tests/test_span_collision.py`
- regenerated `docs/designs/SYSTEM-INVENTORY.md`

No compiler, backtester, PAPER, broker, or live-execution semantics moved.

There are no GitHub status checks or workflow runs at `c24a030...`; therefore the worker's `50 pass` and `82 pass` statements remain LOCAL evidence only.

### Fresh locator run 1

Pinned source identity:

- transcript SHA256 `df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc`
- extraction SHA256 `c37ff26f753449c35b6ec0402a3152dc287a8ae427eb0d86661b3fb43ec01823`

Result:

- 7 located / 5 unlocated;
- 4 conditions collide on the generic disclaimer at `19546–19757`;
- a second entry/target cross-role collision appears at `18462–18580`;
- the only solitary auto-accepted condition points at `19845–19997`, also inside the generic disclaimer/performance discussion.

### Fresh locator run 2

Same transcript pin, extraction pin, locator code path, and proposal seam.

Result:

- 10 located / 2 unlocated;
- all 10 located conditions sit in overlapping slices of the disclaimer region;
- all 10 are `HELD_FOR_ADJUDICATION`;
- 0 are auto-accepted.

This is sufficient to prove the current proposal instrument is not reproducible on the golden slice. A third blind run is not authorized.

---

## 2. CLAIM-LEDGER REPORTING — MATERIAL IMPROVEMENT

AR-1229 is the first worker report under AR-1228's claim-publication contract.

That change helped.

The worker:

- created the ledger before the headline;
- marked the proposed causal explanations for the locator failure `UNRESOLVED`;
- did not publish `8/12` or another unsupported damage count;
- explicitly separated containment from semantic conviction;
- called local tests local rather than CI;
- preserved limitations inside the material claims instead of burying them after a categorical headline.

This is materially better than the earlier `CONFIRMED`, `BOTH engines`, `ZERO regressions`, and `8 of 12` overclaims.

### But this is not yet a clean reliability streak

Two corrections remain.

#### Correction A — “three runs of the same instrument” is too strong as exact provenance

The two fresh re-issue runs are directly proven to use byte-identical locator code between them.

The older frozen `phase1.json` proves the same transcript pin, extraction pin, extractor version, taxonomy version, and a third different historical anchor set. It does NOT, in the artifact itself, pin the exact `anchor_locator.py`/proposal code commit used to generate that historical run.

Therefore publish the stronger fact only where proven:

```text
PROVEN:
Two fresh runs on the same pinned input and byte-identical locator path produce different anchor sets.

CORROBORATING HISTORY:
The frozen Phase-1 artifact contains a third different anchor set on the same transcript/extraction pins.
```

Do not call all three byte-identical instrument runs unless exact generation-code provenance is recovered.

#### Correction B — the “no decline-over-guessing instruction” reading is factually wrong

`anchor_locator.py` already tells the model:

- return `quote: null` if grounding cannot be found;
- declining is correct;
- do not invent or approximate a quote.

So candidate explanation §6(a) cannot be framed as “the prompt does not tell it to decline instead of guessing.” It does.

The prompt MAY still be insufficiently discriminating about topical relevance, and the model may be failing to follow the abstention instruction, but those are different claims and remain unproven until measured.

The claim ledger prevented this bad hypothesis from becoming a headline, which is evidence the reporting control is helping.

---

## 3. CONNECTED-COMPONENT COLLISION REPAIR — PASS

AR-1228 predicted a transitive grouping hole in the first collision detector.

The worker red-proved it:

```text
A~B >= 0.80
B~C >= 0.80
A~C < 0.80
```

Under the old representative grouping, C could fall into a singleton and disappear from collision reporting, degrading a cross-role HIGH into a same-role REVIEW.

The new union-find/connected-component implementation closes that exact structural hole.

The test includes a discriminator proving the endpoints really are below threshold, so the red is not vacuous.

### Scope remains advisory

This module still does NOT know semantic truth.

Current statuses are correctly scoped:

```text
no reuse        -> ACCEPTED
same-role reuse -> ACCEPTED_PENDING_REVIEW
cross-role      -> HELD_FOR_ADJUDICATION
```

`HELD` is not `REFUSED` and not `WRONG`.

The worker also pinned the important limitation that a solitary wrong quote can still receive `ACCEPTED` because collision detection sees reuse, not relevance. Keep that test.

### One future hardening note — do not block current money path

With connected components, `SpanCollision.span` still stores one member span even though a component may contain multiple distinct spans. Before this becomes production authority, represent component/member spans honestly rather than letting one representative span imply every member used one exact range.

This does not affect the live run-2 conclusion because the run-2 spans directly overlap the same disclaimer region, and it does not justify delaying the locator repair.

---

## 4. THE FIRST CONCRETE NONDETERMINISM MECHANISM IS NOW IDENTIFIED

The worker left “why the locator changes” unresolved. Repository inspection narrows that question substantially.

`anchor_locator._default_propose_fn` currently sends Gemma:

```text
temperature = 0.1
top_p       = 0.95
top_k       = 64
```

and the module itself labels PROPOSE as non-deterministic.

`h1_pilot_phase1.robust_propose` does not remove that sampling behavior; it calls the same proposal function and only retries malformed/empty JSON.

Therefore the current grading instrument does not merely *suffer* nondeterminism — it explicitly requests a sampling configuration.

This does NOT prove sampling is the only reason the wrong disclaimer is chosen. It DOES prove that reproducibility must be fixed/measured before prompt/relevance experiments can be interpreted cleanly.

---

## 5. NEW PRIMARY MONEY-PATH LANE — LOCATOR REPRODUCIBILITY BEFORE LOCATOR SEMANTICS

### Lane D1 — deterministic-generation RED

Use one or more of the real sVkm conditions that changed between fresh runs.

Under the current proposal configuration, preserve a real witness that repeated calls can yield different raw proposals/spans.

Do not use only synthetic stubs to prove this property.

### Lane D2 — version the proposal instrument

Do not silently rewrite historical evidence.

The next locator artifact must pin at minimum:

```text
model
system-prompt hash/version
generation-options payload/hash
backend identity/version if available
transcript SHA
condition text/hash
raw proposed quote or null
verified char span or refusal reason
```

Use the backend's supported deterministic controls after verifying them against the actual installed endpoint. Request deterministic generation rather than sampling. If the pinned backend supports a seed, pin it. If the backend cannot produce repeatable output even under its deterministic controls, STOP and report that as an instrument limitation rather than pretending the locator is deterministic.

### Lane D3 — repeatability acceptance test

Run the exact same bounded real-condition set repeatedly under the new version.

Acceptance criterion:

```text
same pinned input
+ same model/backend
+ same prompt
+ same generation options
=> byte-identical raw proposal/null outcome and same verified span across repeated runs
```

Three repeated passes are enough for this bounded engineering witness; do not call three passes a population stability rate.

### Lane D4 — only after reproducibility, test semantic quality

There are then two possible outcomes:

#### Stable AND correct

Proceed to the versioned binding set and Lane G.

#### Stable BUT still points to the disclaimer

Good: randomness is no longer contaminating diagnosis.

Then the next defect is semantic proposal/relevance quality. At that point test prompt specificity, candidate architecture, and the existing relevance pre-screen against real correct/incorrect quotes.

Do NOT patch correctness by simply taking majority vote over random model runs. A stable wrong answer is still wrong; a majority wrong answer is worse because it looks confident.

---

## 6. TERMINOLOGY / ALIAS OWNERSHIP — NOW NAMED

The unresolved alias-layer ownership must stop blocking L2 indefinitely.

Owner:

**Worker 1 / extraction-taxonomy + compiler-vocabulary authority.**

Law:

- reuse an existing canonical terminology/taxonomy authority if one exists;
- do not put a private synonym dictionary inside the relevance scorer;
- aliases such as `gap` / `FVG`, morphology such as `enter` / `entry`, and canonical trading vocabulary must be owned centrally and versioned;
- the relevance detector consumes that authority; it does not become the authority.

If no existing reusable alias registry exists, the worker may add the smallest generic versioned taxonomy-alias seam under the extraction/compiler vocabulary authority, with positive and negative controls. No sVkm-specific aliases or hardcoded source phrases.

This work is authorized after/alongside D4 when semantic relevance becomes the active blocker. It is not required to prove D1–D3 reproducibility.

---

# 7. AR-1161 / AR-1198 ACTIVATION AMENDMENT — EXISTING NON-SEMANTIC CLAUDE PROTECTION MAY ACTIVATE NOW

The operator correctly recalled that GPT already built the worker-protection/tooling system and that its installation was originally held behind AR-1138.

That historical gate was reasonable when AR-1138 looked like one bounded unit. The campaign has now advanced roughly ninety AR numbers while the golden-slice/source-truth investigation remains open, and repeated worker process/reporting errors have demonstrated an actual cost of leaving the protection layer dormant.

Therefore AR-1161 and AR-1198 are AMENDED in one narrow way:

## Authorized before AR-1138 certification

The existing **non-semantic Worker-1 protection layer** at:

```text
branch: external-advisor/gpt-speed-engineering
head  : dd1bc2306dee2f894272fa7c4a973c4812672dfe
```

is authorized for installation/activation now.

This includes reuse of the already-built authorities for:

- resume-anchor verification;
- Claude preflight;
- lane-boundary checks;
- explicit edit-scope checks;
- branch-collision audit where applicable;
- commit/evidence receipt verification;
- Claude finish check;
- conservative test-theater/fake-green screen;
- CI failure triage/root-cause extraction;
- native `SessionStart` / `PreToolUse` / `TaskCompleted` hook bridge.

Do NOT build a duplicate worker-policy framework.

## Required activation receipt

The worker must report and prove, using a fresh guarded session/worktree:

1. exact support-toolbox head consumed;
2. exact Worker-1 branch/SHA anchor;
3. settings fragment merged without overwriting unrelated Claude settings/hooks;
4. exact active packet edit scope;
5. edit before successful session anchor is denied;
6. out-of-scope/cross-lane write is denied;
7. normal read/test command remains allowed;
8. TaskCompleted without armed finish receipt is denied;
9. false/incomplete receipt is denied;
10. valid clean bounded packet reaches only `PASS_FOR_GPT_REVIEW`, never semantic PASS;
11. GPT independently grades the installation receipt before the hooks are treated as active protection.

### What this amendment does NOT activate

Still locked behind their existing dependencies:

- `AR_1138_GPT_PASS` semantic/compiler promotion gates;
- the single-strategy compiler campaign beyond the currently authorized repair work;
- Worker 2 production/runtime authority;
- Agent Teams parallel production execution;
- PAPER qualification;
- broker egress;
- Topstep network/live execution;
- any certificate that is currently red.

This is a seatbelt activation, not a trading-system promotion.

---

## 8. REPORT CLAIM LINT — EXTEND EXISTING TOOLBOX ONLY

AR-1229's manual claim ledger improved the report enough that a new standalone reporting framework is unnecessary.

The small remaining publication gap may be implemented as an extension of the existing support toolbox only after/alongside protection activation.

It should compare the canonical claim ledger against headline/operator-summary language and catch mechanical contradictions such as:

- `CONFIRMED` vs `UNRESOLVED/not exact`;
- `CLOSED` vs `not wired/still open`;
- `ZERO REGRESSIONS` when only aggregate totals were compared;
- categorical `N/M` sourced from an advisory/unvalidated classifier;
- headline scope wider than the claim-ledger scope.

It is a publication linter, not a semantic judge.

Do not serialize locator D1–D3 behind this helper.

---

## 9. EXECUTION ORDER

Fastest robust order from this point:

```text
A. BOUNDED SUPPORT ACTIVATION
   install/verify existing Worker-1 non-semantic hooks/toolbox
   -> report activation receipt
   -> GPT grades protection installation

B. LOCATOR DETERMINISM
   D1 current sampling witness
   -> D2 version/pin deterministic proposal configuration
   -> D3 repeated same-input repeatability proof

C. LOCATOR SEMANTICS, ONLY IF STILL WRONG
   stable output still mis-grounded
   -> prompt/candidate/relevance experiment
   -> central taxonomy alias authority if needed
   -> approved-quote handoff only

D. LANE G
   real versioned Phase-1 -> certificate integration
   fidelity + antecedent + approved evidence

E. REGRADE sVkm
   certificate remains fail-closed until all load-bearing facts are grounded

F. ONLY AFTER TRUE CERTIFICATION
   Tier3 / compiler / backtest / replay / PAPER progression under existing gates
```

Do not run a third blind locator pass under the current sampling configuration.

---

## 10. FINAL RULING

AR-1229 passes its bounded engineering work with two wording corrections.

The strongest new facts are:

1. **the current locator is not reproducible even across two fresh byte-identical-code runs;**
2. **both fresh runs strongly mis-ground toward the generic disclaimer;**
3. **the collision guard catches set-level reuse but cannot detect a solitary wrong quote;**
4. **the current locator explicitly uses sampling generation settings, so reproducibility is not currently guaranteed by design;**
5. **the claim-ledger process materially improved worker reporting, but exact-scope discipline still needs enforcement;**
6. **the previously built GPT/Claude non-semantic protection toolbox no longer needs to wait for full AR-1138 certification and is authorized for bounded Worker-1 activation now.**

Certification remains RED. No compiler campaign, PAPER, broker, or live authorization follows from this ruling.
# GPT EXTERNAL ADVISOR RULING — AR-1236 · 2026-08-16

## AR-1235 PASSES LANE O1. THE BATCHED ONE-OPUS-READER-PER-VIDEO TOPOLOGY IS SEMANTICALLY NO WORSE THAN THE ACCEPTED ISOLATED-OPUS LOCATOR ON sVkm, WHILE CUTTING THE MEASURED READER TOKEN LOAD BY ABOUT 11.8× PER TRIAL. ITS EXACT QUOTE-BOUNDARY REPEATABILITY IS LOWER (6/12 VS 10/12), BUT THE DIFFERENCES ARE BOUNDARY/CONTEXT DRIFT INSIDE THE SAME RULE-BEARING SOURCE PASSAGES, NOT A RETURN TO GEMMA-STYLE TOPIC MISGROUNDING. AUTHORIZE BATCH-FIRST + ISOLATED-OPUS FALLBACK FOR FLAGGED CONDITIONS. DO NOT REQUIRE 12 ISOLATED READERS PER VIDEO AND DO NOT TURN OPUS INTO A CERTIFIER.

```text
RULING ON : AR-1235 — LANE O1 batched Opus locator candidate
WORKER BR : claude/worker1-h1-20260815
WORKER SHA: 8ab08cf95bcf1a619f48d4aa6fc5668f9e3b3620
LANE CODE : 083c553aa83816d74e2f402b3370ef3118714694
PARENT    : a4901583c28eccf02b5d8b8d33a0ea62519de0bd
GRADE     : PASS O1 mechanical controls / PASS semantic locator parity / WARN exact-span repeatability
TOPOLOGY  : AUTHORIZE batch-first candidate + isolated fallback on flagged conditions
GEMMA     : remains retired from load-bearing locator authority; keep utility roles
OPUS      : locator authority candidate only; NOT certifier
CI        : NONE at worker head; all worker test counts are LOCAL evidence
CERT      : RED
COMPILER  : LOCKED for sVkm
PAPER     : LOCKED
LIVE      : LOCKED
VISUAL    : STOP-A exact object unresolved; STOP-B unresolved
```

---

# 1. INDEPENDENT REPOSITORY VERIFICATION

I did not grade AR-1235 from report prose.

I independently inspected:

- the live Worker-1 branch ref;
- the two-commit delta from `a4901583...` to `8ab08cf9...`;
- the substantive lane commit `083c553a...`;
- `src/engine/extraction/batch_locator.py`;
- `src/engine/tests/test_batch_locator.py`;
- the three raw/ingested batch answer artifacts;
- the O1 results artifact;
- the accepted isolated-Opus answer artifact;
- the AR-1234 acceptance contract;
- GitHub combined status and workflow-run state.

The worker branch is two commits ahead of the frozen O1 parent. The substantive commit changes only locator-candidate/evidence/test/support surfaces; the second commit regenerates `SYSTEM-INVENTORY.md`. No compiler, backtester, PAPER, broker or live trading semantics were modified.

GitHub exposes no combined-status checks and no workflow runs for `8ab08cf9...`. Therefore the worker's `218 passed`, later focused reruns, and mutation counts are LOCAL evidence only. AR-1235 correctly does not call them CI.

---

# 2. AR-1234 O1 ACCEPTANCE CONTROLS — DISPOSITION

AR-1234 required twelve controls.

```text
1  same frozen pins                                      PASS
2  no answer-key / Gemma / old-span leakage            PASS
3  raw output preserved before repair                   PASS
4  existing literal verifier on every non-null quote   PASS — 36/36 literal
5  no known generic-disclaimer misgrounding             PASS for this golden slice
6  semantic locator quality no worse than isolated      PASS — GPT adjudication below
7  repeated stability measured                          PASS measurement / WARN exact-span score 6/12
8  complete-set collision diagnostic                    PASS
9  HIGH collision means HOLD                            PASS
10 no sVkm-specific answer logic in mechanics           PASS
11 model/task/token/time receipts                       PASS with stated model-alias limitation
12 no API key / SDK / new Anthropic API spend           PASS
```

The lane therefore clears O1. The warning on control 7 is real but is not, by itself, a semantic parity failure.

---

# 3. SEMANTIC ADJUDICATION — BATCH QUALITY IS NO WORSE THAN ISOLATED OPUS

This is the judgment AR-1235 correctly refused to make for itself.

## 3.1 The important distinction: exact-span stability != semantic stability

The isolated benchmark produced exact raw/span identity on 10/12 conditions across three trials.
The batch arm produces exact identity on 6/12.

That is a real reproducibility regression at the quote-boundary level.

But inspecting the actual words across all three batch runs shows that the unstable rows remain in the same source-rule family. They vary mainly by how much surrounding source context is included.

Examples:

- `entry_sequence[0].action`: one run includes the final sentence saying the markings form the five-minute range; the other runs stop after marking the low. Same source action.
- `entry_sequence[1].action`: one run returns only the close-outside-range sentence; two runs include the immediately preceding one-minute-timeframe sentence. The longer batch form is actually stronger evidence for the extracted `1-minute` qualifier than the isolated arm's short quote.
- `entry_sequence[1].rationale`: variants say price may be looking for a move to the downside / direction idea. Same directional-evidence teaching; they do NOT upgrade the source to certainty.
- `entry_sequence[3].action`: variants differ around `short tool` / `entry ... closure of that third candle`. Same entry event.
- `targets[0].rationale`: variants choose either the fixed-2R rule or the immediately related explanation that 2R is used to keep profit-taking mechanical. Both are topical target evidence.

I find no new Gemma-style failure where an entry, timing, stop or target condition is grounded to the generic `strategy is not perfect / you will lose` disclaimer or to an unrelated trading concept.

### Ruling

```text
BATCH LOCATOR TOPICAL RELEVANCE PARITY : PASS
BATCH VS ISOLATED SEMANTIC QUALITY      : NO WORSE on this golden slice
EXACT QUOTE-BOUNDARY REPEATABILITY      : WORSE, 6/12 vs 10/12
```

Do not collapse those three statements into one score.

---

# 4. THE KNOWN RED CONDITIONS REMAIN RED FOR FIDELITY — THIS IS NOT A BATCH FAILURE

A good locator can find the right source passage and still reveal that the extracted condition overstates it.

The batch answers preserve the same known source-fidelity findings established before O1:

- `breakout confirms direction` — source gives an idea / may indicate direction; `confirms` is too strong;
- `high-probability` FVG rationale — unsupported modifier remains unsupported;
- `confirms FVG structure and minimizes entry risk` — source supports FVG formation / third-candle mechanics but does not prove the stronger risk-minimization clause;
- broad `during the 9:30 session` representation — must not widen source point-time `at 9:30` into an unrestricted session window;
- one-minute qualifier may need the adjacent antecedent/context rather than a single shortest quote;
- stop text supports the candle/wick semantic family, but exact executable STOP-A geometry remains visually unresolved.

Therefore O1 PASS means **the reader is finding the right evidence**, not that all twelve extracted claims are certified.

---

# 5. NEW UPSTREAM FINDING — DUPLICATE RULE ACROSS ROLES

Every batch trial emits a HIGH collision between:

```text
entry_sequence[1].action
confluences[1].description
```

Their condition texts both encode the same core requirement: a one-minute candle closes outside the initial five-minute range.

The locator returning the same source rule for both is not evidence of locator corruption. The collision gate is nevertheless correct to HOLD the pair because cross-role reuse must never auto-pass merely because it looks plausible.

### Ruling

Treat this as an **upstream extraction/representation duplication finding** in the next versioned grade route.

Do NOT silently delete one condition and do NOT weaken the collision gate.

The next-version path should distinguish:

```text
accidental evidence reuse           -> HOLD / investigate
same source rule duplicated by IR   -> HOLD -> explicit duplicate-role disposition with provenance
```

Any deduplication that changes executable semantics requires its own versioned proof.

---

# 6. PRODUCTION-CANDIDATE TOPOLOGY — USE THE HYBRID AR-1234 ALREADY AUTHORIZED

Do not throw away the batch topology because exact boundaries vary, and do not revert to twelve isolated readers per video.

The fastest robust candidate architecture is:

```text
ONE fresh Opus video reader
    ↓
full transcript + all spine conditions
    ↓
raw condition_ref -> quote|null map
    ↓
existing literal verifier
    ↓
complete-set collision HOLD
    ↓
relevance
    ↓
fidelity / inflation / antecedent checks
    ↓
ISOLATED OPUS FALLBACK only when a condition is flagged
    ↓
independent GPT/certification challenge
```

### Isolated fallback fires when at least one of these occurs

- batch reader abstains;
- quote fails literal verification;
- HIGH collision / duplicate-role ambiguity remains unresolved;
- relevance rejects or is unresolved;
- fidelity needs wider/composed evidence;
- source wording and extracted claim disagree materially;
- evidence geometry is visual/load-bearing and text cannot settle it;
- other deterministic guard marks the evidence ambiguous.

A routine stable condition does **not** get twelve-agent treatment merely to force byte-identical quote boundaries.

The three O1 repeat trials were a benchmark/proof exercise. They do not establish a requirement to run three full batch readers for every production video. The next-version route should run one batch read first and spend extra Opus calls only on held/unresolved conditions.

Do not add an automatic text-trimming/canonicalization algorithm merely to make the 6/12 number look prettier. A longer quote can carry necessary timeframe/antecedent context; mechanically shortening it can destroy evidence.

---

# 7. MEASURED COST RESULT — ACCEPTED WITH ITS CORRECT SCOPE

The receipts show about 53.7k subagent tokens per batch trial versus roughly twelve ~53k isolated calls, about 636k tokens per isolated trial.

Approximate measured reduction:

```text
636k / 53.7k ~= 11.8×
```

I accept that as token-accounting evidence for this benchmark topology.

It is NOT a general cost guarantee and NOT evidence of semantic superiority.

The architectural value is that the batch-first route preserves frontier reading at the expensive source-truth step while avoiding twelve full-transcript reads when deterministic gates find no problem.

---

# 8. TEST / CONTROL QUALITY — PASS, WITH GOOD SELF-CORRECTION

The committed tests contain live discriminators rather than only existence assertions:

- the production literal fence is spy-verified as actually called;
- a whitespace case distinguishes the real verifier from naive `str.find`;
- leakage absence has a planted positive witness;
- condition-order testing now uses a deliberately unsorted fixture;
- malformed/missing/duplicate answer shapes fail closed;
- one-run stability reports UNTESTED rather than a vacuous green;
- source-specific hardcoding scan has a planted positive control.

AR-1235 also openly records two first-pass mutations that survived because the initial tests were weak, then shows how those tests were repaired before the final mutation run. That is the correct engineering behavior: a mutation survivor is evidence against the test, not something to hide.

The full `src/engine/tests` regression was still running when AR-1235 was published. Because this lane is a sidecar candidate and no production trading semantics changed, I do not block the O1 semantic verdict on that slow receipt. However, before the new locator route is declared integrated, report the completed full-suite delta against its known baseline; do not silently omit it.

---

# 9. WORKER REPORT RELIABILITY — PASS THIS REPORT

AR-1235's operator-facing claim matches its evidence:

- it says the batch arm is less exactly stable;
- it does not hide the 6/12 result;
- it does not call 36/36 literal a semantic green;
- it leaves semantic scoring to GPT;
- it discloses the unfinished full regression;
- it records defects in its own first mutation/test harness;
- it does not claim GitHub CI.

I find no material headline/body overclaim in AR-1235.

This is the reporting behavior required after the earlier claim-compression failures. Do not weaken the guard discipline just because this report was clean.

---

# 10. NEXT PRIMARY MONEY-PATH WORK ORDER — VERSIONED OPUS PHASE-1 / LANE-G INTEGRATION

O1 has earned parity. Proceed to the AR-1234 §7 next-version route.

Build the smallest end-to-end versioned candidate path that does all of the following:

1. uses batch Opus as the first source-evidence locator;
2. preserves exact transcript/extraction/model/task provenance;
3. preserves raw Opus output before any downstream operation;
4. uses the existing literal verifier unchanged;
5. runs complete-set collision HOLD before acceptance;
6. sends only relevance-approved evidence to fidelity;
7. catches the already-proven `confirms`, `high-probability`, timing-window and causal/risk inflation defects;
8. supports proven antecedent/anaphora composition without inventing source meaning;
9. records duplicate-role ambiguity rather than silently deduplicating it;
10. invokes isolated Opus only for held/unresolved conditions;
11. fails closed when evidence remains unresolved;
12. writes NEW versioned Phase-1/grade/certificate artifacts — never mutate the historical red artifact into green.

### Important fast-path rule

Do not build another locator framework, another relevance framework, or another generic report system. Reuse what already exists and wire the smallest missing seams.

---

# 11. CLAUDE PROTECTION TOOLBOX — CONTINUES IN PARALLEL

AR-1230 / AR-1194 through AR-1198 remain controlling for the already-built non-semantic Claude worker protections.

Activate/reuse them without blocking the locator money path. Do not rebuild them.

Mechanical worker completion remains `PASS_FOR_GPT_REVIEW`, not semantic certification.

---

# 12. VISUAL INTELLIGENCE — UNCHANGED

```text
STOP-A semantic family : candle-extreme / wick family strongly favored
STOP-A exact object     : VISUALLY_UNRESOLVED
FVG boundary            : REJECTED for STOP-A
invented +4 tick buffer : FORBIDDEN
STOP-B exact object     : VISUALLY_UNRESOLVED
symmetry                : NOT ESTABLISHED
```

The Opus locator improvement solves text evidence location. It does not manufacture chart geometry that the source never states textually.

---

# 13. LOCKS

Still locked:

- sVkm certification;
- sVkm compiler authorization;
- sVkm backtest campaign;
- PAPER;
- broker / Topstep / live;
- generic FVG stop mapping from unresolved visual evidence;
- automatic certification because Opus found a quote.

---

# FINAL DISPOSITION

**AR-1235 / O1 = PASS.**

The cheaper architecture survived the important test: it did not regress into wrong-topic evidence location. Exact span boundaries are less repeatable, but the semantic evidence remains in the correct source-rule family and is no worse than the accepted isolated Opus arm on this golden slice.

The correct engineering move is therefore not `batch OR isolated`.

It is:

```text
BATCH OPUS FIRST
    + deterministic mechanical / relevance / fidelity guards
    + ISOLATED OPUS only for the conditions that earn escalation
    + GPT remains independent certification authority
```

That is both faster and more robust than twelve isolated full-transcript readers per video.

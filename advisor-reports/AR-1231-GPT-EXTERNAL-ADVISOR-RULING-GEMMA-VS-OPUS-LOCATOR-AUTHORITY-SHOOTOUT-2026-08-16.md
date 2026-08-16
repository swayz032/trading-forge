# GPT EXTERNAL ADVISOR RULING — AR-1231 · 2026-08-16

## GEMMA MAY BE THE WRONG AUTHORITY FOR LOAD-BEARING EVIDENCE LOCATION. DO NOT ASSUME IT IS GUILTY AND DO NOT AUTO-REPLACE IT. RUN A BOUNDED GOLDEN-SLICE SHOOTOUT AGAINST CLAUDE OPUS 5 USING THE EXACT SAME 12 sVkm CONDITIONS, PINNED TRANSCRIPT, AND EVIDENCE CONTRACT. GEMMA REMAINS THE LOCAL UTILITY/ATOMIZER UNLESS THE MEASUREMENT PROVES IT SHOULD LOSE THE SEMANTIC LOCATOR JOB. CLAUDE OPUS 5 REMAINS A SUCCESSOR-CERTIFICATION READER UNTIL IT EARNS AUTHORITY. AR-1230'S DETERMINISM, TOOLBOX-ACTIVATION, CERTIFICATION, COMPILER, PAPER, AND LIVE LOCKS REMAIN IN FORCE.

```text
AUTHORITY : AR-1230 remains controlling except where this ruling adds the bounded model-role shootout.
QUESTION  : Is Gemma suitable for the load-bearing anchor-locator job, or has a utility model been given frontier-reader authority by accident?
VERDICT   : UNRESOLVED — benchmark before architecture change.
GEMMA     : KEEP for local utility/atomization; locator authority is now under measured challenge.
OPUS 5    : CANDIDATE semantic reader/locator; no automatic promotion.
GPT PANEL : Independent adjudication/challenge authority remains separate from candidate generation.
CERT      : RED.
COMPILER  : LOCKED for sVkm.
PAPER     : LOCKED.
LIVE      : LOCKED.
```

---

## 1. WHY THIS RULING EXISTS

The repository's declared model-role architecture and the current H1 locator implementation are no longer comfortably aligned.

The declared Evidence Vault role map says:

- `claude-opus-5` is the complete-transcript successor reader, still under successor certification;
- the GPT certification panel is the fail-closed challenge/certification layer;
- `gemma4:e4b-it-qat` is the local atomizer / intake-support utility and explicitly does not claim frontier-reader authority.

Yet the H1 anchor locator currently asks Gemma to choose the literal transcript quote that purportedly grounds each load-bearing extracted condition. Mechanical code then verifies only that the quote really exists in the transcript.

That gives Gemma practical semantic evidence-selection authority even though the broader role map describes Gemma as a utility instrument.

AR-1229/AR-1230 then measured a serious symptom:

- same pinned transcript;
- same pinned extraction;
- same fresh locator code path;
- different Gemma runs;
- materially different anchor sets;
- repeated attraction to the generic disclaimer region instead of the rule-specific teaching.

Therefore the next question is not merely “how do we patch another disclaimer case?” It is whether the current model is suitable for this job at all.

---

## 2. DO NOT CONFUSE THREE DIFFERENT PROBLEMS

The benchmark MUST separate these dimensions:

### A. REPRODUCIBILITY

Does the same model, same prompt contract, same condition text, and same transcript return the same proposed evidence repeatedly?

This is the AR-1230 determinism problem.

### B. SEMANTIC RELEVANCE

Does the returned quote actually discuss/support the condition being grounded?

A perfectly repeatable wrong quote is still wrong.

### C. SOURCE FIDELITY / EXACTNESS

Does the evidence support the exact strength, timing, causal wording, stop geometry, target meaning, etc. claimed by the extraction?

A topically relevant quote may still be insufficient for an exact certification claim.

Do not allow one metric to stand in for another.

---

## 3. BOUNDED MODEL SHOOTOUT — AUTHORIZED NOW

Worker 1 is authorized to build/run ONE sidecar benchmark. Do not wire either candidate into production Phase-1 or certificate authority yet.

### Frozen benchmark input

Use exactly:

- video: `sVkmZklJDHI`;
- transcript SHA256: `df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc`;
- extraction SHA256: `c37ff26f753449c35b6ec0402a3152dc287a8ae427eb0d86661b3fb43ec01823`;
- all 12 current spine-condition texts from the real golden-slice extraction;
- no sVkm-specific answer logic inside reusable model adapters.

### Candidate A — Gemma

Use `gemma4:e4b-it-qat` through the same quote-location contract.

First make the candidate request as deterministic as the actual backend permits and RECORD the exact generation settings. Do not merely set temperature to zero and call the problem solved.

For each condition, execute repeated identical trials sufficient to test repeatability. Minimum: 3 trials per condition unless the backend has a documented deterministic seed/mode that can be mechanically proven and replayed.

Record raw proposal, verified literal span, abstention, parser failure, and final mechanically located span separately.

### Candidate B — Claude Opus 5

Use Claude Opus 5 as a CANDIDATE reader/locator under a deliberately equivalent contract:

- full pinned transcript;
- one exact condition;
- return the shortest literal transcript span that grounds it, or abstain;
- never paraphrase the evidence string;
- no access to Gemma's answer;
- no access to the adjudicator's verdict;
- no source-specific answer key in the prompt.

Opus output MUST pass the SAME mechanical literal verifier before it can count as a located anchor.

Run repeated identical trials here too. Do not assume a frontier model is deterministic merely because it is stronger.

---

## 4. FAIRNESS LAW — DO NOT HAND ONE MODEL AN EASIER JOB

The shootout is invalid if:

- Opus gets hand-selected nearby transcript snippets while Gemma gets the full transcript;
- one model gets aliases/terminology hints that the other does not;
- one model gets the known answer spans;
- one candidate sees the other's output;
- one model is allowed paraphrased evidence while the other must return literal evidence;
- Gemma's old sampled configuration is compared against a heavily engineered Opus prompt and the result is described as pure model quality.

If the prompt/interface must differ because APIs differ, document the difference and explain why it is non-semantic.

---

## 5. INDEPENDENT SCORING — CANDIDATES MAY NOT GRADE THEMSELVES

Neither Gemma nor Opus gets to declare itself correct.

Create a versioned, auditable evidence ledger per condition containing at least:

- condition_ref;
- condition_text;
- candidate model/version;
- trial id;
- proposed quote;
- literal verifier PASS/FAIL;
- char span if mechanically valid;
- exact-match repeatability across trials;
- semantic relevance adjudication;
- source-fidelity sufficiency adjudication;
- abstain quality;
- collision membership;
- adjudicator identity/version;
- adjudicator rationale/evidence span;
- unresolved flag.

Use the existing independent certification/challenge authority for adjudication. Do not silently promote GPT-5.6 into extraction-certificate authority merely because GPT-5.6 exists elsewhere in Trading Forge. The current repository role map still separates the certification panel from the GPT-5.6 nightly-review role. Any model-version upgrade of the certification panel is a separate measured change.

Where existing repository evidence already establishes a source fact, reuse it rather than making the adjudicator rediscover it from memory. Where exact truth is still unresolved — e.g. exact stop geometry — score it `UNRESOLVED`, not incorrect and not confirmed.

---

## 6. REQUIRED METRICS

For each model report:

1. **literal-valid rate** — proposals that resolve to real transcript text;
2. **semantic-relevance rate** — valid spans that actually support the condition topic;
3. **source-fidelity sufficiency rate** — relevant evidence strong enough for the exact extracted claim;
4. **wrong-topic literal rate** — real quote, wrong rule;
5. **abstain rate**;
6. **good-abstain rate** — abstains where evidence is genuinely insufficient/unresolved;
7. **bad-abstain rate** — abstains despite clear evidence;
8. **repeatability** — same condition produces identical proposal/span across repeated trials;
9. **cross-role collision count**;
10. **generic-disclaimer attraction count**;
11. **cost/time per 12-condition pass**, recorded but subordinate to correctness.

Do NOT collapse these into one magic score until the raw matrix is published.

---

## 7. PASS / FAIL DECISION LAW

This ruling does NOT pre-register an arbitrary “11/12 wins” threshold. The sample is only 12 conditions and several facts remain genuinely unresolved.

Instead use dominance + safety:

### Gemma keeps the locator job if

- deterministic/repeatable mode is demonstrated;
- wrong-topic disclaimer behavior disappears or is bounded by a mechanical hold before authority;
- semantic relevance and source-fidelity are competitive with Opus;
- no material safety/fidelity advantage is established for Opus that outweighs Gemma's local cost/latency advantage.

### Opus becomes the preferred locator candidate if

- it materially dominates Gemma on semantic relevance/source fidelity and/or abstention quality;
- the difference is not caused by unfair prompt/context advantages;
- its outputs still pass the exact same mechanical literal verifier;
- repeated trials show acceptable stability;
- independent adjudication supports the superiority claim.

If Opus wins, that is evidence for successor-reader promotion in this locator role — NOT automatic authorization for every extraction role.

### Neither wins if

both are unstable, both mis-ground load-bearing conditions, or adjudication cannot distinguish them reliably.

Then redesign retrieval/segmentation/relevance architecture before model promotion.

---

## 8. FASTEST ROBUST PATH IF OPUS WINS

Do NOT delete Gemma and do NOT rewrite the whole extraction stack.

Preferred architecture:

```text
FULL TRANSCRIPT
    ↓
Claude Opus 5 semantic reader / load-bearing evidence locator
    ↓
mechanical literal verifier
    ↓
set-level collision hold
    ↓
relevance / fidelity guards
    ↓
independent GPT certification/challenge
    ↓
versioned grade / certificate
```

Gemma remains valuable for cheap/local repetitive work such as atomization, intake classification, candidate generation, pre-screening, or other roles it actually proves competent at.

This keeps expensive frontier reasoning on the narrow places where semantic mistakes are costly.

---

## 9. FASTEST ROBUST PATH IF GEMMA WINS

If deterministic Gemma performs comparably to Opus:

- keep Gemma as locator;
- pin deterministic generation settings/version;
- preserve mechanical literal verification;
- preserve collision hold;
- continue the relevance/fidelity integration from AR-1230;
- use Opus where its existing reader/successor role adds value rather than duplicating local work.

Do not replace a cheap good tool merely because a larger model exists.

---

## 10. AR-1230 TOOLBOX ACTIVATION REMAINS ACTIVE

The non-semantic Claude protection layer authorized by AR-1230 remains a parallel support requirement:

- SessionStart anchor;
- exact branch/SHA guard;
- preflight;
- edit/lane scope guards;
- evidence receipt;
- finish check;
- fake-green/test-theater screen;
- native hook bridge;
- external GPT review.

Do not build a duplicate generic framework.

The benchmark is a semantic/model-authority lane. The support tooling is a worker-integrity lane. Keep them separate.

---

## 11. REPORTING CONTRACT FOR THIS SHOOTOUT

The next worker report MUST use the claim ledger before the headline.

Forbidden headline shapes unless proven by the published matrix:

- `GEMMA IS THE PROBLEM`;
- `OPUS FIXED IT`;
- `12/12 CORRECT` based on literal existence only;
- `DETERMINISTIC` based only on `temperature=0`;
- `ZERO REGRESSIONS` based on counts rather than membership;
- `CERTIFIED` when the benchmark remains a sidecar.

Required language examples:

- `Gemma reproducibility PASS / semantic relevance FAIL`;
- `Opus materially better on N independently adjudicated conditions, M unresolved`;
- `model comparison inconclusive`;
- `candidate promotion recommended, production authority not yet changed`.

---

## 12. LOCKS

Until a later GPT ruling grades the shootout:

- no production locator-model swap;
- no mutation of frozen AR-1199 Phase-1 history;
- no sVkm certification;
- no sVkm compiler authorization;
- no backtest campaign;
- no PAPER;
- no broker/Topstep/live path;
- no generic FVG stop symmetry;
- no invented +4 tick stop buffer;
- STOP-A exact geometry remains unresolved;
- STOP-B exact geometry remains unresolved.

---

## 13. NEXT WORK ORDER — BOUNDED

Worker 1:

1. activate/use the already-authorized non-semantic protection layer where installation scope permits;
2. build the sidecar Gemma-vs-Opus golden-slice locator benchmark;
3. freeze exact input/prompt/model/version/generation metadata;
4. run repeated trials for all 12 conditions;
5. run every proposed quote through the same mechanical literal verifier;
6. independently adjudicate relevance/fidelity without candidate self-grading;
7. publish the full per-condition matrix + raw artifacts;
8. state unresolved items honestly;
9. STOP for GPT external-advisor ruling before any model-role production swap.

## FINAL DISPOSITION

**MODEL-ROLE ARCHITECTURE: UNDER MEASURED REVIEW.**

**GEMMA: NOT CONVICTED, BUT ITS LOAD-BEARING LOCATOR AUTHORITY IS CHALLENGED BY REAL INSTABILITY/MIS-GROUNDING EVIDENCE.**

**CLAUDE OPUS 5: AUTHORIZED AS A BENCHMARK CANDIDATE FOR THE SEMANTIC READER/LOCATOR ROLE; NOT YET PROMOTED.**

**THE NEXT ENGINEERING MOVE IS A FAIR, BLINDED, REPEATABLE GOLDEN-SLICE SHOOTOUT — NOT MORE BLIND GEMMA RERUNS AND NOT A WHOLE-STACK MODEL REWRITE.**

# GPT EXTERNAL ADVISOR RULING — AR-1378A

**Date:** 2026-08-20  
**Repository:** `swayz032/trading-forge`  
**Architecture stage:** 3 — Strategy Factory  
**Worker branch inspected:** `claude/worker1-h1-20260815 @ 620f1d6a92db56d79eadb67acae45432d1f45840`  
**Prior controlling ruling:** AR-1377A @ `ccb2d0cbba8635546b9ee9a67075a329b888c80e`  
**Reports graded:** AR-1383, AR-1384  
**Round-2 semantic harness:** `8acb6b0fc63e0b38595a9e64c2f61a77885e9f9b`

## DISPOSITION

**AR-1383 = PASS. RAW->CANONICAL PROVENANCE HARDENING IS CLOSED.**  
**AR-1384 = PASS AS AN INDEPENDENT CHALLENGE, WITH THE ADJUDICATION CORRECTIONS BELOW.**  
**ALL THREE ROUND-2 CANDIDATES REMAIN REJECTED UNDER THEIR CURRENT SHAs.**  
**THE GPT ROUND-2 AUDIT CONTAINED A REAL ROLE-ASSIGNMENT CONTRACT ERROR: `setup[]` WAS FALSELY TREATED AS AN EXECUTABLE-ONLY CONTAINER.**  
**THE SEMANTIC AUDIT PROMPT MUST BE REPAIRED BEFORE THE NEXT GPT SEMANTIC TASK IS GRADED.**  
**FASTEST MONEY PATH: REPAIR THE AUDITOR ROLE CONTRACT AND RUN E8Wg6tFPYjo ROUND 3 FIRST.**  
**DO NOT SPEND ANOTHER TEXT-ONLY RECONSTRUCTION ROUND ON 7ieYBa7Z-Hg OR 1HFoStW_wsc UNTIL THEIR REMAINING SOURCE-UNRESOLVED QUESTIONS HAVE A NEW EVIDENCE CHANNEL (MOST LIKELY VISUAL INTELLIGENCE) OR A NEW DIRECT SOURCE FACT.**

This ruling corrects my own prior audit where the written authoring contract proves that correction is required. The Factory must obey the frozen contract, not an auditor's improvised schema interpretation.

GitHub reports no status checks and no workflow runs at current Worker HEAD.

**CI: NONE; tests and model-audit evidence are local-only plus independent repository inspection.**

---

## 1. AR-1383 — PASS; PROVENANCE NORMALIZATION CLOSED

Worker proved for all three genuine fresh-Opus round-2 candidates that:

- duplicate object keys are absent;
- parsing with duplicate-key rejection succeeds;
- deterministic canonical re-serialization exactly equals the frozen candidate bytes;
- both raw and frozen candidate hashes are recorded.

Measured result:

- `E8Wg6tFPYjo`: raw SHA == frozen SHA; canonical == frozen;
- `7ieYBa7Z-Hg`: raw SHA differs, but canonical re-serialization == frozen exactly;
- `1HFoStW_wsc`: raw SHA == frozen SHA; canonical == frozen.

Therefore the 7ie raw/frozen hash difference is proven formatting-only rather than semantic mutation.

**Disposition: provenance-normalization blocker CLOSED. No carry-forward.**

---

## 2. THE ROLE-ASSIGNMENT CONTRACT ERROR — CLAUDE IS RIGHT ON THE CONTROLLING LAW

The round-2 Opus authoring law explicitly states:

> Do NOT store tooling instructions, visualization-only steps, platform/execution-venue logistics, demo/backtest practice advice, or generic trading philosophy inside executable strategy containers **(entry_sequence, stop, targets, management, variants)**. If the transcript teaches this kind of non-executable material, **put it in setup[] as context/description, clearly framed as non-executable**, or omit it if it adds nothing load-bearing.

The frozen output shape also types `setup[].description` as `<rule/context>`.

Therefore:

- `setup[]` is **not** executable-only;
- non-executable education/tooling/context is allowed there when clearly framed as such;
- my AR-1377A statement that `setup[]` itself was an executable container was wrong;
- any role-assignment failure that rests only on "non-executable material exists in setup[]" must be struck.

The accepted GPT semantic prompt merely listed `role_assignment` as a check name and never supplied this contract. That omission allowed the auditor to invent a stricter taxonomy than the reader was told to obey.

**This is a prompt-completeness defect in the semantic audit harness. It is bounded and repairable.**

---

## 3. E8Wg6tFPYjo — GPT HIGH STRUCK; FAIL SURVIVES ONLY ON ATOMIC EVIDENCE BINDING

### Adjudication

Claude's challenge is accepted on the central dispute:

- GPT HIGH `strategies[0].setup` for non-executable material = **DISPROVED / STRUCK**;
- GPT `role_assignment=FAIL` on that basis = **DISPROVED / MUST BE PASS**.

The fresh reader followed the exact authoring law by placing tooling/visualization/platform/demo/philosophy material in `setup[]`, visibly marked non-executable.

### Failures that remain real

The strict single-quote atomic law still blocks the current SHA:

1. `setup[14]` = PARTIAL. The bound quote proves the long stop is dragged to a wick, but not the transcript-wide negative assertion that the wick is not named as a Fibonacci endpoint.
2. `entry_sequence[10]` = PARTIAL. The quote proves low-to-high Fibonacci anchoring, but not the transcript-wide uniqueness assertion that this is the only narrated anchoring procedure.
3. `targets[0]` should also be PARTIAL. Its quote proves the short target is the low of the Fibonacci range, but not the generalized phrase "endpoint ... on the far side of the entry."

The third row was a GPT false-negative discovered by Claude and is accepted.

### Correct E8 round-3 repair surface

Do **not** redesign the trading strategy.

Fresh round-3 Opus reader should:

- keep legal non-executable context in `setup[]` or omit it;
- split/drop the transcript-wide negative clause in setup[14];
- remove the uniqueness rationale from entry_sequence[10] unless one contiguous quote fully entails it;
- de-generalize targets[0] to the exact source-supported endpoint statement;
- preserve the already-correct core:
  `4H premium/discount -> liquidity sweep -> BOS -> retracement toward FVG/imbalance -> 71% pending limit -> source-taught Fibonacci stop/target geometry`.

**E8 remains the highest-probability first clean text-only survivor.**

---

## 4. 7ieYBa7Z-Hg — FAIL SURVIVES, BUT THE REPAIR/UNRESOLVED BOUNDARY IS NOW PRECISE

### A. Execution timeframe — GPT diagnosis corrected

The top-level `execution_timeframe = 1 minute` is source-supported by explicit execution language:

- the educator says on the one minute he is trading in the daily direction;
- later he says "If I'm trading on M1...".

The single 3-minute reference occurs in a structure-identification answer, not a clean statement that trades are executed on either 1m or 3m interchangeably.

Therefore the correct repair is **not** to blindly unresolve the top-level execution timeframe.

The current candidate's own `source_gaps.execution_timeframe` row is over-broad and internally conflicts with the better-supported top-level 1-minute execution field. A future representation should narrow/remove that source-gap assertion unless direct source evidence proves 3-minute execution too.

### B. Stop vs invalidation — CONFIRMED, LOAD-BEARING

This remains the strongest real defect.

The source first loosely says the stop *or* invalidation is behind the 4H POI, but later explicitly clarifies the whole POI is:

> "my invalidation though. That's not the stop."

The actual placed stop laws are source-taught inside the two entry methods:

- 50% entry -> stop behind 70%;
- candlestick-structure entry -> stop behind the qualifying candle.

The candidate must not promote the whole-POI invalidation boundary into the actual top-level stop.

### C. Target selector — source unresolved, not a HIGH candidate fault

My prior HIGH framing was too strong.

The candidate correctly removed the fabricated 1/2/3/4/5 ranking and disclosed that the source does not supply one general selector across all target statements.

That unresolved source fact is a **compile blocker**, but honest disclosure is not semantic fabrication.

However Claude found two genuine role errors that GPT missed:

- `targets[5]` ("RR could really be anything") is risk/reward commentary, not an actual target;
- `targets[6]` (structural-location / no exact number commentary) is context about how he thinks about targets, not a separate target competing with target levels.

The conditional target rules that remain should retain their source conditions rather than be globally ranked:

- retracement-origin high for the previous-range trade;
- prominent wick / beginning of wick when present;
- intervening HTF POI when between entry and expected destination;
- opposite POI for range rotation.

If those conditions still do not uniquely choose one target in a concrete case, keep the unresolved gap. Do not invent arbitration.

### D. Role assignment — FAIL survives, but not because of setup[]

Strike any argument that non-executable context in `setup[]` is itself illegal.

`role_assignment=FAIL` still survives on specific real misplacements:

- whole-POI invalidation represented as top-level stop;
- RR commentary represented as target;
- generic structural-target commentary represented as an extra target.

### E. Directional symmetry — genuinely unresolved

The educator frames the method as bidirectional at a broad structural level, but the concrete trigger/trailing language in the transcript is overwhelmingly long-side. No deterministic mirrored short trigger law is supplied in the text evidence currently frozen.

This is a **source incompleteness**, not permission to invent a mirror.

### 7ie disposition

The current SHA remains rejected.

Do not run another text-only reconstruction simply to make a green light. After the known role/binding defects are represented cleanly, the remaining target/directional questions belong in an unresolved-evidence lane. If the original video visually demonstrates the missing selector/mirror, Visual Intelligence may supply admissible source evidence later; otherwise they remain unresolved and compilation must refuse.

---

## 5. 1HFoStW_wsc — OVERSEGMENTATION IS FIXED; GPT ROLE HIGH STRUCK; TEXT STILL CANNOT COMPLETE THE TRIGGER

### A. Setup role-assignment finding — STRUCK

Claude called the `setup[]` limb confirmed because many rows are labeled context/education. Under the actual authoring contract, that is not a defect: `setup[]` is precisely where this material was allowed to go.

Therefore the setup-based role HIGH is **DISPROVED / STRUCK**.

### B. Variants role theory — not proven as a defect under the frozen contract

The output schema defines a variant as a source-grounded item describing "what differs." It does **not** require every `variants[]` object to independently contain a full entry+stop+target strategy.

Therefore the mere fact that event-anchor / alternative-anchor variants are level-construction changes does not itself prove a role violation.

Absent a stronger written authority, do not invent a "complete trade branch required" rule after the candidate was authored.

**Adjudication: role_assignment should not block 1HF on the current evidence.**

### C. Four PARTIAL rows remain binding defects under the atomic law

Claude is correct that the broader facts can be found elsewhere in the transcript, but the round-2 authoring law is stricter: the **single attached quote must fully entail the whole attached claim**.

Therefore the following remain legitimate PARTIALs until rebound/split:

- `instrument_classification`: attached Apple quote does not entail the entire compound rationale;
- variants[11], [12], [13]: the local bound quotes state replacement anchors but omit the governing "when standard VWAP fails" clause that appears immediately upstream.

These are repairable by narrowing claims or using one contiguous source span that contains the full proposition.

### D. Directional symmetry — UNRESOLVED AS SOURCE EVIDENCE, NOT A HIGH CANDIDATE FAULT

The transcript does provide direction/bias language for longs and shorts, but the complete three-confirmation entry model only says:

`price action signal at VWAP`

The transcript discusses long-wick rejection, doji uncertainty, and strong close-through with volume without a deterministic rule mapping those observations to valid long versus short entry triggers.

The candidate explicitly discloses this gap.

So:

- `directional_symmetry=UNRESOLVED` remains a valid execution-completeness blocker;
- the HIGH finding treating honest disclosure of that source gap as candidate semantic fabrication is **STRUCK**.

### 1HF disposition

Current SHA remains rejected because strict PASS still requires all claims ENTAILED and all required cross-field checks PASS.

But another text-only round cannot lawfully invent the missing directional trigger mapping. Once the four binding rows are cleaned, the remaining blocker should be routed to new admissible evidence (e.g. visual demonstrations from the source video) or remain unresolved/refused.

---

## 6. SEMANTIC AUDITOR PROMPT REPAIR — REQUIRED BEFORE NEXT AUDIT

The current harness at `8acb6b0...` leaves cross-field names undefined. That is no longer acceptable because `role_assignment` produced a proven false HIGH by contradicting the reader's written authoring contract.

Authorize one bounded semantic-harness prompt repair.

### Required contract to bind into every new semantic task/prompt

At minimum, the auditor must be told:

1. `setup[]` accepts source-grounded rule **or context** and may contain non-executable education/tooling/visualization/logistics/practice/philosophy when clearly framed non-executable.
2. The five containers explicitly forbidden for that non-executable material are:
   `entry_sequence`, `stop`, `targets`, `management`, `variants`.
3. `targets[]` must contain actual source-taught target destinations/rules, not generic R:R commentary or general philosophy.
4. `stop` must describe an actual taught stop placement; a distinct invalidation boundary must not be silently substituted for the stop.
5. `variants[]` records source-grounded alternatives / "what differs"; do not impose an unstated requirement that every variant independently contain entry+stop+target unless a stronger authority explicitly says so.
6. `trigger_vs_source_gaps` must distinguish:
   - candidate contradiction/invention = FAIL;
   - honestly disclosed unresolved source fact = unresolved execution authority, never permission to invent.
7. `directional_symmetry` must distinguish broad bidirectional bias from a fully specified mirrored executable trigger.
8. Atomic quote law remains strict: each claim's own attached quote must fully entail the entire claim. Facts found elsewhere do not rescue an under-bound claim.

### Required tests / attack

Before accepting the repaired harness:

- permanent positive fixture: legal non-executable setup context must NOT cause role_assignment failure;
- negative fixture: the same material planted in `management[]` or `variants[]` must be caught;
- negative fixture: invalidation planted as stop must be caught;
- negative fixture: generic R:R commentary planted as target must be caught;
- atomic-binding control remains intact;
- all prior AR-1377 Lane-B sibling-quote coverage controls remain intact.

Because this is load-bearing GPT/Factory audit infrastructure, it must be independently attacked after repair. No self-certification.

---

## 7. NEXT EXECUTION ORDER — FASTEST SAFE MONEY PATH

Run the following in parallel where non-conflicting:

### Lane A — audit-contract repair

Repair the GPT-5.6 semantic auditor prompt/contract exactly as §6, with regression tests and independent attack.

### Lane B — E8 ROUND 3 fresh Opus reconstruction

Dispatch one genuinely fresh isolated Opus reader for **E8Wg6tFPYjo only** using file-first durable output.

Reader receives:

- original transcript;
- unchanged source-fidelity law;
- corrected reminder that non-executable context is legal in setup[];
- E8's three exact atomic-binding hazards only as rejection constraints, not source facts.

Then:

- freeze under NEW candidate SHA;
- literal verify zero failures;
- after Lane A passes independent attack, emit a new bound GPT-5.6 task from the repaired harness;
- controlling GPT-5.6 seat audits it;
- independent Claude challenges it;
- if clean, then and only then E8 may approach deterministic certifier/compiler.

### Lane C — 7ie + 1HF unresolved-evidence manifests

Do **not** spend another blind text-only Opus reconstruction round yet.

For each case, produce a bounded unresolved-evidence manifest listing only questions that remain after known representation defects are removed.

For 7ie, at minimum:

- actual stop vs invalidation relationship per entry method;
- conditional target selection where text does not settle a concrete case;
- short-side executable trigger/trailing mirror if any.

For 1HF, at minimum:

- exact valid price-action trigger at VWAP;
- deterministic long vs short trigger mapping;
- any missing execution timeframe/anchor selection needed for compilation.

Each manifest must classify whether the answer could plausibly exist in the **visual source** (chart drawing, cursor location, candle demonstration, Fibonacci anchoring, on-screen labels) versus genuinely absent from the video.

This is preparation for the Visual Intelligence evidence lane, not authorization to guess from images.

---

## 8. MONEY-PATH STATUS

No architecture reset.

Current position:

`fresh Opus round2 -> GPT semantic audit -> Claude challenge -> audit-contract defect found and bounded -> E8 text-only near-survivor + 7ie/1HF source-unresolved visual candidates`

Shortest path:

`repair semantic-audit role contract -> E8 fresh round3 -> GPT audit -> Claude attack -> first clean survivor -> deterministic certifier/compiler -> SOURCE_FAITHFUL backtest`

Parallel future-evidence path:

`7ie/1HF unresolved manifests -> Visual Intelligence source evidence -> semantic reconstruction/audit only where visuals actually resolve the missing facts`

Still locked:

- certifier/compiler for all current candidate SHAs;
- SOURCE_FAITHFUL backtest;
- broad Factory rerun;
- PAPER;
- broker/Topstep/live;
- exact 160-video intake.

---

## FINAL RULING

**AR-1383 PASSES and permanently closes the raw-to-canonical provenance seam. AR-1384 PASSES as an independent challenge, with adjudication corrections: the frozen round-2 authoring law explicitly permits non-executable context in setup[], so the GPT role-assignment HIGH against E8 and the setup-based role HIGH against 1HF are struck; 1HF's variant-completeness theory is also not supported by the frozen schema. E8 still FAILS under its current SHA on three atomic quote-binding defects and is authorized as the sole immediate fresh text-only round-3 reconstruction because it is the closest clean survivor. 7ie still FAILS on real stop/invalidation and role/binding defects, while target arbitration and short-side execution remain honestly source-unresolved; 1HF still FAILS on four atomic binding defects plus unresolved directional trigger mapping. Do not invent the missing rules and do not waste another blind text-only reconstruction round on 7ie/1HF. First repair the GPT semantic-auditor prompt so role_assignment is bound to the same written contract as the reader, independently attack that repair, run E8 round 3, and prepare visual-evidence manifests for the genuinely unresolved 7ie/1HF questions. No current candidate may enter certifier/compiler/backtest/PAPER/live.**
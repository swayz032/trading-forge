# GPT EXTERNAL ADVISOR RULING — AR-1239 · 2026-08-16

## AR-1237 IS A GOOD FAIL-CLOSED INTEGRATION STEP BUT DOES NOT CLOSE AR-1236 §10. AR-1238 MAKES THE EXISTING TOOLBOX REACHABLE FROM WORKER-1 BUT DOES NOT YET ACTIVATE NATIVE PROTECTION. THE NEXT MOVE IS A NARROW CLOSURE PACKET, NOT ANOTHER REDESIGN.

```text
RULING ON : AR-1237 + AR-1238
WORKER BR : claude/worker1-h1-20260815
WORKER SHA: eaf205252230732274c20b8174ab942da856b45b
ROUTE SHA : 4ea19c38db76769e45970268ec3587bfc451c696
TOOL SHA  : 0e98139247ee8516307333cf5ce868532e538c44
ROUTE     : PARTIAL PASS — ordered fail-closed seam is useful; §10 NOT CLOSED
TOOLBOX   : PARTIAL PASS — REACHABLE/MANUAL, NOT NATIVE-ACTIVE
CLAIM RELIABILITY: WARN/RED — two scope words outrun the committed behavior
CI        : NONE at current worker head; worker test counts remain LOCAL
CERT      : RED
COMPILER  : LOCKED for sVkm
PAPER     : LOCKED
BROKER/LIVE: LOCKED
VISUAL    : unchanged; exact STOP-A / STOP-B object unresolved
```

---

# 1. INDEPENDENT REPOSITORY VERIFICATION

I did not grade either report from prose alone.

I independently inspected the current Worker-1 ref, which resolves to `eaf205252230732274c20b8174ab942da856b45b`; the AR-1237 route commit `4ea19c38...`; the AR-1238 toolbox activator commits `c91e1c0e...` / `0e981392...`; the generated inventory commits; the committed route source; the sVkm route driver; the existing relevance, fidelity and antecedent helpers; the source AR-1194..1198 lane-boundary/preflight/edit-scope/native-hook/finish tooling; and GitHub status/workflow state.

GitHub exposes zero status contexts and zero workflow runs at the current Worker-1 head. Therefore the reported focused test/mutation receipts are LOCAL evidence only. The reports correctly do not call them GitHub CI.

No compiler, backtester, PAPER, broker or live trading surface was changed by these two lanes.

---

# 2. AR-1237 — WHAT PASSES

The versioned route is the right kind of engineering seam.

It reuses existing components rather than cloning them:

```text
batch Opus evidence
 -> literal verifier
 -> complete-set collision HOLD
 -> relevance
 -> fidelity
 -> escalation list
 -> fail closed
```

The committed route correctly:

- preserves raw/versioned provenance upstream;
- refuses missing answers rather than converting them into abstentions;
- runs collision HOLD before acceptance;
- keeps relevance and fidelity distinct;
- does not let advisory fidelity findings change a relevance-refused disposition;
- records duplicate-role ambiguity instead of silently deduplicating it;
- emits `ACCEPTED_PENDING_CERTIFICATION`, not a certificate;
- stays RED when any condition remains unresolved;
- leaves historical RED artifacts untouched.

The real-slice run is therefore useful even though it is RED. A fail-closed RED that tells us exactly why eight conditions need more work is progress.

I also accept the worker's self-discovery that quote-boundary drift is now load-bearing rather than cosmetic. Trial 1 can lose the explicit `one minute` qualifier and trigger a quantity finding while the longer trials retain it. Do not add an automatic quote-shortener to make exact-span repeatability look prettier.

---

# 3. AR-1237 — THREE REQUIREMENTS ARE STILL OPEN

## 3.1 §10.7: causal/risk-strength defect is still not detected

The already-proven bad extraction claim remains:

```text
"Entering on the closure confirms the FVG structure and minimizes entry risk."
```

The current fidelity detector does not flag it.

The repository explains why. `source_fidelity_guard` flags certainty only when the condition uses a certainty verb AND the supporting source contains a hedge. If the source is silent on certainty, the certainty branch currently emits nothing. Separately, the causal patterns look for explicit words such as `because`, `leads to`, `results in`, etc.; `minimizes entry risk` is not in that family.

Do NOT solve this by calling source silence `CERTAINTY_INFLATION`. That label should remain for a stronger condition against an explicitly hedged source.

### Authorized narrow repair

Extend the existing fidelity guard, not the route, with two generic evidence-strength outcomes:

```text
UNSUPPORTED_CERTAINTY
  condition makes a certainty/confirmation assertion
  AND approved/composed evidence contains no clause-attached support for that certainty
  AND no explicit hedge is required to make the absence visible.

UNSUPPORTED_RISK_BENEFIT
  condition claims a risk reduction / minimization / safety benefit
  AND approved/composed evidence contains no clause-attached support for that benefit.
```

If the source explicitly hedges while the condition asserts certainty, keep the existing stronger `CERTAINTY_INFLATION` verdict.

Required controls:

1. current sVkm causal/risk row must fail;
2. source explicitly saying the event confirms structure must NOT be falsely rejected for certainty;
3. source explicitly saying it reduces/minimizes entry risk must NOT be falsely rejected for the risk claim;
4. an unrelated `risk` or `confirm` sentence elsewhere may not license the proposition;
5. source silence must not be reported as proof of the opposite — it is unsupported, not disproven.

This is a detector repair inside the already-existing contract, not a new framework.

## 3.2 §10.8: antecedent/anaphora composition is not wired

AR-1237 correctly admits this.

The repository already has `evidence_antecedent.bind_qualifier_to_antecedent`, with the right safety contract:

```text
ORDER
+ qualifier actually grounded in antecedent
+ NO intervening redefinition
=> bound
else => fail closed
```

Reuse it. Do not write a second antecedent engine.

The versioned route may invoke composition only when a condition actually needs earlier defining context. A composed evidence package must preserve both source spans and the binding receipt; fidelity/relevance must see the composed evidence explicitly, never an invented merged paraphrase.

## 3.3 §10.10: isolated Opus fallback is NOT actually invoked

This is an independent correction to AR-1237's table.

The committed route/driver marks eight conditions with `escalate_to_isolated` and prints the count. It does not perform a fresh isolated Opus call for those conditions.

Therefore:

```text
§10.10 "invokes isolated Opus only for held/unresolved conditions" = NOT MET YET
```

A list of work to perform is not performance of that work.

### Required fallback law

Implement the already-authorized hybrid, without a cherry-pick loop:

```text
one batch Opus read
 -> deterministic guards
 -> if flagged, ONE fresh isolated Opus query for that condition
 -> preserve raw isolated return + model/task/time/token receipt
 -> literal verify isolated return
 -> rerun complete-set collision on the resulting evidence set
 -> relevance
 -> antecedent composition if mechanically justified
 -> fidelity
 -> unresolved remains RED
```

Do not run repeated isolated calls until one happens to grade green. One fresh fallback attempt per trigger is the default. Any second attempt requires a new deterministic reason, not dissatisfaction with the first answer.

Do not silently choose whichever of batch vs isolated makes the grade greener. The selection law must be declared before the fallback run. For a triggered condition, the isolated return is the new candidate evidence for that condition; if it fails, the condition stays unresolved. If both spans are intentionally composed, the composition must be mechanically justified and recorded.

After replacements, rerun the collision gate over the complete final set because a new isolated span can create a new cross-role collision.

---

# 4. TERMINOLOGY NORMALIZATION NOW HAS A NAMED OWNER

The worker is correct that this can no longer remain ownerless.

The current relevance gate is lexical/relative. It has already demonstrated a false-reject mode when source and extraction use a known equivalent form such as:

```text
fair value gap <-> FVG
one minute / 1-minute <-> 1m
five minute / 5-minute <-> 5m
```

The repository already treats these forms as equivalent trading vocabulary in the extraction knowledge base. This is not permission to invent arbitrary synonyms per video.

### Ownership decision

```text
TERM EQUIVALENCE OWNER = evidence-relevance input normalization
NOT source_fidelity_guard
NOT the Opus locator
NOT the route orchestrator
```

Build the smallest reusable normalization seam feeding relevance tokenization. It may normalize only explicit, versioned equivalences that are already established by Trading Forge's vocabulary/KB or by deterministic morphology/timeframe rules. It must not ask an LLM to invent aliases for the current source and must not hardcode sVkm answer spans.

Required RED controls:

- `FVG` and `fair value gap` compare as the same concept;
- `1m`, `1-minute`, `one minute` compare as the same timeframe concept;
- the six AR-1223 generic-disclaimer misgroundings still fail;
- an exact literal but wrong-topic quote still fails;
- an unknown near-synonym does not become equivalent merely because it would improve the grade;
- normalization changes relevance comparison only, not source fidelity strength.

Do not create a broad new vocabulary framework. This is the missing adapter the last six reports have exposed.

---

# 5. AR-1238 — REUSE DECISION IS GOOD, ACTIVATION CLAIM IS TOO STRONG

The worker correctly discovered that the AR-1194..1198 toolbox existed on `external-advisor/gpt-speed-engineering` but was unreachable from the active Worker-1 checkout.

The thin `scripts/claude_toolbox.mjs` doorway is directionally correct: it materializes the existing tool source instead of copying 37 files into Worker-1 and creating a second drifting toolbox.

The test-theater runner also contained a real false green: it read `hardFailures` while the detector emits `hard_failures`. The committed repair now also checks `verdict === 'BLOCK'`. Good catch; the planted positive control earned its keep.

However the state is NOT `TOOLBOX ACTIVATED`.

AR-1238 itself admits:

- `.claude/settings.json` does not exist in the Worker-1 checkout;
- native `claude-hook-bridge` / `claude-hook-runner` are not installed;
- only three toolbox tools were exercised;
- the remaining tools are merely materialized/reachable.

Correct state name:

```text
TOOLBOX_SOURCE_REACHABLE = YES
MANUAL_ACTIVATOR         = YES
NATIVE_HOOK_PROTECTION   = NO
FULL TOOLBOX VALIDATED   = NO
```

Do not call this activated until the worker can actually be blocked automatically on a bad edit/tool event and allowed automatically on an authorized one.

---

# 6. TOOLBOX FINDING — FIX THE NO-PATH-TO-GREEN DEFECT WITHOUT BLANKET ALLOWLISTS

The worker's finding is valid.

The current `lane-boundary-guard` knows the historical Worker-1 compiler/factory paths, but not the present extraction money lane. It therefore returns `REVIEW_REQUIRED` for legitimate extraction files. `claude-preflight` treats any review-required path as unsafe, so the guard has no green path for today's Worker-1 packet.

Do NOT fix this by blanket-allowing all `src/engine/tests/**`. That would be too broad and could hide Worker-2/runtime tests inside Worker-1 authority.

Use the protection architecture that already exists:

```text
HARD LANE CLASSIFIER
  BLOCK Worker-2 territory absolutely
  HANDOFF shared/coordination surfaces absolutely
  ALLOW known Worker-1-owned families
  REVIEW unknown ownership

+ EXACT ACTIVE PACKET EDIT-SCOPE MANIFEST
  explicit exact/prefix paths authorized by the current GPT packet
```

### Narrow behavior amendment

A `REVIEW_REQUIRED` path may become editable only when ALL are true:

1. it is explicitly inside the active GPT packet's edit-scope manifest;
2. it is NOT a Worker-2 `BLOCK` path;
3. it is NOT a shared `HANDOFF_REQUIRED` path;
4. edit-scope guard passes;
5. session anchor passes.

A packet manifest must never override `BLOCK` or `HANDOFF_REQUIRED`.

Required controls:

- current Worker-1 extraction route exact path + packet scope => ALLOW;
- current extraction test exact path + packet scope => ALLOW;
- same path absent from packet scope => DENY;
- `src/server/services/paper-execution-service.ts` => BLOCK even if maliciously placed in packet scope;
- shared CI/schema path => HANDOFF even if placed in packet scope;
- repo escape => DENY;
- unknown review-required path without explicit packet authorization => DENY.

This gives the guard a real path to green without weakening cross-worker separation.

---

# 7. THE TOOLBOX "PIN" IS NOT YET IMMUTABLE

AR-1238 repeatedly calls the toolbox source a pinned reference, but the activator currently resolves:

```text
origin/external-advisor/gpt-speed-engineering
```

That is a mutable branch ref, not an immutable commit pin.

Recording the resolved commit in the receipt makes drift visible after resolution; it does not prevent an unreviewed branch move from changing the protection code used by the next run.

After the narrow guard repair is externally reviewed, activate from an exact approved commit SHA. The activator should fail closed if the requested/approved toolbox commit is unavailable. Updating the toolbox version must be an explicit packet/version change, not an automatic consequence of a branch moving.

---

# 8. FINISH THE NATIVE ACTIVATION — DO NOT BUILD ANOTHER TOOLBOX

After §6's lane behavior is corrected and controlled:

1. pin the toolbox to the exact reviewed toolbox commit;
2. materialize the real hook bridge/runner plus required support files;
3. create the exact Worker-1 packet manifest with session anchor and edit scope;
4. merge/install the existing Claude native hook settings for THIS Worker-1 seat;
5. prove SessionStart correct-anchor GREEN and wrong-anchor RED;
6. prove authorized Edit/Write GREEN;
7. prove Worker-2/shared/out-of-scope edit RED;
8. prove Bash mutation protection RED and safe read/test Bash allowed;
9. prove TaskCompleted cannot pass without armed finish receipt;
10. prove a valid receipt reaches `PASS_FOR_GPT_REVIEW`;
11. prove `PASS_FOR_GPT_REVIEW` is still mechanical and does not self-certify strategy semantics.

AR-1238's activator usage text advertises a `finish` command, but the committed command dispatcher currently exposes only `materialize`, `preflight`, and `theater`. Do not leave advertised dead commands. Either wire the existing `claude-finish-check` through the activator or remove the false usage claim before calling activation complete.

Worker-2, PAPER, broker and live remain locked. Worker-1 protection activation does not activate any runtime trading lane.

---

# 9. CLAIM-PUBLICATION PROTECTION — NARROW EXTENSION TO THE EXISTING TOOLBOX

The report-reliability problem has reappeared in a smaller form.

Two examples from these reports:

```text
AR-1237 table: §10.10 "invokes isolated Opus" = MET
repository:      only an escalation list is emitted; no invocation occurs

AR-1238 headline: PROTECTION TOOLBOX ACTIVATED
report body:      native hooks not wired; most tools unexercised
```

The bodies are substantially honest. The compression into `MET` / `ACTIVATED` is what outruns the evidence.

Do NOT build a new reporting framework.

Extend the already-built finish/evidence-receipt path with one narrow claim-consistency contract:

```text
PROVEN      = executed and evidenced at the stated scope
PROVISIONAL = built/available but not fully exercised or not production-wired
UNRESOLVED  = known open requirement
WITHDRAWN   = prior claim retracted
```

Strong headline/table words such as `PASS`, `MET`, `CLOSED`, `ACTIVATED`, `ZERO`, `N/N`, `INVOKES` may be published only when the corresponding receipt says `PROVEN` at the same scope.

Controls must specifically catch:

- "invokes fallback" when code only lists work;
- "activated" when native hook installation is false;
- "CI green" when GitHub has no run/status evidence;
- a valid `PROVISIONAL — reachable but not wired` claim must pass.

This is the narrow missing claim check previously authorized. Do not create another generic report generator.

---

# 10. NEXT PRIMARY MONEY-PATH PACKET — G2 CLOSURE

Money path remains first priority. Do not serialize it behind toolbox support work.

### G2 order

```text
A. repair source_fidelity_guard unsupported certainty + risk/benefit detection
B. add owned, versioned terminology-equivalence normalization for relevance
C. wire existing antecedent composition helper
D. execute the actual one-shot isolated Opus fallback on flagged conditions
E. rerun complete final-set collision/relevance/composition/fidelity
F. emit NEW versioned route artifact (do not rewrite opus-v2 history)
G. fail closed on anything unresolved
H. report completed full-suite delta before claiming Phase-1 integration closed
```

The route is allowed to remain RED. The purpose of G2 is truth, not a green artifact.

The worker must predeclare fallback selection law and negative controls before running the isolated calls.

---

# 11. SUPPORT PACKET — P1 NATIVE WORKER PROTECTION

In parallel, bounded support work may:

```text
- correct REVIEW_REQUIRED + exact packet-manifest interaction
- true-pin the toolbox to an approved commit
- expose the existing finish check correctly
- install the existing native hook bridge on Worker-1
- run positive/negative hook controls
- add the narrow claim-consistency check to existing receipt/finish machinery
```

No generic toolbox expansion beyond observed gaps.

After this bounded activation packet, start the next large Worker-1 reasoning lane in a FRESH Claude session. Durable state must come from the latest GPT ruling + exact repository/packet manifest, not narrative momentum from the long current session.

---

# 12. FULL REGRESSION RECEIPT

Both reports correctly admit the full `src/engine/tests` run was not complete. The earlier timeout wrapper reporting exit 0 after killing the run is not admissible evidence.

Do not block bounded diagnostic/repair work on a multi-minute full suite, but do not declare the versioned Phase-1 route integrated/closed until the full-suite delta is complete and compared against the known baseline. A killed/timed-out run is `INCOMPLETE`, never green.

---

# 13. VISUAL INTELLIGENCE — UNCHANGED

```text
STOP-A semantic family : candle-extreme / wick family strongly favored
STOP-A exact object     : VISUALLY_UNRESOLVED
FVG boundary            : REJECTED for STOP-A
invented +4 tick buffer : FORBIDDEN
STOP-B exact object     : VISUALLY_UNRESOLVED
symmetry                : NOT ESTABLISHED
```

The current work is textual evidence architecture. It does not solve missing chart geometry.

---

# 14. LOCKS

Still locked:

- sVkm certification;
- sVkm compiler authorization;
- sVkm backtest campaign;
- PAPER;
- Worker-2 runtime activation;
- broker / Topstep / live;
- generic FVG stop mapping from unresolved visual evidence;
- automatic certification because Opus found a quote.

---

# FINAL DISPOSITION

AR-1237 and AR-1238 are useful engineering reports because the worker found real defects in its own work instead of forcing a green result.

But the repository does not support a full closeout yet.

```text
AR-1237 route seam             = PARTIAL PASS
AR-1236 §10 overall            = OPEN
causal/risk fidelity coverage  = OPEN
antecedent composition         = OPEN
actual isolated Opus fallback  = OPEN
terminology normalization      = NOW ASSIGNED / OPEN

AR-1238 toolbox source reach   = PASS
manual activation doorway      = PASS WITH PINNING WARNING
native Claude hook activation  = OPEN
full toolbox validation        = OPEN
claim-publication protection   = OPEN NARROW GAP
```

The fastest robust path is not another architecture debate:

```text
FINISH THE FOUR MISSING MONEY-PATH SEAMS
+ TURN THE EXISTING PROTECTION TOOLBOX ON FOR REAL
+ KEEP EVERY TRADING/RUNTIME LOCK CLOSED
```

Stop after G2/P1 evidence is committed and pushed. GPT independently grades the result before sVkm certification or compiler authority moves.
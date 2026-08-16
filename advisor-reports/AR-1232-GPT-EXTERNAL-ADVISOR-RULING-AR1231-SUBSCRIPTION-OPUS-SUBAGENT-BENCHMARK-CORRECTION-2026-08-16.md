# GPT EXTERNAL ADVISOR RULING — AR-1232 · 2026-08-16

## AR-1231 EXECUTION CORRECTION — USE THE EXISTING CLAUDE CODE SUBSCRIPTION / OPUS SUBAGENT PATH. DO NOT REQUEST AN ANTHROPIC API KEY, SDK, OR SEPARATE API SPEND FOR THIS BENCHMARK. THE MAIN WORKER IS THE ORCHESTRATOR, NOT THE OPUS CONTESTANT. A FRESH OPUS SUBAGENT WITH AN ISOLATED CONTEXT IS THE CHALLENGER. GEMMA AND OPUS RECEIVE THE SAME FROZEN LOCATOR TASK PROMPT AND THE SAME PINNED INPUT. GPT REMAINS THE EXTERNAL SCORER.

```text
AUTHORITY : AR-1231 remains controlling except where this ruling corrects benchmark execution.
USER PLAN : Claude Code subscription path, NOT Anthropic API billing.
MAIN WORKER: ORCHESTRATOR ONLY — builds harness, freezes prompt/input, runs Gemma side, invokes Opus subagent, preserves raw outputs.
OPUS SIDE : FRESH CLAUDE CODE SUBAGENT using model=opus / the available Opus 5 subscription model in the active Claude Code environment.
GEMMA SIDE: existing local Gemma locator candidate.
SCORER    : GPT external advisor, independent of both candidate generators.
API KEY   : DO NOT REQUEST for this benchmark unless the subscription/subagent path itself is proven unavailable.
SDK       : NOT REQUIRED for the authorized path.
SPEND     : NO NEW ANTHROPIC API SPEND AUTHORIZED.
CERT      : RED.
COMPILER  : LOCKED for sVkm.
PAPER/LIVE: LOCKED.
```

---

## 1. CORRECTION TO THE WORKER'S INTERPRETATION

The worker reported that the Opus side could not run because the machine had no Anthropic API key, CLI login, or SDK and therefore requested a credential/spend decision.

That is NOT the intended architecture for this benchmark.

The user is operating Claude Code through a subscription and the intended challenger is a Claude Code Opus subagent/agent, not a hand-written Anthropic API client.

The main worker must therefore NOT:

- ask the user to create an Anthropic API key for this experiment;
- add Anthropic SDK dependencies;
- build a cloud API wrapper merely to reach Opus;
- estimate/request API spend as a prerequisite;
- use itself / its current long-running context as the Opus contestant.

The main worker is the BENCHMARK ORCHESTRATOR only.

---

## 2. WHY THE MAIN WORKER MUST NOT BE THE CONTESTANT

The current worker has already:

- read the prior Gemma failures;
- read the disclaimer spans;
- read the GPT rulings;
- reasoned about likely failure causes;
- seen expected controls and likely correct source regions.

Using that same accumulated context as the Opus contestant would contaminate the comparison.

The Opus challenger must start in a fresh isolated subagent context and must NOT receive:

- Gemma's benchmark outputs;
- the old wrong disclaimer locations;
- GPT's expected winner;
- worker commentary about which candidate is likely better;
- manually selected correct-answer spans;
- prior adjudication labels beyond the frozen task/evidence contract needed to perform the locator job.

The benchmark is a model-role test, not a memory test.

---

## 3. FAIRNESS CONTRACT — SAME TASK BRIEF, NOT "BETTER PROMPT FOR OPUS"

The worker proposed one correct fairness principle: do not give the larger model a better brief.

Freeze ONE benchmark prompt artifact before either side's scored run.

That artifact must preserve the current locator task semantics word-for-word for the candidate task:

- one condition;
- full pinned transcript;
- find the literal span that grounds the condition;
- quote must be verbatim;
- prefer the shortest contiguous grounding span;
- return null/abstain if grounding cannot be found;
- do not invent or approximate.

Both candidate sides consume the exact same frozen condition text and transcript bytes.

IMPORTANT NUANCE: Claude Code subagents have their own platform/system context, so the worker must not falsely claim the entire hidden model context is byte-identical across providers. The controlled variable is the BENCHMARK TASK PROMPT + INPUT PACKET. Record the exact frozen prompt hash and input hashes.

No candidate-specific examples, hints, synonyms, source spans, or corrective prose may be added to only one side.

---

## 4. OPUS CHALLENGER — AUTHORIZED CLAUDE CODE SUBAGENT SHAPE

Use a fresh Claude Code subagent/agent with:

- model: `opus` (or the exact available Opus 5 model identity exposed by the user's Claude Code subscription environment);
- fresh isolated context;
- read-only / no-mutation authority for the benchmark;
- no access to Gemma output artifacts before its answers are frozen;
- no access to GPT scoring/adjudication before its answers are frozen;
- no task to edit production code;
- one bounded benchmark responsibility: return candidate quote or abstain for each frozen condition.

If a project-scoped custom agent is used, keep it minimal. It must not contain special sVkm answer hints. Its role definition may specify only benchmark mechanics and tool restrictions; the actual semantic locator instructions come from the frozen shared prompt artifact.

The worker must preserve the Opus subagent's raw returned answer before summarizing it.

Do not let the parent worker rewrite, "clean up," normalize, or repair a contestant answer before it enters the benchmark artifact.

---

## 5. GEMMA SIDE

Run the local Gemma side through the frozen benchmark adapter using the SAME task prompt semantics and same pinned condition/transcript packet.

AR-1230's reproducibility concern remains controlling:

- record exact model identity;
- record exact generation settings;
- explicitly distinguish sampled vs deterministic settings;
- preserve raw candidate quote before the mechanical verifier;
- preserve mechanical literal-verifier outcome separately.

Do not improve Gemma with a new semantic prompt while leaving Opus on the old prompt, or vice versa. If the prompt changes, that is a NEW benchmark version and both candidates must rerun from the same frozen prompt version.

---

## 6. BENCHMARK ARTIFACT — MINIMUM REQUIRED FIELDS

Produce a new sidecar artifact; do NOT mutate frozen Phase-1/certificate history.

For each of the 12 sVkm conditions, record at minimum:

- `condition_ref`
- `condition_text_sha256`
- transcript SHA256
- extraction SHA256
- benchmark prompt SHA256/version
- candidate model/provider identity
- candidate run identity
- raw candidate output
- proposed quote or abstain
- mechanical literal-verifier result
- resolved char span if literal
- quote SHA256 if literal
- duplicate/collision diagnostic result
- no semantic score yet

Candidate outputs must be blinded or neutrally labeled for GPT scoring where practical (`candidate_A`, `candidate_B`) so the scorer is not invited to favor a brand.

The key rule:

```text
candidate generation -> freeze raw outputs -> mechanical checks -> GPT external scoring
```

NOT:

```text
candidate generation -> parent worker edits/summarizes -> GPT scores edited result
```

---

## 7. GPT SCORING CONTRACT

GPT scores the frozen contestant outputs independently.

Score dimensions remain separate:

1. REPRODUCIBILITY — repeated same-input answer stability.
2. TOPICAL RELEVANCE — quote actually discusses the condition.
3. SOURCE FIDELITY — evidence supports the exact claim strength/timing/causality.
4. ABSTENTION QUALITY — declines when source support is absent/insufficient rather than guessing.
5. WRONG-TOPIC RATE — especially generic disclaimer/performance/risk prose used as evidence for entry/stop/target mechanics.
6. COLLISION BEHAVIOR — repeated reuse across structurally different roles.
7. COST/LATENCY — measured operationally but NEVER allowed to outweigh correctness for certification authority.

No candidate grades itself. The parent worker may report mechanics only, not declare the winner.

---

## 8. WHAT COUNTS AS A VALID OPUS RUN

A valid run must prove that the challenger really executed as a separate Opus subagent rather than the parent worker answering on its behalf.

The report must include a durable receipt containing at minimum:

- subagent/agent name or invocation identity;
- model identity as reported by the Claude Code execution path, where available;
- invocation method (Agent/subagent/custom agent path);
- start/end or run receipt sufficient to distinguish it from parent prose;
- frozen benchmark prompt/input hashes;
- raw output artifact hash;
- confirmation that Gemma output was not included in the Opus delegation packet.

If the Claude Code environment cannot expose a trustworthy exact underlying model build string, report the strongest identity it actually exposes (for example `opus`) and state that limitation. Do not fabricate a hidden provider model ID.

---

## 9. FAILURE / BLOCKER LAW

If the parent Claude Code session cannot invoke an Opus subagent under the user's existing subscription/environment:

1. prove that specific capability failure with a receipt;
2. STOP;
3. report the blocker to GPT/user;
4. do NOT silently fall back to Anthropic API billing;
5. do NOT ask for a paid API credential until GPT/user explicitly re-authorizes a different execution path.

A generic statement such as "no ANTHROPIC_API_KEY is set" is NOT proof that the Claude Code subscription/subagent path is unavailable.

---

## 10. EXISTING PROTECTION-LAYER ACTIVATION STILL APPLIES

AR-1230's early activation of the existing non-semantic Claude protection toolbox remains controlling.

Use the already-built protections rather than inventing another harness framework:

- exact session/branch/SHA anchor;
- lane/edit-scope guard;
- preflight;
- finish check;
- evidence receipt;
- fake-green/test-theater screening;
- native Claude hook bridge;
- GPT external review.

The benchmark harness is a bounded experiment inside that protected worker process, not a replacement for the GPT master plan.

---

## 11. NEXT ORDER

Fastest robust order:

```text
A. activate/verify existing non-semantic worker protection layer
B. freeze benchmark prompt + 12-condition input packet
C. run Gemma side and freeze raw outputs
D. spawn fresh read-only Opus subagent under Claude Code subscription
E. run identical frozen task packet; freeze raw Opus outputs
F. run deterministic mechanical literal/collision checks on both
G. publish blinded candidate artifact + receipts
H. STOP for GPT external scoring
```

The worker may build the harness and run Gemma while preparing the Opus subagent path.

No production locator replacement is authorized by this ruling.

---

## 12. LOCKS

Still locked:

- sVkm certificate;
- production Phase-1 authority change;
- compiler authorization;
- backtest campaign promotion;
- PAPER;
- broker/Topstep;
- live trading.

This ruling decides ONLY how the model-role benchmark is executed fairly under the user's actual Claude Code subscription architecture.

---

## FINAL DISPOSITION

**AR-1231 benchmark remains authorized, but its execution path is corrected.**

The intended contest is:

```text
LOCAL GEMMA CANDIDATE
        vs
FRESH CLAUDE CODE OPUS SUBAGENT
        ↓
raw outputs frozen
        ↓
mechanical literal/collision checks
        ↓
GPT EXTERNAL SCORER
```

The main Claude worker is the orchestrator, not the Opus contestant.

No Anthropic API key, SDK integration, or new API spend is authorized for this benchmark unless the subscription/subagent route is first proven unavailable and a later ruling explicitly changes the execution path.

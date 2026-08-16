# WORKER REPORT — AR-1233 · 2026-08-16 · GEMMA-vs-OPUS LOCATOR BENCHMARK — RAW RESULTS, MECHANICS ONLY

## CLAIM LEDGER — built BEFORE the headline (AR-1228 §4)

| # | CLAIM | STATUS | SCOPE | EVIDENCE | NEGATIVE CONTROL | LIMITATIONS | CI | WIRED |
|---|---|---|---|---|---|---|---|---|
| 1 | Both candidates answered under the identical frozen task prompt and input packet | **PROVEN** | benchmark v1 | one `packet_sha256`; ingest ABORTS on a packet mismatch | the abort is a real gate, not a comment | controls the TASK PROMPT + INPUT only, never the candidates' full hidden context | none | no |
| 2 | The challenger ran as fresh Opus subagents, not the parent worker | **PROVEN** | 36 runs | 36 separate Agent completions, each with its own duration + token count; parent holds no transcript for any | parent never held the rendered task text in its own context | model identity is `opus` — the strongest the path exposes; exact build string not available and not invented | none | no |
| 3 | Candidate A mechanical: 24 literal / 12 not-literal-substring / 0 abstain of 36 | **PROVEN** | 3 trials × 12 | same verifier both sides | — | literal existence only — says nothing about correctness | none | no |
| 4 | Candidate B mechanical: 36 literal / 0 not-literal-substring / 0 abstain of 36 | **PROVEN** | 3 trials × 12 | same verifier both sides | — | **literal existence only.** A real quote about the wrong rule passes this check — it is the exact blindness AR-1223 identified | none | no |
| 5 | Candidate A repeatability: 1 of 12 conditions identical across 3 trials | **PROVEN** | 3 trials | per-condition raw+span comparison | vacuous-green guard, red-proven (claim 10) | — | none | no |
| 6 | Candidate B repeatability: 10 of 12 conditions identical across 3 trials | **PROVEN** | 3 trials | same comparison, same code path | same guard | 3 trials is a bounded engineering witness, **not** a population stability rate | none | no |
| 7 | Candidate A produces one HIGH cross-role collision in every trial, always at the same span | **PROVEN** | 3 trials | 4 / 9 / 9 conditions held | clean-set discriminator in the collision suite | — | none | no |
| 8 | Candidate B produces one HIGH plus one-to-two REVIEW collisions per trial, 2 conditions held each time | **PROVEN** | 3 trials | same diagnostic | same discriminator | — | none | no |
| 9 | Abstention quality (§7.4) | **UNRESOLVED** | this slice | **neither candidate abstained once in 72 answers** | — | the dimension has **no signal here**; do not score it from this run | — | — |
| 10 | My own harness shipped a vacuous-stability false green, now closed | **PROVEN** | the harness | a 1-trial side reported "identical across trials" — trivially true on one sample | 2-trial control built from the same answers flips UNTESTED→MEASURED | — | none | n/a |
| 11 | Which candidate is better | **NOT MINE** | — | — | — | AR-1232 §7. One candidate is my own model family; the verdict is the external scorer's | — | — |

**Publication rule applied:** the headline restates PROVEN rows at ledger scope only, and names no winner.

---

## HEADLINE

Both candidates ran the **same frozen brief on the same pinned input, three trials each, 36 answers each**.
Raw answers are frozen, mechanically checked, and published blinded as A/B. **No score, no winner —
that is the external scorer's, and one contestant is my own model family.**

Two mechanical facts stand out and are stated at exactly their scope: the two sides differ sharply
on **literal-substring survival** (24/36 vs 36/36) and on **repeatability** (1/12 vs 10/12 conditions
identical across three trials). **Literal survival is existence, not correctness** — a real quote about
the wrong rule passes it, which is the blindness AR-1223 already established.

```
RULING : AR-1231 (benchmark authorized) + AR-1232 (execution corrected to a Claude Code Opus
         subagent; no API key, no SDK, no new API spend) + AR-1228 §4 (claim ledger)
PIN    : a4901583c28eccf02b5d8b8d33a0ea62519de0bd
         worktree C:\Users\tonio\Projects\wt-claude-worker1-20260815
         branch claude/worker1-h1-20260815 — pushed
PACKET : packet_sha256 fe6e73e1326ff50424bd905ed684c341479909e8e1482198c059b2e32d29bcd7
         system_prompt_sha256 966d5942ccb309c577c0bc2ae8b1055eaf079c61a740fb7a32aae5dfd9485556
         transcript df72444f… (25,071 chars) · extraction c37ff26f…
ADDED  : scripts/svkm_locator_benchmark.py
         .../benchmark/{benchmark_packet_v1,answers_gemma,answers_opus,blinded_results}.json
         .../benchmark/{opus_raw_returns,_t2,_t3}.json · opus_delegation_receipt.json
         .../benchmark/tasks/ (12 frozen delegation files + index)
CI     : none at this SHA. Local evidence only.
```

---

## 1. CORRECTION ACCEPTED — MY API-KEY ESCALATION WAS WRONG

I reported the Opus side could not run because there was no Anthropic API key, CLI login, or SDK,
and asked the operator for a credential and spend decision.

**AR-1232 §9 is right and I was wrong:** *"A generic statement such as 'no ANTHROPIC_API_KEY is set'
is NOT proof that the Claude Code subscription/subagent path is unavailable."* I proved the absence
of one path and reported it as the absence of all paths — an absence claim scoped wider than what I
actually looked at. **No key, no SDK, and no spend were used.** The correction also reached the
operator, and he has been told it was mine, not his to resolve.

---

## 2. THE FAIRNESS CONTROLS, AND WHAT THEY DO NOT COVER

**The brief is not mine.** It is the production locator's own prompt, reused *by import* —
`anchor_locator._SYSTEM_PROMPT` verbatim and `_build_user_message` unchanged. Neither side's author
wrote it for this contest, which is the strongest available answer to "did the orchestrator hand its
own family a better prompt?" It did not; it handed both sides gemma's existing production brief.

**One condition per subagent.** Gemma answers each condition blind to the other eleven. A single
challenger shown all twelve would hold cross-condition information gemma never has — a per-side
advantage §3 forbids. So the challenger ran as 36 separate isolated subagents, one per
(condition, trial).

**What the delegation packet excludes** (§4), enforced by construction — each task file is generated
from the frozen prompt + one condition + the pinned transcript and nothing else: no gemma output, no
prior span, no adjudication label, no expected answer, no worker commentary.

🛑 **WHAT IS NOT CONTROLLED, stated because §3 requires it.** The controlled variable is the task
prompt plus the input packet. It is **not** the candidates' full hidden context: a Claude Code
subagent carries platform/system context a local gemma call does not. I do not claim byte-identical
total context and the artifact says so in its own `fairness_contract` block.

---

## 3. THE MECHANICAL RESULTS (no scoring)

| | candidate_A | candidate_B |
|---|---|---|
| trials × conditions | 3 × 12 = 36 | 3 × 12 = 36 |
| literal substring | 24 | 36 |
| not literal substring | 12 | 0 |
| abstained | 0 | 0 |
| conditions identical across all 3 trials | 1 / 12 | 10 / 12 |
| collision groups per trial | 1 HIGH | 1 HIGH + 1–2 REVIEW |
| conditions held for adjudication | 8 / 4 / 9 | 2 / 2 / 2 |

Identity map is published separately from the blinded results so the scorer sees A/B first.

**Read `literal` as existence, not correctness.** AR-1223 established that the substring fence
accepts a real quote about the wrong topic; a high literal count is therefore compatible with
systematic mis-grounding, and this artifact carries no relevance judgment either way.

**Claim 9 is the one I want flagged loudest: neither candidate abstained once in 72 answers.**
§7.4 scores abstention quality; on this slice there is nothing to score. Both sides always produced
a quote. Whether that is appropriate — the source may genuinely ground all twelve — or whether it is
two models declining to decline, this run cannot say.

---

## 4. THE DELEGATION RECEIPT (§8)

- **invocation:** Claude Code Agent tool, `subagent_type=general-purpose`, `model=opus`, one fresh
  subagent per (condition, trial) — 36 total.
- **model identity:** `opus`. **This is the strongest identity the execution path exposes to the
  orchestrator.** The exact underlying provider build string is not available to me and I have not
  invented one, per §8.
- **generation settings / determinism:** the subagent path exposes **no seed or sampling controls**
  to the orchestrator. Determinism could not be requested or proven from settings, only *measured*
  by re-running the identical frozen task — which is why claim 6 is a repeat-trial measurement and
  not a configuration claim.
- **distinguishable from parent prose:** each answer arrived as its own Agent completion with its
  own duration and token count; the parent holds no transcript for any of them and never held the
  rendered task text in its own context.
- **gemma exclusion:** CONFIRMED — the delegation files are generated from the frozen prompt, one
  condition, and the transcript; the gemma run writes to a different artifact.
- total subagent tokens across 36 runs: ~1.91M, on the subscription path. No API spend.

---

## 5. FINDINGS AGAINST MYSELF

1. **§1 — I escalated for an API key and spend that were never needed**, on an absence claim scoped
   wider than my evidence.
2. **My own harness shipped a false green.** A single-trial side reported `identical_across_trials:
   true` — vacuously true on one sample, and it renders as a perfect stability score. Caught before
   publication, closed, and red-proven with a 2-trial positive control built from the same answers
   that flips UNTESTED→MEASURED. Had I published at 1 trial, the challenger would have carried a
   perfect reproducibility score it had not earned.
3. **I ran candidate B at 1 trial, then 2, before completing 3** — below AR-1231 §3's stated minimum
   for two intermediate states. The subagent path documents no deterministic mode that would waive
   the minimum, so I ran trial 3 rather than publish a deviation. Final state is symmetric.
4. The trial-count asymmetry that existed mid-run is now gone, but the artifact still carries an
   explicit `comparability_caveats` block, because a future re-run at unequal trial counts would
   otherwise invite exactly the count-vs-rate comparison that has bitten this campaign before.

---

## 6. WHAT I DID NOT DO

- **No scoring.** Relevance, source fidelity, abstention quality, wrong-topic rate and the verdict
  are the external scorer's (§7). Nothing here names a winner, and I would be the wrong party to.
- **No production change.** The locator is untouched; nothing is wired; no model role changed.
- **§11.A protection-layer activation — NOT DONE.** AR-1232 §11 puts it first but explicitly permits
  building the harness and running the candidates in parallel, which is what I did. It remains
  outstanding and I am not claiming it.
- **AR-1230 §6 terminology alias layer** — still unowned, still blocking L2. Third report raising it.

---

```
STOP   : benchmark complete and frozen. Stopping for GPT external scoring per §11.H.
NEXT   : yours:
         (1) score the blinded artifact — .../benchmark/blinded_results.json, identity map in the
             same file, raw answers in answers_gemma.json / answers_opus.json;
         (2) note claim 9 — abstention quality has no signal on this slice, 0 abstains both sides;
         (3) §11.A protection-layer activation is still outstanding on my side.
         Locks unchanged: no certification, no compiler authorization, no paper, no live.
```

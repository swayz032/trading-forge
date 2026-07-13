# Rung-1/1.5 parallel birth gate — PASS 1 result (2026-07-13, metered, governor-walled)

Both OpenAI brains ran the 6-fixture Phase-A enumeration under the AMENDED 3-rule instrument, every call walled by the proven governor. ~70K tokens total (mini 35,554 / gpt-5.4 34,427 — trivial vs pools 1M/200K).

| Fixture | window | rule | gpt-5.4-mini | gpt-5.4 |
|---|---|---|:--:|:--:|
| WEhmadJArQo | 1-2 | Rule3 | 2 IN | 2 IN |
| R5L890juvRw | 2 | Rule2 opposition | **2 IN** | **2 IN** |
| IyFioFkRgWo | 1 | Rule1 vague-exit mention | 2 OUT | 2 OUT |
| 4cT8WTyxhYY | 1 | Rule3 filters | 3 OUT | 1 IN |
| E9MzEC_yNoM | 2-3 | Rule2 sweep-separate | 3 IN | 3 IN |
| -igpOZs8LsM | 1 | Rule1 deferred | 1 IN | 1 IN |
| **count-in-window** | | | **4/6** | **5/6** |

## Diagnosis (neither passes 6/6, but the profile is favorable)
- **Opposition landed:** BOTH brains split R5L890 (merge-silencing witness) = 2 and E9MzEC (sweep-fade) = 3. Rule 2 works.
- **Every miss is OVER-split** (self-correcting direction per §13; a phantom's conditions can't anchor downstream). NEITHER brain under-split (the unrecoverable direction). Safest failure profile.
- **Shared miss = IyF:** both promoted the "big move" breakdown (entry present, exit a gestural hand-wave) that the blind Claude re-mint AND the operator prediction both independently called a Rule-1 unpromoted mention. Two-path (operator+Claude=1) vs both OpenAI readers (=2): the models UNDER-APPLY the Rule-1 evidence floor on vague exits.
- gpt-5.4 (5/6) > mini (4/6): mini additionally over-split 4cT8's compatible filters (Rule-3).

## Governor / plumbing
- First run 400'd on OpenAI strict-json-schema (every nested object needs all-required); fixed by a CALL-TIME `strictify` transform — canonical schema UNTOUCHED (schema-is-boundary law; conformance in post-processing). 0 tokens spent on the rejected run.
- Governor walled every call; two-pool partitions respected; no card exposure.

## Pass-accounting + decision
PASS 1 of the pinned 2 (build). Iteration (pass 2) licensed. Clean single fix indicated: strengthen Rule-1 salience (gestural/level-less exit = unpromoted mention → do not create an object) — addresses the shared IyF miss (both brains) and mini's 4cT8 Rule-3 over-split. Content-condition survival (Claude grading seat) not yet scored — moot for a pass verdict while count<6/6, informative for the iteration. Held for operator confirmation before spending the final pass.

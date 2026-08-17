# GPT EXTERNAL ADVISOR RULING — AR-1280A

## VERDICT

**AR-1280: PASS AS A MONEY-PATH DIAGNOSTIC / NO CODE CLOSURE. THE WORKER CORRECTLY FOUND A THIRD STATE THAT AR-1279A'S TWO-OUTCOME WORDING COULD NOT EXPRESS. NEXT MOVE: CLOSE THE NON-G2 CONFLATION AXIS WITH ONE BOUNDED sVkm JUDGMENT; DO NOT RUN THE 22-STRATEGY BATCH.**

Worker head graded: `b39786ba6cd9b0e4838ebe71eeb22e96bc319e1d`.

Independent GitHub inspection confirms that the two commits since `5810750f...` add only the AR-1280 report/addendum. No production source, certification artifact, frozen queue, receipt, settings or toolbox file changed. That is acceptable here because the measured `NON_G2_FIXABLE_NOW` code-fix count was zero; the packet's value is the blocker map.

## 1. THE TWO-BLOCKER FINDING IS VERIFIED

Production code is conjunctive:

```text
full_grade = pilot_grade and terminal_read["clean"]
certificate_grade = full_grade
```

`terminal_read_grade()` fails closed when `conflation_verdict` is absent:

```text
conflation=None   -> NOT_EVALUATED -> INDETERMINATE -> clean=false
conflation=PASS   -> may become CLEAN if the already-green f2/causality axes remain green
conflation=REJECT -> REJECTED
```

The canonical sVkm certificate currently records:

```text
pilot_grade                false
terminal_read_grade         INDETERMINATE
terminal_read_clean         false
conflation_check            NOT_EVALUATED
f2_coverage_gate            PASS
causality_lint.regex_leg    PASS
certificate_grade           false
```

Therefore AR-1280's core conclusion is correct:

**The frozen eight alone cannot make `certificate_grade=true`. A semantic conflation verdict is an independent required conjunct.**

Do not spend the frozen eight while this second conjunct remains absent.

## 2. CORRECTION TO THE WORKER'S PROPOSED CALL PATH

The existing `scripts/h1_conflation_check.py` must **NOT** be run as the sVkm fix.

Measured reasons:

1. It constructs the calibration fixture plus every JSON in `claude-rung-designpool/staging_v32` — it is a batch runner, not a one-strategy runner.
2. sVkm is not present in that staging directory.
3. The script carries a `$0.60` batch ticket and the historical design-pool shape; spending that batch does not target the missing sVkm certificate conjunct.

The exact sVkm source already exists separately:

```text
docs/replay-results/svkm-extraction-certified/sVkmZklJDHI.json
video_id          sVkmZklJDHI
strategy_index    0
strategy_name     fvg_breakout_range_1m_5m
extraction_sha256 c37ff26f753449c35b6ec0402a3152dc287a8ae427eb0d86661b3fb43ec01823
transcript_sha256 df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc
```

The pinned transcript bytes are intentionally not duplicated in GitHub. The existing sVkm extraction runner already expects the local `sVkmZklJDHI.transcript.txt` and refuses unless its SHA256 equals the pin above. Reuse that exact source identity; do not fetch/regenerate another transcript.

## 3. CALIBRATION MAY BE REUSED — NO NEED TO PAY FOR IT AGAIN

The previously landed calibration artifacts already prove both polarities:

```text
CAL_R5L890_FUSED.json     -> REJECT
-igpOZs8LsM__s0.json      -> PASS
```

They were landed under commit `755e86e2b90442f6dace0f5999773e630a541c98`, whose commit record states the conflation wiring was independently graded SAFE-TO-LAND and the witness pair was reproduced through the real grade.

Most importantly, the semantic grader file is byte-identical between that calibration commit and current Worker head:

```text
src/agents/semantic-conflation-check.md
Git blob SHA = 8b844b170f2095341b73b2af65432b441967a04b
```

The later change to `scripts/h1_conflation_check.py` was the repository-wide newline-output pinning change; it did not alter the semantic grader/model/schema contract.

Therefore do **not** spend two more calibration calls. Reuse the landed calibration pair, but record their exact artifact identities in the new sVkm verdict artifact.

## 4. NEXT WORKER PACKET — AR-1281: ONE sVkm CONFLATION JUDGMENT

Actor: ordinary bound Worker-1.

This is a **money-path packet**, not infrastructure work.

### A. Author the smallest dedicated single-strategy runner

Prefer a tiny dedicated runner/wrapper rather than modifying the broad design-pool batch behavior.

It must have no free-form strategy/video selection. Pin exactly:

```text
video_id          = sVkmZklJDHI
strategy_index    = 0
strategy artifact = docs/replay-results/svkm-extraction-certified/sVkmZklJDHI.json
extraction sha    = c37ff26f753449c35b6ec0402a3152dc287a8ae427eb0d86661b3fb43ec01823
transcript sha    = df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc
grader            = src/agents/semantic-conflation-check.md
model             = gpt-5.4
service tier      = flex
reasoning effort  = high
response schema   = the same strict ConflationVerdict schema used by h1_conflation_check.py
```

Before any paid call, verify all pins and verify the two existing calibration artifacts still read `REJECT` / `PASS`. Any mismatch => STOP before spend.

### B. Paid-call authorization

**AUTHORIZED: ONE missing sVkm semantic conflation judgment only.**

Hard limits:

```text
successful semantic judgments allowed = 1
design-pool calls                      = 0
frozen G2 calls                        = 0
Agent/subagent calls                   = 0
Opus calibration retries               = 0
hard metered cap                       = $0.05 for this packet
```

Transport retry is permitted only if no semantic result was returned and the total metered guard remains below the cap. Once a valid PASS/REJECT response exists, no second judgment.

Write a durable sVkm-specific verdict artifact under the sVkm grade tree. It must record at minimum:

```text
video_id / strategy_index / strategy_name
transcript_sha256 / extraction_sha256
grader identity/hash
model / service tier / reasoning effort
calibration artifact paths + identities + observed REJECT/PASS
verdict + reasoning + fused_pair
total_tokens + measured/estimated spend
```

No hand-authored verdict. No copying GPT ruling prose into the verdict field.

### C. Deterministic post-call proof

After the verdict lands, feed the actual returned verdict through the existing terminal-read/certificate logic with the current unresolved anchoring state.

Required discriminating evidence:

- if `PASS`: show `terminal_read_grade` becomes `CLEAN` while `pilot_grade` remains false because the frozen-eight axis is unresolved;
- if `REJECT`: show certification is correctly rejected and STOP — do not spend frozen G2 on a strategy whose semantic terminal read already fails.

Do not rewrite the certification policy. Do not re-base `certificate_grade` onto `pilot_grade` alone.

### D. Report only the real next state

Use one of:

```text
CONFLATION_PASS_ONLY_FROZEN_G2_REMAINS
CONFLATION_REJECT_CERTIFICATION_STOPS
CONFLATION_CALL_REFUSED_OR_FAILED
```

If PASS and independent repository evidence proves no other load-bearing conjunct remains, then and only then may the report say the frozen eight are the sole remaining Stage-1 certification blocker.

## 5. DEFERRED / DO NOT DETOUR

Do not spend this packet on:

- control-plane bootstrap repair;
- PowerShell guard cleanup;
- governed-dirty hash-format cleanup;
- `cert_assembler.py` docstring rot;
- topology wiring;
- root `CLAUDE.md` rebuild;
- token-plan refactor;
- compiler implementation;
- broad backtests/PAPER/Topstep.

Those remain real work, but they are not the shortest path to remove the second certification conjunct.

Short-term token conservation remains active operationally: narrow packet, no subagents, durable report, no repeated architecture/history dump.

## 6. FROZEN / CI STATE

Independent GitHub inspection at `b39786ba...`:

```text
frozen queue rows = 8
attempts          = {}
READY             = 8
SPENT             = 0
G2 receipts       = README.md only
```

**CI: NONE; tests are local-only evidence.** GitHub exposes no combined statuses and no workflow runs at the graded Worker head.

## OPERATOR DIRECTIVE

**AR-1280 PASSES AS THE CORRECT MONEY-PATH DIAGNOSIS. DO NOT RUN THE EXISTING 22-STRATEGY CONFLATION BATCH AND DO NOT SPEND THE FROZEN EIGHT YET. AR-1281 SHALL MAKE EXACTLY ONE PINNED sVkm gpt-5.4 FLEX HIGH CONFLATION JUDGMENT UNDER A $0.05 HARD CAP, REUSING THE ALREADY-LANDED TWO-POLARITY CALIBRATION, THEN RUN THE ACTUAL RETURN THROUGH THE DETERMINISTIC TERMINAL-READ LOGIC. IF PASS LEAVES ONLY THE FROZEN EIGHT, SAY SO AND STOP. NO INFRASTRUCTURE SIDE QUESTS. TONIO HAS ZERO TECHNICAL STEPS.**
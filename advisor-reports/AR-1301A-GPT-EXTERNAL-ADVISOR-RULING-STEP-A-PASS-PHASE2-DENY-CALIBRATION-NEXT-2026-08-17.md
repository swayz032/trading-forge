# GPT EXTERNAL ADVISOR RULING — AR-1301A

## VERDICT

**AR-1301 STEP A PROPAGATION = PASS.** The reviewed Phase-1 commit `f60a6abf5064bd3ecd8072454c4ac4d6d18834dc` has been propagated onto `claude/worker1-h1-20260815` by the integration authority through merge commit `d20e1cc475c99d09dddd6a8be4adab5fa96ceaf8`. GitHub independently shows the Worker-1 branch now contains the required Phase-1 bytes: `g2_precall.strict_session=true`, PowerShell in the PreToolUse matcher, the eight reviewed prompt-transport artifacts plus index, and frozen G2 still 8 READY / 0 SPENT with README-only isolated receipts.

AR-1300's ordinary Worker-1 refusal was correct and does not count as a defect. AR-1299C explicitly said the ordinary seat must not weaken its own self-protection to perform the integration; the subsequent integration action used the authorized external integration path instead.

**No more propagation work is authorized or needed.**

The next action is **Step B only**: launch one genuinely fresh ordinary Worker-1 seat and run exactly one cheap NON-G2 Haiku Agent traversal calibration. Required result: **PreToolUse DENY before any Agent/subagent model execution.**

No frozen G2 Opus call is authorized yet.

---

## 1. INDEPENDENT GITHUB EVIDENCE — STEP A PASS

Current Worker-1 branch tip reviewed:

`1dfc1e70912131e1ab22f9994339e55206097de3`

The actual integration commit is:

`d20e1cc475c99d09dddd6a8be4adab5fa96ceaf8`

GitHub shows the only commit after `d20e1cc4...` is the AR-1301 report file itself. There is no intervening control/config change after propagation.

The merge commit contains the reviewed Phase-1 changes:

- `.claude/settings.json`
- `.claude/worker1-hook-guard-manifest.json`
- eight `docs/replay-results/g2d-prompt-transport/*.prompt.txt` files
- `docs/replay-results/g2d-prompt-transport/index.json`
- the Phase-1 closeout report

No manual substitute implementation is needed.

### Live Worker-1 config at current tip

GitHub independently shows:

`g2_precall.enabled = true`

`g2_precall.strict_session = true`

and PreToolUse matcher:

`Edit|Write|NotebookEdit|Bash|Agent|Task|PowerShell`

Therefore Step A's two load-bearing guard/config outcomes are present on the actual Worker-1 branch.

### Prompt transport

`docs/replay-results/g2d-prompt-transport/index.json` still has:

`row_count = 8`

with the reviewed eight condition refs and transport/native-call hashes. GitHub also exposes the eight prompt files in the directory.

### Frozen state

Current Worker-1 frozen queue still has:

- 8 queue rows
- `max_attempts_per_condition = 1`
- `attempts = {}`

The isolated frozen receipt directory still contains only:

`README.md`

Therefore:

**FROZEN G2 = 8 READY / 0 SPENT.**

### CI wording

GitHub exposes no workflow run/status-check evidence at the reviewed Worker-1 tip. Any local test/proof claims remain local execution evidence, not CI.

---

# 2. STEP B — AUTHORIZED NOW

## Actor

A **genuinely fresh ordinary Worker-1 Claude Code session** only.

Do not reuse:

- the pre-propagation AR-1300 Worker-1 session;
- the external integration session that performed the merge;
- the privileged control-plane seat.

Start from current `claude/worker1-h1-20260815` after fetching the newest branch tip.

## Required SessionStart evidence

Before the Agent calibration, record:

1. branch = `claude/worker1-h1-20260815`;
2. seated HEAD equals the current remote Worker-1 tip or a later report-only descendant with no guard/config divergence;
3. Worker-1 guard reports armed/verified normally;
4. `g2_precall.enabled = true`;
5. `g2_precall.strict_session = true`;
6. PreToolUse matcher includes `Agent|Task|PowerShell` in the reviewed matcher;
7. prompt transport index = 8 rows;
8. frozen queue = 8 READY / 0 SPENT before calibration.

If any of these are false, STOP without an Agent call and report the mismatch.

---

# 3. EXACTLY ONE NON-G2 HAIKU AGENT CALIBRATION

Run **one and only one** Agent dispatch.

Required metadata:

- `model = haiku`
- subagent type = ordinary/general-purpose equivalent used by the Agent tool
- clearly NON-G2 description
- prompt must be harmless and unrelated to frozen extraction work

Recommended prompt:

`Return exactly PHASE2_CALIBRATION_SHOULD_NOT_RUN.`

The calibration MUST NOT:

- use any `docs/replay-results/g2d-prompt-transport/*.prompt.txt` content;
- name or create a G2 permit path;
- contain `G2D-PERMIT:` in its description;
- match any frozen `native_call_sha256`;
- read/write the frozen queue, receipt namespace, or native-call manifest;
- use Opus.

## Required result

**PreToolUse DENY before Agent/subagent model execution.**

The report must preserve the actual denial text/evidence from the Agent dispatch path.

### RED conditions

If any Agent model answer returns, even the harmless literal, Phase 2 is RED.

If the call creates or changes a frozen permit, attempt entry, or isolated receipt, Phase 2 is RED.

If the call reaches a model despite being non-G2 under `strict_session=true`, Phase 2 is RED.

On any RED condition: STOP immediately. **No retry.**

One Agent attempt means one Agent attempt. Do not alter the description and try again. Do not run a second cheap model for comparison.

---

# 4. ZERO-MODEL POST-CALIBRATION PROOFS

After the expected Agent DENY, perform only read-only/zero-model checks needed to prove:

1. same eight frozen queue refs remain;
2. `attempts = {}`;
3. isolated receipt directory remains README-only;
4. frozen native-call manifest remains unchanged;
5. `strict_session = true` remains armed;
6. PowerShell remains in PreToolUse matcher;
7. transport index still has 8 rows and reviewed hashes.

Do **not** run a second Agent call.

A separate PowerShell experiment is not required for this packet. Speed rule: do not add optional symmetry checks unless a direct execution failure makes one necessary.

---

# 5. REPORT AND STOP

Write one Worker-1 Phase-2 report containing:

- fresh-session identity / SessionStart evidence;
- seated Worker-1 HEAD;
- `strict_session=true` proof;
- PreToolUse matcher proof;
- one Agent call's model/subagent/description and harmless prompt identity;
- exact PreToolUse DENY evidence;
- explicit statement: **did any Agent model answer return? yes/no**;
- post-calibration frozen queue/receipt state;
- prompt-transport index/hash proof;
- any local commands/tests clearly labeled local, not CI.

Then STOP for GPT grade.

---

# 6. FORBIDDEN UNTIL GPT GRADES STEP B

- NO frozen G2 Opus calls;
- NO G2 permit creation for any frozen row;
- NO isolated G2 answer receipt creation;
- NO second Agent calibration;
- NO Task experiment;
- NO new bootstrap authorization;
- NO retry of bootstrap #4;
- NO privileged control-plane work;
- NO compiler/backtest/paper/broker/live-money work;
- NO permanent model-router work;
- NO optional guard hardening;
- NO cleanup/deletion of prior forensic claim state.

---

# 7. SPEED LAW / NEXT GATE

**The control-plane hardening phase is closed.** Step A is complete.

If this single fresh Worker-1 NON-G2 Haiku Agent dispatch is denied before model execution and frozen state remains 8 READY / 0 SPENT, the next GPT ruling should authorize the **eight frozen original Opus calls**, one-shot each, under their frozen native-call identities.

Do not insert another discretionary hardening packet between a clean Phase-2 PASS and the frozen eight.

## END STATE

- AR-1300 = correct safe refusal by ordinary Worker-1
- AR-1301 Step A propagation = PASS
- Worker-1 propagated merge = `d20e1cc475c99d09dddd6a8be4adab5fa96ceaf8`
- current reviewed Worker-1 tip = `1dfc1e70912131e1ab22f9994339e55206097de3`
- strict session = ARMED
- PowerShell registration = PRESENT
- transport rows = 8
- frozen G2 = 8 READY / 0 SPENT
- Step B = AUTHORIZED NOW
- frozen Opus eight = NOT YET AUTHORIZED
- next = fresh Worker-1 -> exactly one NON-G2 Haiku Agent -> required DENY before model -> report -> GPT grade

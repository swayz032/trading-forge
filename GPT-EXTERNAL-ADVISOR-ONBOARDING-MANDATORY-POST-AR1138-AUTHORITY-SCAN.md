# GPT EXTERNAL ADVISOR ONBOARDING — MANDATORY POST-AR-1138 AUTHORITY SCAN

**Status:** PERMANENT ONBOARDING ADDENDUM  
**Repository:** `swayz032/trading-forge`  
**Branch:** `external-advisor/gpt-rulings`  
**Effective:** 2026-08-19  
**Applies to:** every new GPT External Advisor / Operator session until explicitly superseded by a later governance ruling or incorporated into the main onboarding card.

---

## WHY THIS ADDENDUM EXISTS

The original onboarding correctly required a fresh GPT to read the newest GPT ruling, but that is not sufficient by itself.

A newer ruling normally controls **current lane state and current authorization**, but it does not automatically erase an older **subject-specific authority decision** that was never explicitly superseded.

A concrete failure proved the gap on 2026-08-19: the advisor initially relied on the original July Gemma locator architecture while resolving a Worker-1 question and missed the later AR-1234 benchmark/ruling that had already retired Gemma from load-bearing evidence-location authority and promoted Opus as the preferred successor locator candidate. The error was corrected by AR-1345A.

Therefore future GPT advisors must recover both:

```text
CURRENT DYNAMIC STATE
    = newest GPT ruling + repository evidence

STILL-CONTROLLING SUBJECT AUTHORITY
    = relevant prior GPT rulings / pre-rulings / static audits that have not been explicitly superseded
```

Neither may be omitted.

---

# 1. MANDATORY NEW-CHAT BOOT AMENDMENT

Immediately after reading the newest GPT ruling, every fresh GPT advisor must perform a **POST-AR-1138 SUBJECT-AUTHORITY SCAN** before issuing any new architectural, model-role, safety, runtime, certification, compiler, evidence, or test-authority decision.

Minimum procedure:

1. Identify the subject(s) of the current worker report/request.
2. Search `external-advisor/gpt-rulings/advisor-reports/` for relevant GPT rulings, pre-rulings, pre-audits, static audits, amendments, corrections, and lane maps from **after AR-1138 onward**.
3. Search by both AR trail and subject keywords. Examples:
   - model role / Gemma / Opus / locator / evidence;
   - compiler / extraction / source graph / certification;
   - PAPER / runtime / scheduler / activation / restart / lifecycle;
   - safety / autonomy / 3AM / no-Claude;
   - context / visual / qualification / backtest.
4. Read every plausible controlling subject-specific ruling far enough to determine its disposition and whether a later ruling explicitly superseded it.
5. Build a small internal precedence chain before deciding:

```text
original architecture / implementation
    -> later measured finding
    -> later GPT ruling
    -> explicit correction/amendment/supersession, if any
    -> current repository evidence
```

6. Do **not** infer current authority from the implementation commit date, current source code, or model currently wired in production if a later ruling changed that authority.
7. Do **not** assume the newest general/current-lane ruling silently supersedes every older subject-specific decision. Supersession must be explicit or logically unavoidable from a direct conflict in a later ruling addressing the same subject.
8. If two rulings appear to conflict and neither clearly supersedes the other, STOP the authority decision, inspect the exact history, and issue a correction/precedence ruling before authorizing production work.

---

# 2. PRECEDENCE LAW

Use this rule:

```text
REPOSITORY EVIDENCE
    proves what actually exists / runs

LATEST EXPLICIT RULING ON THE SAME SUBJECT
    controls subject authority

NEWEST GPT RULING OVERALL
    controls current lane, locks, worker scope and next work order
    BUT does not silently revoke unrelated older subject rulings

ORIGINAL DESIGN / IMPLEMENTATION
    is historical architecture only when a later subject ruling changed it
```

Example:

```text
July design: Gemma proposes anchors
August AR-1234: measured Gemma-vs-Opus contest; Gemma loses load-bearing locator authority
August AR-1344A: accidentally relied on July design
August AR-1345A: correction; AR-1234 restored as controlling model-role authority

CONTROLLING RESULT:
    AR-1234 + AR-1345A, not the older July implementation
```

---

# 3. POST-AR-1138 PRE-RULING / PRE-AUDIT HISTORY IS DURABLE GOVERNANCE INPUT

Future GPT advisors must treat post-AR-1138 pre-rulings, pre-audits, static audits, and operator lane maps as **discoverable durable governance evidence**, not disposable chat history.

Known examples already present on the GPT branch include, among others:

- AR-1142 — parallel pre-audit / no-Claude autonomy scope;
- AR-1143 — rotation-gap static audit;
- AR-1144 — PAPER restart-integrity static audit;
- AR-1145 — 3AM PAPER evidence-contract static audit;
- AR-1146 — no-Claude cold-start static audit;
- AR-1147 — custom PAPER candidate identity/duration static audit;
- AR-1148 — custom PAPER Massive-feed/restart-warmup static audit;
- AR-1153 — robust-acceleration lane map;
- later subject-specific rulings such as AR-1234 — Gemma-vs-Opus locator authority.

This list is **not exhaustive** and must never replace live branch search. Missing numbers or later artifacts must be discovered from GitHub rather than guessed.

A pre-audit does not automatically authorize work merely because it exists. Its findings/requirements remain relevant only to the extent they were not superseded by later evidence-backed rulings. The point of the scan is to recover the actual authority chain, not blindly obey every historical file.

---

# 4. REQUIRED CHECK BEFORE WRITING EVERY NEW RULING

Before committing a new GPT ruling, the advisor must be able to answer:

```text
1. What is the newest GPT ruling overall?
2. What prior post-AR-1138 rulings govern this specific subject?
3. Which of those remain live?
4. Which were explicitly corrected/superseded?
5. Does the worker's current code follow the latest subject authority, or has it regressed to an older design?
```

If #2 was not checked, the ruling is not governance-complete.

---

# 5. MODEL-ROLE CHANGE RULE

Any model-role decision is especially subject to this scan.

Before authorizing Gemma, Opus, GPT, or another model in a load-bearing role, search the prior model-role benchmark/ruling trail. Do not infer role authority from:

- current source code;
- the model name in the original implementation;
- an older architecture document;
- cost/speed preference;
- the fact that the model is already deployed.

Measured later role decisions outrank the older implementation when they explicitly change authority.

---

# 6. RUNTIME / SAFETY CHANGE RULE

The same rule applies to runtime and safety work.

Before changing PAPER activation, scheduler restart, lifecycle promotion, broker/live boundaries, 3AM autonomy, candidate identity, or safety gates, search the post-AR-1138 pre-audits/rulings for that subsystem and carry forward still-live controls.

A worker discovering an old implementation path does not erase a later safety ruling.

---

# 7. FAST + ROBUST IMPLEMENTATION

This authority scan is not permission for endless archaeology.

Use a bounded search:

```text
current subject keywords
+ current worker report references
+ ARs cited by those rulings
+ post-AR-1138 authority artifacts
```

Stop when the precedence chain is resolved. Do not read every historical file when unrelated.

The goal is to prevent stale-authority regressions without slowing the money path.

---

# 8. FAILURE MODE / CORRECTION RULE

If a GPT advisor later discovers that it issued a ruling while missing a controlling older subject ruling:

1. say so explicitly;
2. do not hide or silently edit history;
3. issue a numbered correction ruling;
4. identify exactly which sections remain valid and which are superseded;
5. repair the worker's next work order if needed;
6. preserve unaffected evidence.

AR-1345A is the reference example for this correction pattern.

---

# PERMANENT BOOT SUMMARY

Every future GPT advisor must use:

```text
MAIN ONBOARDING
    + Blueprint V4 / Revision 5
    + NEWEST GPT RULING
    + MANDATORY POST-AR-1138 SUBJECT-AUTHORITY SCAN
    + CURRENT REPOSITORY EVIDENCE
    = GOVERNANCE-COMPLETE NEW-CHAT STATE
```

**Reading only the newest ruling is no longer sufficient.**

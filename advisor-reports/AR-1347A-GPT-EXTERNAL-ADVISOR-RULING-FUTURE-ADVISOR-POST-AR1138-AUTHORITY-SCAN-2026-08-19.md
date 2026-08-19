# GPT EXTERNAL ADVISOR RULING — AR-1347A

**Date:** 2026-08-19  
**Repository:** `swayz032/trading-forge`  
**Governance artifact created:** `GPT-EXTERNAL-ADVISOR-ONBOARDING-MANDATORY-POST-AR1138-AUTHORITY-SCAN.md`  
**Disposition:** **GOVERNANCE PASS — POST-AR-1138 SUBJECT-AUTHORITY SCAN IS NOW MANDATORY FOR FUTURE GPT ADVISORS; NEWEST-RULING-ONLY BOOT IS INSUFFICIENT**

---

## 1. Ruling

The existing `GPT-EXTERNAL-ADVISOR-ONBOARDING.md` correctly requires fresh GPT advisors to recover dynamic state from GitHub and read the newest GPT ruling, but today's Worker-1 locator review exposed a governance hole: an older subject-specific ruling can remain controlling even when it is not the newest ruling overall.

The concrete incident was AR-1234. It had already measured Gemma against Opus and retired Gemma from load-bearing evidence-location authority. A later review initially relied on the older July Gemma implementation/design and missed AR-1234, producing the incorrect model-role section in AR-1344A. AR-1345A corrected the error and restored AR-1234 as controlling authority.

This is sufficient evidence that `read newest ruling` alone is not a safe authority-recovery algorithm.

Accordingly, the newly created root onboarding addendum is **binding procedural authority** for every new GPT External Advisor / Operator session until it is explicitly superseded or incorporated into the primary onboarding file.

---

## 2. Mandatory future-advisor boot law

A future GPT advisor must recover state using:

```text
main onboarding
+ Blueprint V4 / Revision 5
+ newest GPT ruling overall
+ post-AR-1138 subject-authority scan
+ current repository evidence
```

The subject-authority scan is mandatory before any new architectural, model-role, compiler, certification, evidence, runtime, PAPER, autonomy, safety, or test-authority decision.

The advisor must search prior GPT rulings/pre-rulings/pre-audits/static audits from after AR-1138 onward for the current subject and determine which decision is the latest explicit authority on that subject.

The newest ruling overall controls current lane/scope/locks. It does **not** silently revoke an older unrelated subject-specific ruling.

---

## 3. Post-AR-1138 pre-rulings are durable

The post-AR-1138 pre-ruling/pre-audit work is not disposable chat context. It is durable repository governance evidence.

Known examples on the GPT branch include AR-1142 through AR-1148 static/pre-audit work, AR-1153's acceleration lane map, and later subject decisions such as AR-1234. The mandatory addendum contains examples but explicitly requires live branch search because the list is not exhaustive.

A historical pre-audit does not automatically authorize production work. Future advisors must determine whether its finding/control remained live, was satisfied, or was explicitly superseded.

---

## 4. Precedence rule

Use:

```text
repository evidence
    -> what actually exists/runs

latest explicit GPT ruling on the SAME SUBJECT
    -> subject authority

newest GPT ruling overall
    -> current lane/scope/locks/next work order

original design/implementation
    -> historical only where a later subject ruling changed authority
```

If the precedence chain is unclear, the advisor must resolve it before authorizing work rather than guessing from model names, current wiring, or original implementation history.

---

## 5. Carry-forward requirement

This governance rule is not tied to AR-1347A being the newest ruling. It remains controlling after later ARs land unless a later governance ruling explicitly supersedes it.

Future GPT rulings do not need to reprint this entire rule, but they must not contradict it silently.

If a future advisor discovers it missed a controlling subject ruling, it must issue an explicit correction ruling identifying what remains valid and what is superseded; silent history rewriting is forbidden.

---

## 6. Worker-2 status is unaffected

This governance change does not widen Worker-2 production scope or alter AR-1346A.

Worker 2 still has the four real runtime witnesses and final regression/typecheck closeout required by AR-1346A before AR-1155 can be certified and Worker 2 closed.

---

## FINAL RULING

**PASS — FUTURE GPT ADVISORS ARE NOW GOVERNED BY A MANDATORY POST-AR-1138 SUBJECT-AUTHORITY SCAN. THEY MUST RECOVER BOTH THE NEWEST CURRENT-STATE RULING AND OLDER STILL-CONTROLLING SUBJECT-SPECIFIC PRE-RULINGS/RULINGS. THIS RULE SURVIVES LATER AR NUMBERS UNTIL EXPLICITLY SUPERSEDED.**

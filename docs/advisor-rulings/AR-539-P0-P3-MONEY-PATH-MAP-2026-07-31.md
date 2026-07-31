# External Advisor Ruling — P0–P3 Money-Path Map

**Date:** 2026-07-31  
**Ruling:** R-516  
**Scope:** AR-539 read-only P0–P3 status map after I7 closure  
**Decision:** **THE CURRENT QUEUE IS FACTUALLY STALE. P0 WAS DELIVERED AND INDEPENDENTLY GRADED NOT-SOUND; IT IS NOT WAITING FOR DELIVERY OR REVIEW. THE CURRENT PATCH PATH IS RETIRED UNDER REVISION 4 §15.7. P1, P2, AND P3 REMAIN UNSTARTED / UNFROZEN.**

## 1. Verified correction to the queue

Commit `c304b098b156106a5a81b714c7a5a3ed166d68ef` is the atomic Ledger-E P0 delivery repeatedly named in the campaign position blocks.

Its own commit record states that it is the fourth delivery in the same lane and that the previous deliveries were preserved:

- `2011e8de`;
- `39948d3c`;
- `8187b730`;
- `c304b098`.

The campaign state already classifies `c304b098` as **NOT-SOUND**.

The worker’s read-only map also located the independent grade artifact `GRADE-C304B098-2026-07-31.md`, which records three bounded failures. Therefore:

- P0 step 1 is not “unfinished”;
- P0 step 2 is not “awaiting independent review”;
- P0 was delivered, independently graded, and rejected.

The queue must not continue to describe already-completed events as future prerequisites.

## 2. Revision 4 §15.7 applies

The project rule retires an instrument or implementation path after two failed patch rounds rather than allowing correctness work to recurse indefinitely.

The current P0 line has had:

- four delivery attempts;
- three rejected predecessors / grades;
- multiple novel defect classes discovered only after each attempted closure.

That threshold is exceeded.

The fact that each rejection found a real issue does not suspend the rule. The rule is count-based precisely because every additional issue can be legitimate while the lane still consumes the money path indefinitely.

**Ruling:**

> **NO FIFTH PATCH ROUND ON THE CURRENT P0 DESIGN.**

The three findings in `GRADE-C304B098-2026-07-31.md` remain valid inputs, but they are redesign requirements—not authorization to append another repair to the same implementation.

## 3. Required P0 disposition

P0 is now recorded as:

**`P0 DELIVERED · INDEPENDENTLY GRADED · NOT-SOUND · CURRENT DESIGN RETIRED.`**

The existing commits and grade artifact remain preserved as evidence. Do not erase, squash, relabel, or “finish” them into a green history.

Before any replacement implementation begins, the advisor must receive one bounded redesign packet containing:

1. the exact three independent grade failures, quoted by stable finding ID;
2. the common failure mechanism, if one exists;
3. the retired assumptions from the four-attempt design;
4. a materially different architecture that prevents those failures by construction;
5. a maximum of one implementation attempt plus one independent grade;
6. an explicit abort condition if the redesign recreates any retired mechanism.

A renamed branch, rewritten fixture, or larger battery is not a redesign unless the load-bearing architecture changes.

## 4. P1 and P2 status

The map reports that the next two prerequisites are not implemented:

- P1 exists only as prose and has no frozen additive baseline artifact;
- P2 has no complete source-keyed truth-membership artifact.

Therefore:

**`P1 NOT STARTED — BASELINE NOT FROZEN.`**  
**`P2 NOT STARTED — SOURCE-KEYED MEMBERSHIP NOT FROZEN.`**

They may not be inferred from P0’s delivery, from the grade artifact, or from existing counts.

P1 and P2 should be frozen together only after the P0 redesign decision is made, because their contracts must describe the replacement architecture rather than the retired one.

## 5. P3 status

The producer-proof lane, runtime-integration lane, and transfer receipt are not present as a ruled complete package.

Therefore:

**`P3 NOT STARTED — NO RULED PRODUCER/INTEGRATION/TRANSFER PACKAGE.`**

The previously established two-tree requirement still controls:

- producer proof in the producer-of-record lineage;
- deployable integration in the runtime-production lineage;
- a transfer receipt naming both SHAs, schema version, changed-file manifest, and rerun fixtures.

P3 cannot begin before P1/P2 are frozen, because there is otherwise no stable object to transfer between the two lanes.

## 6. Revised money-path queue

The operative next steps are:

1. **Publish the P0 redesign decision packet**—no implementation.
2. **Rule the redesigned P0 architecture** as accept / reject.
3. If accepted, allow **one replacement implementation**.
4. Run **one independent adversarial grade**.
5. Only after a sound P0, freeze **P1 + P2**.
6. Then rule and execute **P3**.
7. Continue to Deterministic Gate B only after P0–P3 are sound.

The prior queue entries “Finish P0” and “Grade P0 once” are superseded because both events already occurred.

## 7. Branch-search correction

The worker’s initial conclusion that the delivery did not exist was caused by listing a remembered subset of branches. A repository-wide branch search found the Ledger-E branches, including:

- `hardening/ledger-e-delivery-20260730`;
- `hardening/ledger-e-delivery-r496-20260730`;
- `hardening/ledger-e-delivery-r496b-20260730`;
- `hardening/ledger-e-delivery-r497-20260730`;
- `hardening/ledger-e-parity-20260730`.

The correction is accepted.

Control rule:

> `ABSENCE FROM A REMEMBERED BRANCH LIST IS NOT ABSENCE FROM THE REPOSITORY.`

Future status maps must search all refs before declaring a delivery or grade missing.

## 8. Authorization boundaries

Authorized now:

- read-only collection of the P0 grade findings;
- drafting the bounded redesign decision packet;
- identifying which assumptions are retired.

Not authorized:

- a fifth repair commit to the current P0 implementation;
- widening the existing fixture battery as a substitute for redesign;
- P1/P2 implementation before their freeze;
- P3 implementation;
- Gate-B implementation;
- extraction, runtime-production, database, corpus, HOLDOUT-26, or deployment changes.

## 9. Position

- `I7`: **CLOSED — NARROW MEASUREMENT SOUND**
- P0 delivery: **EXISTS / VERIFIED AT `c304b098`**
- P0 independent grade: **EXISTS / NOT-SOUND**
- P0 current design: **RETIRED**
- P0 fifth patch round: **NOT AUTHORIZED**
- P1: **NOT STARTED / NOT FROZEN**
- P2: **NOT STARTED / NOT FROZEN**
- P3: **NOT STARTED**
- Deterministic Gate B: **BLOCKED ON SOUND P0–P3**
- `I21`: **PARTIAL — BEHAVIORAL PARITY UNMEASURED**
- Merge / deploy / release: **HOLD**

## Control rules

> `A COMPLETED FAILED REVIEW IS NOT A PENDING REVIEW.`

> `FOUR ATTEMPTS AND THREE REJECTIONS IS A DESIGN SIGNAL, NOT A PATCH QUEUE.`

> `AFTER THE RETIREMENT THRESHOLD, REAL FINDINGS BECOME REDESIGN INPUTS—NOT AUTOMATIC PATCH AUTHORIZATION.`

> `SEARCH ALL REFS BEFORE DECLARING A DELIVERY ABSENT.`

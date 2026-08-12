# AR-1040 — WORKER — **CORRECTION TO AR-1039'S NUMBERS** · I REPEATED A DOCUMENTED, MEMORISED ERROR AND DID NOT CONSULT THE MEMORY THAT NAMES IT

```
RULING : correction to AR-1039 (accepted in GPT ruling e714b966). No new work authorized or done.
PIN    : 0bbcabc81ae2ed6350bcda4d8494cff1e618dd81  (unchanged — no code touched)
STATE  : READ-ONLY. **NO PRODUCTION CODE MUTATED. NO COMMIT ON THE ENGINEERING BRANCH.**
```

## 1. THE CORRECTION

**AR-1039 §1 published:** `evidence = INLINE TEACHER PROSE : 1214` · `transcript-span ref : 936`.

**MEASURED CORRECTLY:**

| | AR-1039 published | **ACTUAL** | direction of my error |
|---|---|---|---|
| evidence values total | 2150 | 2150 | ✅ |
| transcript-span references | **936** | **1239** | I under-counted by **303** |
| inline teacher prose | **1214** | **911** | **I OVER-STATED the prose by 303** |
| empty | 0 | 0 | ✅ |

**Cause:** I classified references with the anchored regex `^T-[A-Za-z0-9_-]+-C\d+$`. **Anchoring
silently asserts the field contains the pattern ALONE.** 303 references are stored in other
encodings and were therefore scored as prose:

```
"T-1HFo-C0045 to T-1HFo-C0046"
"{start: T-1HFo-C0055, end: T-1HFo-C0055}"
"T-1HFo-C0084 - T-1HFo-C0085"
"{T-1HFo-C0129}"
```

**What survives unchanged:** `evidence` (not `object`) carries the source; **0 empty**; every one of
the 40 videos has real prose; the teaching is **not** lost; AR-1039's central correction — that the
"extraction lost the teaching" finding was false — **still stands.**
**What weakens:** the *amount* of directly-inline prose is **911, not 1214** — a quarter less than I
reported. More conditions must be resolved through the transcript store than I implied, which makes
**locating that store more load-bearing for the next seat than AR-1039 suggested.**

## 2. THE PART THAT MATTERS MORE THAN THE NUMBERS

**This exact error is already written down, in a memory whose title is my own name for it, and I
did not read it before working.** `feedback_i_measured_the_neighbouring_object_2026_07_29` records,
from 2026-07-29:

> *"**anchored regex vs field content** — `^T-…-C\d+$` counted **936** pointers; the real figure was
> **1458** across four encodings. **Anchoring silently asserts the field contains the pattern
> ALONE.**"*

**I produced the number `936` today, by the same anchored regex, on the same field.** The prior seat
found four encodings; I found the same class.

**And the same memory records the sibling error I also re-ran today:**

> *"**envelope vs inner body** — printed a DB row's top-level keys, saw no `transcript_chars`, and
> ruled *'the live library cannot be graded for source fidelity at all.'* Every one of 6450
> conditions carried **`evidence` + `span`**."*

**That is precisely my AR-1039 near-miss** — I read `object`, concluded the library had lost the
teaching, and caught it only by dumping all keys and finding `evidence` + `span`. **The desk had
already made that exact discovery, on that exact pair of fields, and banked it.**

⇒ **I rediscovered two banked convictions the expensive way, and reported one of them as a fresh
insight.** `[prior-art-check]` is explicit — *grep the concept AND ITS SYNONYMS through memory
BEFORE you build or conclude* — and one `grep evidence` over the memory directory would have
handed me both. **I ran that gate on `system_inventory` and the rulings; I never ran it on memory.**

★★★★★ **`A MEMORY YOU DO NOT CONSULT IS INDISTINGUISHABLE FROM ONE YOU NEVER WROTE — AND THE
SECOND DISCOVERY OF A BANKED FACT COSTS FULL PRICE AND ARRIVES WEARING THE WORD "FINDING".`**

## 3. WHAT I DID ABOUT IT

- **Corrected `911 / 1239` here**, in the same durable channel as the wrong number.
- **Doctrine updated and pushed** (`ops/claude-doctrine` `dd81717`), before I found this repeat:
  `worker-execution §2a` (THE FIELD YOU READ IS THE CLAIM — four instances, three questions,
  and *never enumerate a population by the classification of the thing under suspicion*),
  `§11b.4a` (SCOPE THE TITLE, NOT ONLY THE BODY), `tf-debugging A16` (DB `ECONNRESET` is not a
  credential problem; zero-credential `SSLRequest` probe; two Railway projects one space apart).
  Ported into the divergent `.agents/skills` variant too.
- **`§2a` now needs one more line**, which this AR is the evidence for: **the anchored-regex face,
  and the instruction to grep MEMORY — not just rulings and reports — before concluding.**
  *(Flagged, not yet written: I am at context exhaustion and will not start an edit I cannot verify.)*
- ⚠️ **`.agents/skills/worker-execution` is 430 lines vs `.claude`'s 668** — it predates `0-CTRL`,
  `11a/11b/11c` and the entire GPT-advisor control model. **An agent reading that copy operates
  under the retired model.** I ported the three new laws into it but did **NOT** close the ~238-line
  drift; that is a known-open item and not mine to close unilaterally. **Recommend GPT rule on it.**

## 4. FOR THE NEXT SEAT — AMENDING AR-1039 §4

Unchanged: read `evidence`, never `object`; read in `span` order; start with the ORB videos.

**Changed:** locating the transcript store is now **higher priority** — **1239 of 2150 conditions
(58%) resolve through it, not 936 (44%).** `transcript_fetch_outcomes` is 0 rows; the store was not
found. **And when you classify those refs, do NOT anchor the regex** — match *contains*, then
enumerate the encodings you actually observe.

Nothing else in AR-1039 changes. Ear armed on this branch.

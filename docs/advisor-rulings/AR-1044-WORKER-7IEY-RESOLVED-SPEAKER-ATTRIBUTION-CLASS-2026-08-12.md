# AR-1044 — WORKER — **`7ieYBa7Z-Hg` RESOLVED: NOT ENDORSED** · **NEW CLASS: A MULTI-SPEAKER SOURCE WITH NO SPEAKER ATTRIBUTION** · BLOCKER DISTRIBUTION UPDATED TO 6/12

```
RULING : AR-1041 GPT ruling (gpt-rulings 8e5f95c4) §4 -- reading the remaining ORB teachers
PIN    : 0bbcabc81ae2ed6350bcda4d8494cff1e618dd81  (unchanged -- MEASURED HERE)
STATE  : READ-ONLY. NO PRODUCTION CODE MUTATED. NO COMMIT ON THE ENGINEERING BRANCH.
PRIOR  : AR-1041 (69ae8749) · AR-1042 (7b4973c1) · AR-1043 (679b231f)
```

This closes the one `UNRESOLVED` row in AR-1043 §2 — the row my own §5 recommendation leaned on.

---

## 1. `7ieYBa7Z-Hg` — THE TRIGGER IS A HEDGED CONCESSION, AND THE SPEAKER'S OWN RULE IS DIFFERENT

Bound trigger `[14682-14714]`: **"You can trade that manipulation"**.

Span-resolved, the sentence continues and is immediately qualified:

> *"You can trade that manipulation **if you want to.** **Like I mentioned, the previous range is
> where I look for entries.** So that first hour, it's prime for looking for price to go into a
> previous range and then reject the other way… **So I tend to tell traders, stay out of that first
> hour if you're not as experienced**, but that first hour is totally tradable."*

⇒ **Neither endorsed nor rejected — a permissive aside**, followed by the speaker stating that his
**own** entries come from the **previous range**, and advising less-experienced traders to **stay
out** of the very window the compiled trigger fires in.

**Disposition: `NOT ENDORSED`.** The bound trigger is not the speaker's entry rule. It joins the
polarity class, though by a fourth distinct mechanism — not attribution (`dE4l`), not rejection
(`oDLt`/`e5HQ`/`c8VL`), not a survey (`WV1f`), but **a concession the speaker declines to adopt.**

★ **Four mechanisms now, all producing the same defect:** the persisted trigger is a sentence the
teacher did not prescribe. **A gate that tests only for rejection words catches one of the four.**

---

## 2. 🛑 NEW CLASS — THE SOURCE IS AN INTERVIEW, AND NOTHING RECORDS WHO IS SPEAKING

Reading `7ieYBa7Z-Hg` shows **two speakers**: *"…that initial hour **as you're saying**…"*,
*"**Yes**, that that's what it more or less would be"*, *"**Absolutely.**"*

**The spec schema has no speaker field.** `entry_conditions[]` carries
`id · role · span · type · object · evidence` — measured across all 40 videos, there is no
`speaker`, `turn`, or attribution key.

⇒ **In a multi-speaker source, a condition can be extracted from the INTERVIEWER, or from a guest
being disagreed with, and nothing downstream can tell.** This is the polarity problem's sibling and
it is **not** fixed by classifying discourse frames: a correctly-framed `rule-statement` spoken by
the wrong person is still not the strategy's rule.

**SCALE — MEASURED, with the limit stated:**
```
DENOMINATOR: 40 transcripts
dialogue/interview markers present : 2/40
  7ieYBa7Z-Hg  3 distinct markers  ['absolutely.', "as you're saying", 'yeah. so']   <- CONFIRMED by reading
  h6TnE7QClJg  1 distinct marker   ['let me ask you']                                <- NOMINATION only, NOT read
```
⚠️ **`2/40` is a floor, not a count.** My markers are turn-taking phrases; a two-person source with
clean editing shows none. **And the discriminator is a PEER being addressed, not a viewer** —
monologue teachers say "you" constantly. `h6TnE7QClJg` is unread and may well be a rhetorical
monologue. `UNENUMERATED`.

---

## 3. UPDATED BLOCKER DISTRIBUTION (supersedes AR-1043 §4)

```
POLARITY -- persisted trigger is not the taught rule          : 6/12   <- DOMINANT (was 5)
    rejected strawman   : oDLt, e5HQ, c8VL   (GPT-refused, read)
    third-person        : dE4l               ("They try and go short.")
    survey of others    : WV1f               ("Some go long... some go short")
    hedged concession   : 7ieY               ("...if you want to")        <- NEW
UNQUANTIFIED JUDGMENT                                         : 1/12   (deym)
MISSING SEMANTIC / PRIMITIVE                                  : 4/12   (NMUd, Qxlu, KXWR, sVkm)
OUT OF FAMILY (previous-day levels, not session open)         : 1/12   (xTTD)
UNRESOLVED                                                    : 0/12   <- was 1
CLEAN AND FAITHFUL AS COMPILED                                : 0/12
```

**Half the dispositioned ORB family fails on polarity, by four different mechanisms.** That is the
§7 condition, measured rather than asserted. **`SOURCE-POLARITY-HANDOFF-1` is not started** — §7
reserves the authorization.

⚠️ **Denominator unchanged and still honest: 12 by MY enumeration, not the ruling's 16**
(AR-1042 §4). **I still cannot claim "all 16 dispositioned."**

---

## 4. WHAT THIS ADDS TO THE §7 LANE DESIGN, IF GPT AUTHORIZES IT

Reported as measurement, **not** as a design I am proposing to build:

1. A rejection-word gate catches **1 of the 4** observed mechanisms. `tier2_discourse` already
   measures 1/6 on this class (AR-1041 §4a) — **consistent with that, and for the same reason.**
2. **Speaker attribution is a separate axis from polarity** and needs its own field; frame
   classification cannot recover it.
3. §7's required RED is available in two independent forms:
   `e5HQXYBUW-Q` (trigger refuted 45 chars later, endorsed method materially different) and
   `dE4lPhAWke8` (trigger is third-person on its face — refutable without any window analysis).

---

## 5. SEAT STATUS — NOT A HANDOFF

**Fan-in: 12/12 dispositioned, 0 unresolved.** Reads that remain are *depth* (full end-to-end reads
of `KXWR`, `sVkm`, `WV1f`, and `h6TnE7QClJg`'s speaker question) — **authorized under §4 and
genuinely unstarted, not blocked.**

Everything else needs GPT: `SOURCE-POLARITY-HANDOFF-1` (§7), the `NMUd0oX_7Pg` narrow repair and
its two bands (§11 STOP 1 — I may not pick a point inside a taught band), and AR-1042's `},{`
corruption. **That is a real wait on an authorization, not a manufactured one** — and I am **not**
declaring a handoff, per `worker-onboarding` §5: the seat that exists is the seat that finishes.

**Nothing blocking for the operator.** Engineering branch untouched at `0bbcabc8`.

## 6. SELF-AUDIT

- **I resolved the row my own recommendation depended on** rather than letting `UNRESOLVED` stand
  while citing a blocker count built without it.
- **The resolution strengthened my recommendation** (5→6), which is exactly when to be most
  careful — so I recorded the mechanism separately instead of merging it into the rejection class,
  where it would have inflated the strongest-looking bucket.
- **`h6TnE7QClJg` is a nomination and is labelled one.** I did not read it, and I did not count it.
```
ARTIFACTS: polarity_gate.py · digest.py · read_teacher.py (scratchpad, regenerable)
```

# ALGO-131 — **THE OPERATOR ANSWERED, AND HE DISSOLVED THE QUESTION RATHER THAN ANSWERING IT.** Verbatim: *"I HAVE THE SAME STRATEGY LITERRALT SUPPORT AND RESISTENT KEY ZONES I TRADE OFF MY SETUP AND ITS ONLY 2 EXCEPTIONS TO MY SETUP ITS LIKE WE KEEP GOING IN CIRCLES WHY IS THE BOT NOT GOING OFF MY SETUP."* **[MEASURED HERE] He is right, and it is one line: `kernel.py:205` — `rank = {"BRK5": 3, "BRK15": 2, "REV": 1}`, consumed by `max(candidates, key=(rank[c.setup], …))` at `:206-208`. HIS ZONE REJECTION IS RANKED LAST OF THREE. Whenever a break candidate and a rejection candidate qualify in the same direction at the same moment, THE BREAK ALWAYS WINS AND THE REJECTION IS NEVER TAKEN — which is why 6 of 6 bullet-spends are `BRK5`.** **🛑 AND I CLOSED THIS LANE MYSELF, FIVE RULINGS AGO, ON A WRONG-SURFACE READ: ALGO-121 §1a ruled "the rank at `kernel.py:207` is NOT to be touched — it is faithful," reasoning from the DESTINATION teaching and applying it to the SETUP rank. Those are different objects. The lane I closed had his answer in it.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Corrects:** ALGO-121 §1a, ALGO-125 §9,
ALGO-127 §7.4, ALGO-128 §2, ALGO-129C §5, ALGO-130 §5 — **every place the reserved-class ask was
carried.** **Channel head at drafting:** `00a94c12`. **Strategy head `fdc4f39b`.** **PR #38: DRAFT.
Nothing lands. No code change is authorized by this ruling.**

---

## 1. HIS OWN GOLD FIXTURES SAY "ONLY TWO", AND THEY HAVE SINCE 2026-08-20

`user_fidelity_gold.json`, his labels, verbatim:

- **`V24G03_PREBREAK_DISPLACEMENT_THIRD_CANDLE`** — *"**One of only two pre-break exceptions**:
  genuine displacement drives toward the key level; the trader watches the THIRD candle… may enter
  before its 5-minute close only after sustained directional force is proven near the key level."*
- **`V24G04_REPEAT_TEST_PREBREAK_MOMENTUM`** — *"**The other pre-break exception**: after the level
  has already been tested, price can return and attack/test it again with breakout momentum."*

**His spoken words and his committed fixtures agree exactly: a key-zone setup, and two exceptions.
Nothing new was volunteered — he restated what the corpus already held, and the corpus was never in
doubt. What was wrong was downstream of it.**

## 2. THE MEASUREMENT  **[MEASURED HERE, pin `fdc4f39b`]**

```python
rank = {"BRK5": 3, "BRK15": 2, "REV": 1}          # kernel.py:205
cand = max(candidates, key=lambda c: (             # :206
    rank[c.setup], c.location.quality, c.location.confluence,   # :207
))
```

**`REV` — the zone rejection, his setup — is the lowest of three.** The six bullet-spends,
from the committed census:

| session | setup | reason literal |
|---|---|---|
| 03-23 · 03-24 | `BRK5` | `PREBREAK_REPEAT_TEST_INTRA5_FORCE` ← **his exception #2** |
| 03-31 · 04-09 | `BRK5` | `ACCEPTED_BREAK_RETEST_THEN_INTRA5_FORCE` |
| 04-06 · 04-14 | `BRK5` | `FIRST_BREAK_PRINT_THEN_INTRA5_FORCE` |

**Six of six on break setups. Zero on his.** And **only two of the six** carry a reason literal that
names one of his two exceptions.

## 3. 🛑 THE LANE WAS OPEN AND I CLOSED IT

**ALGO-121 §1a**, mine: *"Queue item 3 is re-specified… The rank at `kernel.py:207` stays untouched…
it is faithful."* Repeated as a standing STOP in ALGO-122A, 125, 127, 128, 129C and 130.

**The reasoning was:** his taught destination rule is *"the nearest **meaningful** physical reaction
owns TP1"*, and `V24G06` forbids skipping a nearer cluster ⇒ *rank-0 is his rule* ⇒ *don't touch the
rank.*

**That teaching is about WHERE TO TAKE PROFIT. `kernel.py:205` decides WHICH KIND OF TRADE TO TAKE.
They are different objects and I joined them because they share the word "rank."**

> **THE WRONG-SURFACE DEFECT I RULED ON EIGHT TIMES TODAY, COMMITTED BY ME, ON THE ONE SURFACE THAT
> HELD HIS ANSWER — AND THEN WRITTEN INTO SIX CONSECUTIVE STOP LISTS SO NOBODY ELSE COULD LOOK.**

**A stop I issue is stronger than a defect I miss.** A missed defect waits to be found; **a stop
instructs everyone to stop looking.** ⇒ **every STOP this desk issues carries the same burden of proof
as a finding, and it must name the surface it applies to.** "Do not touch the rank" named no object.

## 4. THE RESERVED-CLASS ASK IS WITHDRAWN

I asked, four times, *"what makes him pass on an early break-family setup?"* **He does not pass on it.
A breakout is not his setup.** The question presupposed the bot's routes were his routes and asked him
to explain a preference he does not have.

> **A QUESTION BUILT ON YOUR OWN UNEXAMINED PREMISE CANNOT BE ANSWERED — IT CAN ONLY BE DISSOLVED,
> AND THE PERSON DISSOLVING IT SOUNDS LIKE THEY ARE REPEATING THEMSELVES.**

**He said we were going in circles. We were, and the circle was mine.** He restated a fact already in
his fixtures because I kept asking past it. **ASK WITHDRAWN — from the ladder, the handover and every
stop list carrying it.**

## 5. WHAT IS AUTHORIZED — a derivation, and NOT a number

**AUTHORIZED, worker, and this reopens the lane ALGO-121 §1a closed:** derive, from **his words and
his two fixtures only**, the correct relationship between the zone-rejection setup and the break
setups. **Bring the derivation here before any code.**

**The ambiguity that must be resolved by derivation and NOT by guess:** *"only 2 exceptions"* may mean
**(a)** two allowances to enter **early**, on the same key-zone trade — a TIMING exception, not a
competing route; or **(b)** two additional routes that may take the day's trade. **These imply
different repairs and the fixtures' word *"pre-break"* leans (a) — leaning is not deriving.**

**RAILS, unchanged and binding on this lane:**
- **No number is authorized.** Not a new rank, not a weight, not a threshold. **If the derivation
  cannot be expressed without one, STOP and say so.**
- **Nothing is chosen for what it does to the fourteen sessions, the exam, or any arm score.**
- **Rail 11 stands** — this is not a licence to reach for a clock.
- **The one-bullet budget is untouched.** It is his.
- ALGO-125 §5's finding stands and is now better placed: *selection and order are the same operation.*
  **With `REV` ranked last, that is not merely a missing wait — it is a standing preference for the
  wrong setup.**

**HOLD released on this lane only. Everything else in ALGO-130 §5 stays stopped.**

---

**LESSON, minted:**

> **I ASKED HIM TO EXPLAIN A BEHAVIOUR THE CODE INVENTED. THE BOT WAS NOT FAILING TO IMITATE HIS
> CHOICE — IT WAS MAKING A DIFFERENT CHOICE, RANKED IN A DICTIONARY, AND I TOOK THAT RANKING AS PART
> OF THE WORLD RATHER THAN AS A CLAIM.**

Six of six trades came from a route his fixtures call an *exception*, and the word **"exception"** —
present in the corpus since 2026-08-20 — **is itself a statement about priority that nobody read as
one.** **When the operator says the same thing three times and it does not land, the failure is in the
listener's model, not in his phrasing** — and *"we keep going in circles"* is the most precise bug
report this campaign has received.

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.*

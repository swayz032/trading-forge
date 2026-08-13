# AR-1107 (worker) — `AR-1106` STEP 0 DISCHARGED. THE ORIGINAL OBJECTS ARE PUBLISHED; NOTHING WAS RECREATED. REMOTE HEAD VERIFIED BY TWO NON-OVERLAPPING PATHS.

**Governing:** AR-1106 (GPT) §2 — mandatory Step 0
**Seat:** fresh worker, seated `2026-08-13`, cold start under `worker-onboarding §0-CTRL`
**Action:** publication only. **No code was written, no test was run, no unit was started.**

---

## 1. YOUR §1 PREMISE WAS CORRECT AT YOUR PIN, AND I CONFIRM IT INDEPENDENTLY

`[MEASURED HERE, before the push]`

```
git ls-remote origin refs/heads/h1-wave4-sealed12-driver
88783ad0b6c1062f445e92df78701d90c92df312   refs/heads/h1-wave4-sealed12-driver
```

That is exactly the head you observed. **The previous seat committed the F-3 work and never pushed
it.** Your `No commit found` on both objects was a true reading of the remote, not a fetch fault.

---

## 2. §2.4 SATISFIED — THE ORIGINAL OBJECTS EXISTED LOCALLY AND WERE PUSHED UNMODIFIED

You forbade recreating the implementation to obtain new SHAs. **Nothing was recreated.**
`[MEASURED HERE, before the push]` both objects were already present and already ancestors of the
local branch head:

```
85ac999c -> commit  full=85ac999c2783e51c05614c01c8955c8c16b496c3   ANCESTOR-OF-HEAD yes
e9406e36 -> commit  full=e9406e362315869cb97bbf07851550eb6e56ad71   ANCESTOR-OF-HEAD yes
```

The push was a **fast-forward, asserted before it ran**, so no history was rewritten:

```
git merge-base --is-ancestor 88783ad0 HEAD  ->  remote head IS ancestor of local HEAD
88783ad0..1c8f554f  h1-wave4-sealed12-driver -> h1-wave4-sealed12-driver
```

---

## 3. ⚠️ DISCLOSURE — THE PUSH PUBLISHED **THREE** COMMITS, NOT TWO

You named two. The branch carried a third on top of them, and I am not going to let it arrive
unannounced:

```
1c8f554f  AR-1105 + SYSTEM-INVENTORY regenerate (pre-push freshness gate)   <-- the third
e9406e36  F-3: explicit empty-sample state + AR-1104 s5 discriminators B/E/F2
85ac999c  F-3: realized metrics exclude unresolved positions (AR-1101 s4)
```

`1c8f554f` is the AR-1105 report document plus a `SYSTEM-INVENTORY.md` regeneration the pre-push
freshness hook requires. **It is not implementation.** I published the branch head rather than
cherry-picking two commits onto the remote, because splitting them would have produced objects
whose trees differ from the measured ones — the outcome your §2.4 forbids.

**Full SHAs, per §2.3:**

```
85ac999c2783e51c05614c01c8955c8c16b496c3
e9406e362315869cb97bbf07851550eb6e56ad71
1c8f554fce09b01bc1ad7e293bee73a5d505ce98   (branch head, docs + inventory only)
```

---

## 4. §2.2 — REMOTE HEAD VERIFIED, AND NOT FROM LOCAL STATE

You explicitly refused local `git status` as evidence. Two non-overlapping paths, both post-push:

**PATH 1 — remote ref advertisement (`git ls-remote`, no local ref consulted):**

```
1c8f554fce09b01bc1ad7e293bee73a5d505ce98   refs/heads/h1-wave4-sealed12-driver
```

**PATH 2 — GitHub REST per-object, which is the check that FAILED for you in §1:**

```
85ac999c2783e51c05614c01c8955c8c16b496c3 | F-3: realized metrics exclude unresolved positions (AR-1101 s4)
e9406e362315869cb97bbf07851550eb6e56ad71 | F-3: explicit empty-sample state + AR-1104 s5 discriminators B/E/F2
1c8f554fce09b01bc1ad7e293bee73a5d505ce98 | AR-1105 + SYSTEM-INVENTORY regenerate (pre-push freshness gate)
```

**NEGATIVE CONTROL — the instrument can still say no:**

```
deadbeef...deadbeef -> {"message":"No commit found for SHA: ...","status":"422"}
```

That is the same sentence your §1 received. **A green read from an instrument that cannot go red is
not evidence**, so the control is published beside the result.

⚠️ **INSTRUMENT NOTE:** the pre-push hook stashed and restored an unrelated dirty file
(`docs/wave25-exit-engine-ab-report.md`). Its own stdout reported `Restored changes`, and
`git status` after the push shows that file still modified — the stash window closed cleanly and
altered nothing that was pushed.

---

## 5. WHAT I DID **NOT** DO

- **No engineering.** Per §2 *"Stop after publication"*: no timeframe reconciliation, no acceptance
  population work, no artifact revaluation, no performance run.
- **I did not re-run the F-3 proof matrix.** The 37-test suite, the mutation controls and the
  107-member census are the previous seat's measurements, published now as objects you can execute
  yourself. **From this seat they are `RELAYED`, and publication does not upgrade them.**
- **I did not re-grade anything.** Your §4 inspection list is yours; §5.B remains unit-level only
  and the historical artifact population remains un-re-run, exactly as AR-1105 disclosed.

---

## 6. ⚠️ ONE PRIOR-ART FINDING, SURFACED BECAUSE IT BEARS ON THE UNIT YOU HAVE QUEUED NEXT

Before AR-1106 landed on my ear, I had begun the mandatory pre-flight for AR-1101 §7 unit **C**
(`SVKM-TIMEFRAME-AUTHORITY-1`), which your §5 order still places immediately after F-3. **I stopped
it the moment your ruling arrived and started nothing.** But the pre-flight had already turned up
something you should hold before you re-issue that unit:

**AR-1101 §5 question 1 — *"What opening-range duration did the teacher actually define: 5m, 15m,
or another value?"* — is ALREADY RULED, and the answer is none of those three shapes.**

`[MEASURED HERE, `docs/designs/ADVISOR-RULINGS.md`]` — `R-736`, verbatim:

> *"THE DURATION QUESTION IS ANSWERED AND THE ANSWER IS NEITHER OF THE WORKER'S TWO OPTIONS:
> PRESERVE ALL THREE TAUGHT WINDOWS, EXPAND DETERMINISTICALLY INTO THREE CANDIDATES, CHOOSE NONE."*

Reaffirmed at `R-743`, and **enforced in committed code, not merely ruled** — `[MEASURED HERE]`
`expand_execution_candidates` in `src/engine/opening_range_candidate.py` takes no `default_variant`,
and `OpeningRangeDefinition.selected_duration_minutes` **raises** rather than returning a choice.

⇒ **The `15m` variant in `test_source_vertical_join.py` is therefore NOT evidence of a stale
fixture.** `[MEASURED HERE, `:100-101`]` it instantiates `OpeningRangeVariant(variant_label="15m",
duration_minutes=15, source_quote="the first 15 minute range")` — i.e. it exercises **one of the
three legitimately taught candidates**, which is what the settled architecture requires it to do.

🛑 **I am citing this, not re-deciding it** — `AR-896` put this same question to the desk as an open
architecture choice and the operator caught it from memory (`R-774 §3`).

**WHAT REMAINS GENUINELY OPEN in your §5, and is not touched by `R-736`:** questions **2, 3 and 4**
— which timeframe owns breakout confirmation, which owns the three-candle FVG and third-candle
entry, and whether the persisted compiled artifact carries those **execution-timeframe roles** at
all. `R-736` settles the *duration of the opening range*; it says nothing about *execution
timeframe*. `[MEASURED HERE]` `opening_range_candidate.py` and `opening_range_definition.py` carry
`duration_minutes` and no execution-timeframe field, and the fixture runs every leg on `5m` bars
(`timeframe="5m"`, `:253`) — **so your suspicion that the fixture may be standing in for unmodelled
timeframe roles survives the prior-art check.** That is a `HYPOTHESIS` from a two-file read, not a
finding; the real reconciliation is unit C and I have not started it.

⇒ **RECOMMENDATION:** when you re-issue unit C, drop question 1 and cite `R-736` for it. Spending a
ruling on it risks reversing settled, code-enforced law.

---

## 7. SEAT STATE

- **Ear:** armed at seating on `origin refs/heads/external-advisor/gpt-rulings` @ `92abec41`
  (2s poll, Monitor, delivering to chat). **It fired on `92abec41 -> 596c4629`, which is how
  AR-1106 reached me** — the detector is proven, not merely running. **Blind window: none** —
  `92abec41` was AR-1105, my own predecessor's report, and I read AR-1101/AR-1104/AR-1105 by hand
  before arming.
- ⚠️ A second `gpt_branch_ear.sh` process (PID `24640`) is alive under a **dead parent** (`5092`,
  no longer in the process table) — an orphan from the previous seat that can deliver to nobody.
  **I did not arm it and I did not kill it.**
- **Position:** `h1-wave4-sealed12-driver` @ `1c8f554f`, local == remote.
- **STOPPED, per your §2**, awaiting your inspection of the now-published F-3 implementation.

## 8. STATUS

**AR-1106 Step 0:** **DISCHARGED.**
**Objects recreated:** **NONE** — originals pushed, fast-forward asserted first.
**Remote head:** `1c8f554fce09b01bc1ad7e293bee73a5d505ce98` `[MEASURED HERE, ls-remote + GitHub REST, with negative control]`.
**F-3 claims:** still `UNVERIFIED` by this seat — they are now **inspectable**, which is all this unit was for.
**Engineering started:** **NONE.**

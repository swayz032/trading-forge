# ALGO-171 — **CONFIRMED AT SOURCE.** The second `09:30` literal was never deleted. **It moved into the kernel.**

**Strategy head:** `63fff63e` — pushed, remote-verified. **PR #38: DRAFT / DO NOT MERGE.**
**Semantic files modified: NONE.** Read-only: no v2.4 file written, nothing monkeypatched.
**Gate:** `45 passed`, enumerated by `--collect-only`.

**ALGO-168 named its own escape route. This closes it — and it very nearly closed the other way.**

---

## 1. WHAT LOOKED LIKE A REFUTATION OF MY OWN FINDING

**`core.run_day` builds its map at `08:00` and is perfectly causal.**

```
v2_2_engine.py:924   open_ts = session.index[0]
v2_2_engine.py:879   r5 = v1.feat(raw5[(raw5.index.time >= TRADE_START) & ...])   # TRADE_START = 08:00
```

**And its own comment celebrates having deleted the duplicate:** *"It was a second copy of the
`09:30` literal, which meant a ROLE-1 amendment moved the window to a time with no bars in it and
changed nothing — a silent no-op."*

**For twenty minutes I believed I had published a false positive.**

## 2. 🛑 WHAT ACTUALLY RUNS FOR v2.4 IS A DIFFERENT FUNCTION

```
kernel.py:222   open_ts = pd.Timestamp(f"{dte} 09:30", tz=core.TZ)
kernel.py:229   locations, _ = build_entry_locations_v24(env, dte, open_ts, p)
```

…while `_bucket_starts(r5, one, dte, as_of)` iterates decisions **from `08:00`**.

**`iter_actionable_candidates` is the function the candidate walk used and the one that produces
the trades.**

> **THE SECOND COPY OF THE `09:30` LITERAL WAS NOT DELETED. IT MOVED.** The fix landed in
> `v2_2_engine` and the kernel kept its own copy — and the kernel is what runs. **The pinned
> capture's `map_anchor` note — *"mirroring `candidate_xray.py` and `kernel.py`"* — was accurate
> all along; I doubted the artifact and the artifact was right.**

**The two engines disagree with each other about when the map is drawn, and the one that anchors
LATE is the one whose decisions start EARLY.**

## 3. MEASURED AT THE LIVE BUILDER — both flagged sessions, control passing

| session | anchor | authorized locations | flagged zone present? |
|---|---|---|---|
| **2026-03-30** | `09:30` — **what the kernel uses** | 37 | **YES** |
| | `08:00` — causal for the decision | 37 | **no** |
| **2026-04-02** | `09:30` — **what the kernel uses** | 47 | **YES** |
| | `08:00` — causal for the decision | 45 | **no** |

**POSITIVE CONTROL PASSED on both:** the `08:00` build returned **37** and **45** authorized
locations. **Each "absent" is therefore evidence about the zone, not about an empty call** — the
population failure that would have made this whole table meaningless.

⇒ **The two `08:07` trades used a zone that does not exist in the causal map. Confirmed by calling
the production builder, not by reading a capture.**

## 4. WHAT THIS DOES AND DOES NOT SETTLE

- **ALGO-168's stated limitation is CLOSED, in the confirming direction.** It was a real
  possibility, it was checked, and it did not hold.
- **This is still EXISTENCE, not STATE.** ALGO-137's refutation of the state version stands
  untouched — `zone_state_at` really is re-evaluated per bucket. **Two different objects, and only
  one of them was ever traced.**
- **Scope is exactly two decisions on fourteen sessions.** I am claiming nothing about how much of
  v2.4's behaviour this touches, and the `2 of 19` in-window figure from ALGO-168 is the honest
  denominator.
- **No repair proposed. No census re-scored. v2.4 untouched.** Moving the kernel's anchor would
  change which zones exist at all — that is a ruling, not a worker's edit.

## 5. HOLDING

**Per ALGO-170: report and hold.** No fourth build, no proximity term, no recency, no tolerance,
no linkage change, no v2.4 edit, no MC, and no adoption decision in a result message.

**The lane you called the only live one has now returned an answer that survives its own named
escape route.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this packet.*

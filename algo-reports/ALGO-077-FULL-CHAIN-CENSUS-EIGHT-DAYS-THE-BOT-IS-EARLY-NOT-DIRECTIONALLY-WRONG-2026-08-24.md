# ALGO-077 — FULL-CHAIN CENSUS, ALL EIGHT DAYS: **THE BOT IS EARLY, NOT DIRECTIONALLY WRONG**

**Strategy head:** `cf53acb3320d00e6c71354ae87dfed9ce15cd5d0` (pushed, `ls-remote` verified)
**Chain:** `1c83cbbf` → `dca5d634` → `cf53acb3`
**PR #38:** DRAFT / DO NOT MERGE
**Semantic production files modified:** ONE, declaration only — `target_policy.py` gains a
module-local `UNFROZEN_CHOICES`. No logic, no behaviour, **value unchanged at 400.0**.
**Gate state:** freeze BLOCKED. **No repair landed, no number moved**, as ordered.
**Suite:** enumerated, `pytest tests/` → **1624 passed, 7 failed**. Membership vs the pre-packet
baseline: **zero added, zero removed.** The runbook's own pinned expected-failure count (7) holds.
**Numbering:** you reserved ALGO-077 for the repair ruling; this report took the next sequential
slot, so that ruling is **ALGO-078**.

---

## 1. The census — every gate, all eight days, control clean

`BLK` = this gate blocks **his labelled trade**.

| session | S1 loc | S2 auth | S3 fill | S4 budget | S5 target | S6 classify | n |
|---|---|---|---|---|---|---|---|
| 03-23 | ok | **BLK** | ok | **BLK** | **BLK** | ok | 3 |
| 03-24 | **BLK** | **BLK** | ok | **BLK** | **BLK** | ok | 4 |
| 03-30 | ok | ok | ok | ok | **BLK** | ok | **1** |
| 03-31 | ok | **BLK** | ok | **BLK** | **BLK** | ok | 3 |
| 04-02 | — | — | — | ok | — | — | 0 *(NO_TRADE, walked as a decline)* |
| 04-06 | ok | **BLK** | ok | **BLK** | **BLK** | ok | 3 |
| 04-09 | **BLK** | **BLK** | ok | **BLK** | **BLK** | **BLK** | 5 |
| **04-14** | ok | ok | ok | ok | ok | ok | **0** *(CONTROL)* |

Frequency over the 6 traded days: **S5 6/6 · S2 5/6 · S4 5/6 · S1 2/6 · S6 1/6 · S3 0/6.**

Gates that cannot be asked without an upstream pass are recorded
`NOT_INDEPENDENTLY_EVALUABLE`, never silently as PASS.

## 2. Why three rounds of real repair moved the headline by zero — quantified

**Only 03-30 is blocked at a single gate.**

| repair set | days unblocked |
|---|---|
| `{S5}` — the gate that blocks 6/6 | **1** (03-30) |
| `{S2,S4,S5}` | 4 |
| `{S1,S2,S4,S5}` | 5 |
| **`{S1,S2,S4,S5,S6}`** | **6 — minimal set for all** |

No two- or three-gate set exceeds four days. Fixing the *most frequent* gate alone reaches one
day. That is the trap the last three rounds were in, and it is now a measured quantity rather
than a hypothesis.

*(Caveat stated so it cannot be misread: "unblocked" means no gate in this census refuses. It is
a NECESSARY condition, not a sufficient one — agreement additionally requires the bot to fire at
his time and direction.)*

## 3. **S4 is TAUGHT — so the biggest finding is not a repair at all**

The one-trade budget is taught. A "repair set" containing S4 is not a repair set. What its block
actually reports is that **the bullet was already spent on a trade he did not take:**

| session | bot's first approved | his entry | same direction? | bot early by |
|---|---|---|---|---|
| 03-23 | 08:14 **S** | 11:21 S | **yes** | 187 min |
| 03-24 | 08:17 **S** | 09:32 L | **no** | 75 min |
| 03-31 | 09:03 **L** | 09:49 L | **yes** | 46 min |
| 04-06 | 09:07 **S** | 10:04 S | **yes** | 57 min |
| 04-09 | 09:37 **L** | 11:35 L | **yes** | 118 min |
| **04-14 (control)** | 09:38 **L** | 09:36 L | **yes** | **−2 min** |

On **4 of the 5** blocked days the earlier trade is in **his own direction**, 46 minutes to 3
hours early. On the control the bot fires **two minutes after** him.

> **The discriminator between agreement and failure is TIMING, not direction.** The bot takes the
> session's first legal setup; ALGO-051 has him **WAIT** for the reaction — *"how price got to
> close to my take profit before i could jump in… i let [it]… momentum candle breakout and i
> jumped in and targeted the next key zone."*

That sits **upstream of every gate in the census**, and I do not think it can be reached by
repairing S1/S2/S5/S6 individually. It is the thing I would most want ALGO-078 to rule on.

## 4. Target layer — one hypothesis, two different defects

TAUGHT (ALGO-051 verbatim, ALGO-052 measured): **the target is a KEY ZONE BAND — the next/opposite
key zone.** MACHINE (`targets.py` eq. 1): *first meaningful reaction area by near edge*, over a
universe that also contains `LIQUIDITY_CLUSTER` and `FVG_15M`. **They differ in UNIVERSE, not just
ordering.**

| session | verdict | his TP | machine chose | gap to nearest considered |
|---|---|---|---|---|
| 03-24 | `PREDICATE_MISSPECIFIED` — **SELECTION** | 24641.50 (329.25 pts) | 24358.00 (45.75), KEY_ZONE_15M | **0.0** |
| 03-30 | `TARGET_NOT_IN_MAP` — **COVERAGE** | 23355.25 | 23373.75, LIQUIDITY_CLUSTER | **4.34** |
| 03-31 | `TARGET_NOT_IN_MAP` — **COVERAGE** | 23540.75 | 23525.75 | **10.83** |
| 04-14 *(control)* | `NO_MARKED_TP_IN_HIS_DIRECTION` | none | 25869.00, FVG_15M | — |

03-24 confirms your hypothesis exactly: his TP **is** a 15m key zone, **is** among the 81
considered destinations, **passes** the floor, and a nearer key zone won. **03-30 and 03-31 do
not** — his TP is in no considered destination and no key zone, so **no re-ordering can reach it.**
`TARGET_NOT_IN_MAP` is **PROPOSED** as the target-layer residual, flagged not minted.

**The $400 floor refuses NOTHING at his own entry** — 81/81, 10/10, 122/122, 3/3 clear it. The
112.50/382.50/397.50 refusals in ALGO-075 were at the **bot's** candidate prices and clocks. Your
"not the defect" is confirmed; I should have named the instant the first time. Declared as ordered
in `UNFROZEN_CHOICES` with provenance **UNCITED**, surfaces and positive control recorded,
**value untouched**.

**And the invariant any selection repair collides with:** `targets.py` closes with *"No farther
feature may leapfrog a nearer meaningful reaction area for prettier PnL."* Nearest-first is a
deliberate anti-fitting guard. I am not proposing to weaken it — I am telling you it is what a
selection repair has to answer to.

## 5. Order (d) — the prescribed test does not discriminate

*"Wick extreme within one tick of his line"* returns **ZERO on 04-06** — and **ZERO on 03-31**,
whose band the J5 module **does** derive. It fails identically on derivable and underivable cases.
Under the ratified J5 rule the wick passes **through** the level and rests beyond it, so its
extreme is never *on* the line. Re-run with the J5 penetration predicate, 03-31 as positive
control (**12 rejections**): 04-06 has **2 penetrating candles at 10:00**.

**Corrected mid-packet:** I first used the zone's `marked_time` (09:52) as his entry clock and
concluded the rejection postdated his trade. **His entry is 10:04** (`labels.first_entry_time`);
10:00 **precedes** it by four minutes. Verdict is **`MARKING_METADATA_POINTS_AT_THE_WRONG_BAR`** —
**no look-ahead.** Test corrected with it.

## 6. J5 FORMING label — **all four**, not just 03-24

| session | bar | closes | state |
|---|---|---|---|
| 03-24 | 15m 09:30 | 09:45 | FORMING |
| 03-30 | 5m 09:35 | 09:40 | FORMING |
| 03-31 | 5m 09:35 | 09:40 | FORMING |
| 04-14 | 5m 09:30 | 09:35 | FORMING |

Three of four are marked at the **exact open** of their bar. **Every band uses extremes and a
close that did not exist when he drew the level.** All four are the H-CONFIRM case.

## 7. Order (2) — the 2025-04-11 acceptance read: **HELD**

Established: the date is confirmed again on the record (`Fri 11 Apr '25`, MNQ 5m, FXReplay; the
two drawn zones measure ~18,765–18,800 and ~18,595–18,665, matching my earlier axis figures).
**The tape is not one session** — its final frames are `Mon 14 Apr '25` — and it is a **desktop
capture**, not a chart recording: measured, only **18 distinct screen states across 47 frames**,
one span of ~90 minutes being a single frozen screen. **No break-retest entry was captured** at
300 s or in a finer 30 s pass.

**Held, not failed:** the operator identified content in the recording that was included
accidentally. I deleted every frame I had extracted (135 files; his source video untouched) and I
am not continuing to mine a private desktop capture that has been flagged. **Nothing from it
reached any commit, artifact or report** — verified. **Unblocks on** a scoped time range or his
confirmation that a bounded pass is fine. Until then **`acceptance_bars` stays 3** and 03-31 stays
lost honestly — exactly the disposition you pre-registered for a silent tape.

## 8. Three defects of mine, all caught by controls before publication

1. **S2 joined on rendered text** — X-ray writes `bucket` via `isoformat()` (`…T09:35`),
   `str(Timestamp)` gives `… 09:35`. Matched nothing on every session, so S2 read BLOCKED on all
   eight days **including the control**. The other seven rows looked plausible; only *"the control
   must be zero"* exposed it.
2. **Zone selector took the band nearest his fill** — on 04-06 that is his **target**, not his
   entry level. Caught by disagreeing with J16 on 1 of 5. Now selects by **penetration**; agrees
   **5/5**.
3. **`picked.price` does not exist** on `core.Target` (it is `executable_price`) — published
   `target_executable: null` for all four sessions while looking complete.

## 9. Asks for ALGO-078

1. **The timing/WAIT finding (§3)** — this is the one I think is load-bearing. S4 cannot be
   repaired; the bot must stop taking the session's first legal setup.
2. Ratify or rename **`TARGET_NOT_IN_MAP`**.
3. Rule **selection** (03-24) and **map coverage** (03-30/03-31) separately, and say how selection
   is repaired without repealing the nearest-first anti-fitting guard.
4. Rule the **FORMING** finding — every J5 band currently uses post-marking data.
5. Scope order (2) or confirm it stays held.

Artifacts at `cf53acb3`: `..._full_chain_blocker_census_2026_08_24.json`,
`..._tpg_target_layer_2026_08_23.json`, `..._0406_marking_by_line_2026_08_23.json`,
`..._j5_bands_five_sessions_2026_08_23.json`, `..._tpg_0331_rerow_2026_08_23.json`.

---

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in this packet.

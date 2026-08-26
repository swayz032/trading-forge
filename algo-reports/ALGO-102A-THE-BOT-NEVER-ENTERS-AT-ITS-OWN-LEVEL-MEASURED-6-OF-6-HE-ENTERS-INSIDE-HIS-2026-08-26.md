# ALGO-102A — Addendum to ALGO-102, and it is a structural finding neither lane was looking for: **the bot never enters at the level it is trading.** On 6 of 6 measurable sessions its fill lands **5.75–28.17 points beyond its own authorising band**, in the trade's direction, every time. His fill lands **inside** a his-rule band on 5 of 5 measurable. Same minute, different level — and on three of thirteen measured entries a 17.25-point stop measured from the fill lands **inside the authorising band itself**.

**Advisor:** Claude (Fable 5), ALGO seat — `trading-forge-49`. **Rules on:** the advisor-owned
EDGE finalizer's section I.4 (`…/a96/edge2/his_entries_race.json`, four positive controls, all
PASS). **Uses no PnL, no outcome and no label-derived value — pure geometry**, so it is admissible
in the fidelity lane and is recorded here rather than in the EDGE report alone. **Channel head at
drafting:** `4b906e25`. **Main head:** `c62bb561e015`. **PR #38: DRAFT / DO NOT MERGE.**
**Changes nothing in flight** — T3″ (ALGO-101A) and L3 (ALGO-102 §4) proceed unchanged.

## 1. Measured, both sides

**THE BOT, relative to its OWN authorising band, at its own fills:**

| session | side | bot fill | its authorising band | band width | fill vs band | 17.25 stop lands inside that band? |
|---|---|---|---|---|---|---|
| 03-23 | S | 24,429.00 | [24,443.76, 24,453.24] | 9.48 | below by **14.76** | **YES** |
| 03-24 | S | 24,333.25 | [24,308.25, 24,327.50] | 19.24 | above by 5.75 | no |
| 03-31 | L | 23,383.25 | [23,392.69, 23,404.11] | 11.42 | below by 9.44 | no |
| 04-06 | S | 24,278.50 | [24,289.33, 24,293.17] | 3.83 | below by 10.83 | no |
| 04-09 | L | 25,056.25 | [25,029.72, 25,035.78] | 6.06 | above by 20.47 | no |
| 04-14 | L | 25,746.00 | [25,714.67, 25,717.83] | 3.16 | above by 28.17 | no |

**6 of 6. The fill is always outside, always in the trade's direction, by 5.75–28.17 points** —
against authorising bands only **3.16–19.24 points wide.** The bot routinely enters one to nine
band-widths past the structure it cites as its reason.

**HIM, same treatment:** his fill is **inside** a his-rule band on **5 of 5** measurable
(03-23, 03-24, 03-30, 04-06, 04-09; 03-31 and 04-14 have no his-rule band at all), while his fill
is **outside the bot's authorising location on 5 of 5** where that location is known — above by
76.28 / 243.36 / 40.02 / 25.17, below by 75.68. **Same minute, different level**, measured.

## 2. The mechanism is TAUGHT — which is why this is a finding, not a bug report

ALGO-033 places the rejection story on the last **completed** bar and the entry on the **forming
trigger**'s force. The fill is therefore at least one bar after the interaction **by design**, and
in a fast move that bar carries price well past the zone. **This is the taught sequence executing
correctly** (`AUTHORIZED_LOCATION → APPROACH → INTERACTION → STORY → FORCE → ENTRY`); the
displacement is its arithmetic consequence, not a defect in it.

**What is NOT established anywhere is what the 17.25-point stop is measured FROM.** Measured from
a fill 5–28 points past the band, a fixed stop bears no fixed relationship to the structure — and
on **3 of 13 measured entries** (his 03-24 and 04-09, the bot's 03-23) **the stop lands inside the
authorising band**, so the structure's own width can take it out without the trade being wrong.
The stop *distance* is the operator's and is verified (`17.25 × $2 × 15 = $517.50`, his stated
risk); its *placement* relative to the level is recorded in no artifact this campaign holds.

## 3. The caveat that must travel with this finding

**His-rule bands are dense.** Z1 built ~250–370 per session and reported 24 / 25 / 49 / 45 / 1
supporting zones at his five supported entries. **"His fill is inside a his-rule band" is therefore
weak evidence on its own** — with that many bands a fill is often inside one. The **strong** half
is the bot's own column, which compares the bot's fill to the bot's own cited band and needs no
his-rule construction at all.

## 4. Disposition — NAMED, QUEUED, NOT OPENED

No repair is proposed and none is authorized. Two questions for a lane after L3, both governed by
ALGO-102's anti-overfit protocol and neither answerable by fitting: (a) **is entry-to-band
displacement a fidelity defect at all**, given §2 says the sequence is taught — or is it the price
of the taught order; (b) **what is the stop measured from** — a fact about his own trading that no
artifact records, and therefore one of the very few legitimate reserved-class asks left.

**Control note worth keeping:** the finalizer's fourth control is the only one in its section that
does not check its own work against itself — two non-overlapping paths (the ALGO-096 census in the
`wt-mnq-v24` tree, a different seat on 08-25, and a fresh rebuild from the pinned tape at
`56d9360d` today) name the same `SWING:R:2026-04-14T09:15:00-04:00:102865` band **identical to the
float**.

LESSON: two lanes measured *which zone* and *which destination*, and the difference that showed up
was neither — it was **how far past the zone the fill lands**. A campaign can measure the right
objects for weeks and miss the distance between them.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.

# ALGO-026 — Both ALGO-025 measurements done, and both found a hazard. Grade still out.

**Strategy head:** `d9fd823c5bf4` (pushed, remote verified) · PR #38 **DRAFT / DO NOT MERGE** ·
kernel/entries/force/engine **byte-identical to `068bb24a`** · **semantics NOT started.**

ALGO-025 ordered two read-only measurements. Neither is the amendment or the adapter; both are
the thing you have to know before writing either. Both landed with a hazard in hand.

---

## 1. §3 item 3 — the 09:30 bound. **It is not one constant. It wears four hats.**

    30 code sites carrying 09:30, across four generations:
      ROLE 1  TRADING WINDOW START ............ 4   <- the ONLY thing the teaching is about
      ROLE 2  SESSION-OPEN LOCATION ANCHOR .... 8
      ROLE 3  RUNTIME EXECUTION START ......... 5
      ROLE 4  DATA-PREP / RTH FILTER .......... 7
      UNCLASSIFIED, inspect by hand ........... 6

**ROLE 1** goes through `core.TRADE_START` and is a one-place change. **ROLE 2 is a hardcoded
literal that does not read it:**

    kernel.py:132   open_ts = pd.Timestamp(f"{dte} 09:30", tz=core.TZ)
    kernel.py:139   build_entry_locations_v24(env, dte, open_ts, p)

`open_ts` anchors the pre-open S/R map, so moving it changes **which zones exist** and every
location, story and force downstream. **A find-and-replace of 09:30 → 08:00 would move it
silently and invalidate every number in the campaign** — your §3.2 warning, now located to the
line. **ROLE 3** is five more independent literals in the live and shadow runtimes
(`START = time(9, 30)`, `EXECUTION_START = time(9, 30)`); none read `core.TRADE_START`, so they
would silently disagree with an amended kernel.

Two tests carry the hazard rather than the prose: one asserts the kernel anchor **is** a literal
and **not** a `TRADE_START` reference (with a message saying to update it deliberately if that
ever changes, not delete it); another asserts `open_ts` really is what feeds
`build_entry_locations_v24`, so ROLE 2 is not a frightening label on a harmless line.

Two defects in my own census, both caught by running it: it **counted itself**, and
`time(9, 30)` assignments lost their variable name so the five runtime starts fell into
UNCLASSIFIED. Both fixed, and the prose no longer carries a count at all — counts go stale.

---

## 2. §2 item 1 — the TopstepX prior art. **Already wired, and the kill switch is untested.**

`ProjectX` **is** TopstepX: `API_BASE` is literally `https://api.topstepx.com/api`. And it is
further along than the ruling assumed — **`current_mnq_strategy_v2_4_shadow_runtime.py` already
imports `ProjectXBroker`**, five v2.x modules in total. **No new adapter should be authored.**

    public methods                 13
    touched by any test             2
    SAFETY-CRITICAL exercised    NONE
    SAFETY-CRITICAL unexercised   cancel_all · cancel_order · flatten · flatten_contract ·
                                  get_open_position · get_open_positions · get_working_orders

**Every method that stops a runaway bot has no test exercising it.** §2 item 3 names a dead-man
switch and EOD flatten discipline as *part of the product*, and that is precisely the half with
zero coverage. The adapter exists and is wired; the half that protects the account is unproven
even at the request-shaping level the other tests reach.

What the existing tests **do** establish, scoped honestly: **request shaping only.** They inject
a `FakeSession` — verified offline by construction, not assumed — so they prove the adapter
builds the calls it intends to build. They cannot prove TopstepX accepts them.

**I did not connect and did not estimate live behaviour from an offline test.** The §2.2 hard
gate travels *inside* the assessment output, so "it exists and is wired" cannot be read
downstream as "we may connect it". Credentials are absent here and a test records it.

---

## 3. Two things I want to flag rather than decide

1. **The safety-core gap is deployment-lane work, and it is cheap and gate-free.** Writing
   offline `FakeSession` tests for flatten/cancel/position-read connects to nothing and would
   move the anti-retail floor from a named requirement to a proven one. It is not in the current
   queue. **Say if you want it slotted; I have not started it.**
2. **The window amendment now has a shape.** It is a ROLE-1-only change plus a deliberate
   decision about ROLE 3, with ROLE 2 explicitly left alone — and it needs the before/after
   14-case deltas you ordered. Still queued behind the grade; not started.

---

## 4. Status

**The re-dispatched grade is still out** against pin `4d786333ccee`. It is the gate on
semantics, and the mechanism renders late rather than never — I am not treating silence as
failure a second time. Meanwhile the teaching lane's prerequisite is closed (ledger clock is
**Eastern**, measured by the hard 09:30 floor: earliest of 74 entries exactly 09:30, zero
before) and the bounded video enumeration is done (**71% frozen screen**, longest run 96 minutes
pixel-identical).

Suite 7 failed / 1141 passed, enumerated; same 7, all outside this lane. **No PnL, realized
outcome, winner/loser label or clean-edge result participated in any decision in this packet** —
the ledger's `rPnL` was not read, and the realized-PnL display in the video was rejected as a
join anchor for the same reason.

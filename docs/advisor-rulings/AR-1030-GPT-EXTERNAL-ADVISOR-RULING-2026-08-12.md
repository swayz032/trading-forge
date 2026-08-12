# GPT EXTERNAL ADVISOR RULING — AR-1030 / R3-5 ACCEPTED / R3 = 5 OF 5 CLOSED / PHASE 5 REFEREE ENGINEERING CLOSED / START MP1-CANDIDATE-INGRESS-1 NOW

## 1. VERDICT

**AR-1030 ACCEPTED.**

**`R3-5 = CLOSED`.**

**`R3 = 5 / 5 CLOSED`.**

**`PHASE 5 REFEREE ENGINEERING = CLOSED`.**

There is **no `R3-6`**. Do not extend the referee campaign.

The current worker is authorized and instructed to move **immediately** into:

**`MP1-CANDIDATE-INGRESS-1` → persisted candidate/config authority → DB → `/api/backtests` → Python backtester.**

No handoff is required. The current fresh worker continues.

## 2. EXTERNAL VERIFICATION

I independently verified the load-bearing closeout evidence on origin.

### Final closeout receipt resolves

Commit `3be07ddc043faa82c5a6291345b669aece57e968` resolves on origin and adds only:

`docs/designs/ACCEPT5-R35-CLOSEOUT-RECEIPT-2026-08-12.md`

The receipt records exactly one canonical isolated arm at pin `1ff326750e66f5da7807efa974ceb72cd9c47284` with:

- `arm_start_head == arm_end_head == head == 1ff32675...`
- `layer2 = True`
- `reverse = False`
- `limited_subset = False`
- `reverse_nodes = False`
- `ownership_blind = False`
- `108 / 108` children executed
- `2420` nodes
- `2386` passed
- `32` failed
- `2` xfailed
- `34` non-pass
- `0` skipped
- `0` errors
- `0` xpassed
- `0` duplicate IDs
- `0` collected-but-unexecuted
- `0` invalid/refused children

The outcome map length is `2420`, matching the node count.

### Exact non-pass identity is unchanged

The receipt joins the final arm to durable authority-map receipt `858506cf` by exact node ID and records:

- receipt IDs: `34`
- arm non-pass IDs: `34`
- only-in-receipt: `0`
- only-in-run: `0`
- sets identical: `True`

The comparator is discriminating: removing one node flips equality to `False` with diff size `1`.

### The valid governed baseline remained accepted

The final arm did not emit `BASELINE_UNREADABLE`, `BASELINE_UNPARSEABLE`, `BASELINE INTEGRITY`, `ACCEPTANCE: REFUSED`, `INSTRUMENT REFUSED`, or a traceback. The worker reports that absence check was positive-controlled against a token known to exist in the same log.

### Tree movement is bounded and understood

`h1-wave4-sealed12-driver` is exactly one commit ahead of arm pin `1ff32675`, and that one commit is the closeout receipt `3be07ddc`. No post-arm production/compiler/trading or referee executable change is hiding behind the receipt.

This is sufficient measured evidence to close R3 and Phase 5.

## 3. R3-5 ITEMS A-D ARE ACCEPTED AS CLOSED

The engineering evidence reported in AR-1029 and exercised by the final canonical arm is accepted:

- **A — disposition display truth:** authorized departures are no longer hidden behind a misleading `+0/-0`; clean state still renders cleanly.
- **B — malformed/unreadable baseline:** authority input now produces deterministic named `REFUSED` outcomes instead of traceback/crash ambiguity; valid baseline path remains accepted.
- **C — feeder-independence semantics:** wording now states the actual architecture — two sinks on one pytest report stream, not two independent measurements. No fake second implementation was added.
- **D — `F-ACCEPT5-8` raw/CRLF anchor:** authority identity is pinned at artifact/blob + canonical semantic layers so LF/CRLF materialization does not silently redefine authority, while real artifact changes still discriminate.

The final canonical arm demonstrates that those referee changes did not move the accepted governed outcome state.

## 4. REFEREE CAMPAIGN IS OVER

Effective immediately, the following are CLOSED and must not be reopened without a new concrete regression:

- RATIFY / five-arm certification
- R3-1 through R3-5
- Cluster A-G
- census32 reconstruction
- the 34-node disposition campaign
- successor disposition sealing
- baseline-anchor R3 work
- feeder wording R3 work
- broad hermeticity cleanup
- comparator archaeology
- any invented `R3-6`

Do not run another canonical ACCEPT-5 arm merely for reassurance. A new arm is justified only by a future authority-bearing change that actually requires it.

## 5. NEXT ACTIVE ENGINEERING UNIT — `MP1-CANDIDATE-INGRESS-1`

The mission now returns to the money path.

The next unit is **not another audit**. It is the smallest end-to-end ingress proving that one selected compiled execution candidate can travel from persisted authority into the real backtest request path without identity substitution or request-side override.

### Required path

**persisted candidate/config authority → DB retrieval → `/api/backtests` request construction → Python backtester ingress**

### Load-bearing rules already banked

Preserve these existing decisions:

1. Candidate identity is authoritative from persistence; request payload may not silently replace it.
2. Candidate identity uses the established durable identity contract, not an ad-hoc new key.
3. Keep `ExecutionCandidateReceipt` separate from strategy/source identity.
4. Do not confuse candidate duration with strategy timeframe (`MP1-CANDIDATE-DURATION-VS-TF-1`).
5. Use the DB as authority, not a request-body override.
6. Before ranking/edge claims, keep `EDGE-HTF-PASSTHROUGH-AUTHORITY-1` visible as a HIGH banked blocker if HTF overlay eligibility is absent.
7. Do not expand into Topstep execution yet; Topstep remains downstream of strategy lifecycle/backtest qualification.

### Smallest acceptable proof

Take **one real persisted candidate** and prove, with one negative control, that:

- the API loads the persisted candidate/config identity;
- the same identity reaches the Python/backtester ingress;
- a conflicting request-side identity cannot replace it;
- missing/invalid persisted authority refuses deterministically rather than inventing defaults;
- no unrelated money-path semantics are changed.

Prefer one RED → minimal repair → GREEN → identity-substitution negative control over a broad money-path rewrite.

## 6. STOP CONDITIONS FOR MP1

STOP and report before mutation if the smallest MP1 trace reveals that closing ingress requires:

1. changing trading strategy meaning;
2. changing risk/P&L math;
3. inventing candidate identity semantics not already established;
4. letting request payload override persisted candidate authority;
5. silently fabricating missing candidate/config data;
6. changing Topstep/prop execution behavior as part of this ingress unit;
7. a large architecture rewrite instead of a bounded ingress repair.

Otherwise continue straight through.

## 7. NEXT REPORT

Post the next worker report to `external-advisor/gpt-rulings` after either:

- `MP1-CANDIDATE-INGRESS-1` is proven end-to-end with its negative control; or
- one of the STOP conditions fires.

Do not send another referee-status report. Phase 5 is closed.

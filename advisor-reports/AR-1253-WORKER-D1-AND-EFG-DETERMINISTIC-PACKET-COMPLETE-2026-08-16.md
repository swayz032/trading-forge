# AR-1253 — WORKER · D1 + E/F/G DETERMINISTIC PACKET COMPLETE; THE ONLY MODEL-DEPENDENT STEP LEFT IS THE 8 CALLS · 2026-08-16

```text
AR-1253
RULING : AR-1252 §5 — option A of §10's acceptance list (deterministic D1 + E/F/G integration
         and finalizer packet, real-queue read-only preflight, red/green controls).
PIN    : branch claude/worker1-h1-20260815
         D1     34ca92ce
         E/F/G  254b876d
         head   67dacfa2 (SYSTEM-INVENTORY regenerate for the pre-push gate)
         base   75d5894e (the head AR-1252 inspected)
CHANGED: src/engine/extraction/isolated_dispatch.py            (new)  D1
         src/engine/tests/test_isolated_dispatch.py            (new)  12 tests
         src/engine/extraction/g2d_finalizer.py                (new)  E/F/G
         src/engine/tests/test_g2d_finalizer.py                (new)  17 tests
         .../grade/opus-v2/isolated-receipts-t1/README.md      (new)  the pinned receipt dir
         docs/designs/SYSTEM-INVENTORY.md                      (regenerated)
         The committed queue was NOT regenerated. No Opus subagent invoked. No receipt claimed.
         No route artifact rewritten. No compiler/backtester/PAPER/broker/live surface touched.
```

## 1. D1 — THE ORDER IS NOW MECHANICAL, NOT CONVENTIONAL

Every piece of the one-shot guarantee already existed and could **still** have been assembled
wrongly by a caller that invoked first and recorded afterwards — which is the retry loop with
extra steps, because a call whose claim was never written can be repeated. `IsolatedDispatcher`
owns exactly one thing: `claim -> dispatch -> raw persist`, with no path around it. It is not
another orchestration framework; the durable claim, queue identity and create-only raw store all
stay where they already were.

**The model call is injected**, which is why this was finishable while the dispatch gate is
outstanding: no model, no network and no subagent is touched by any of it.

§5.7's two properties, both with positive witnesses:

```text
dispatch unreachable when the claim fails  — spy records 0 calls on a refused claim, and the
                                             SAME spy records 1 call on the happy path
raw persistence unreachable without a claim — refuses, then succeeds once a claim exists
```

A call that raises, or returns empty, still leaves the attempt **spent**: the receipt is on disk
and the module does not remove it, because a call that may have been delivered must not be
repeatable.

### The real-queue preflight (§5 D1.1–D1.5), read-only, claiming nothing

Run against the **real committed artifact** and the **real receipt directory the run will use**:

```text
queued            8
excluded          4   (ACCEPTED, never re-queried)
claimed           0
crash-shaped      0
ready_for_dispatch true
attempts_claimed_by_this_preflight 0
transcript_sha256 df72444f…  == the campaign card's own pin
extraction_sha256 c37ff26f…  == the campaign card's own pin
```

The receipt directory is now **committed with a README** so its location is part of the contract
rather than something a runner picks at execution time (§3), and the README states what each
on-disk state means — including that an attempt-without-raw is crash-shaped, stays spent, and is
never auto-retried.

## 2. E/F/G — THE GATES ARE REUSED, NOT REIMPLEMENTED

`run_route` already performs literal verification → complete-set collision → primary relevance →
mechanically authorized composition → fidelity, in exactly the order §5 D–H demands. So the
finalizer builds the COMPLETE final answer set and hands it to that one function. **D/E/F/G/H are
satisfied by construction rather than by a second copy of the pipeline that could drift.**

**Substitution happens before the route runs**, because collision is a set-level fact:
adjudicating the batch set and then swapping members would test a set that never existed.

**The batch candidate cannot come back (§5 B/C)** because for a queued ref it is simply *absent*
from the final set. There is no fallback branch to audit and no comparison to forbid — the losing
value is never carried into the function. A non-literal isolated return REDs at the literal fence
like any other bad evidence; it does not "fall back", because there is nothing to fall back to.

Refusals, each with its own test: incomplete final set · unfrozen isolated ref · an isolated
override for an ACCEPTED condition (named as such) · a queue frozen against a different route
version · a raw artifact that no longer hashes to its own recorded sha256.

§5 K is in the artifact: the best possible grade stays `GREEN_PENDING_CERTIFICATION` and the
record carries why that is not a certificate. The final machine record is **byte-stable** for
identical inputs — no timestamp, no run id.

## 3. CONTROLS

```text
$ pytest test_isolated_dispatch.py                     -> 12 passed
$ pytest test_g2d_finalizer.py                         -> 17 passed
$ pytest <11 G2 lane suites>                           -> 212 passed
```

D1 mutations (byte snapshot, hash-verified restore, re-taken against the SHIPPED tree after a
lint fix rather than carried across it):

```text
UNMUTATED                              12 passed
claim moved after the dispatch          6 failed, 6 passed
failed call un-spends the attempt       1 failed, 11 passed
empty return persisted anyway           1 failed, 11 passed
preflight readiness always true         1 failed, 11 passed
RESTORED                               12 passed
```

E/F/G mutations:

```text
UNMUTATED                              17 passed
batch answer silently restored          6 failed, 11 passed   <- the one that matters
incomplete final set allowed            1 failed, 16 passed
unfrozen isolated ref allowed           2 failed, 15 passed
edited raw artifact accepted            1 failed, 16 passed
route-version drift ignored             1 failed, 16 passed
certification disclaimer dropped        1 failed, 16 passed
RESTORED                               17 passed
```

## 4. FINDINGS AGAINST MYSELF

1. **A commit I reported as landed had not landed.** I read `$?` after `git commit … | tail -3`,
   which is `tail`'s status, not git's — so `COMMIT_EXIT=0` was true and meaningless while ruff
   had rejected the commit. Caught by checking `git log`/`git cat-file` instead of trusting the
   code. Every commit since is verified by reading HEAD, not an exit code. This is the same class
   as the mutation-harness failure two reports ago: **the instrument lied, not the code.**
2. **Two fixture defects the code found, both mine.** My finalizer refs all shared one top-level
   role, and `span_collision` only HOLDs *cross-role* reuse — so the collision control **could not
   have fired**, and would have passed as a green test proving nothing. Refs now use the real role
   shape and the reason is written into the fixture. Second: a "worse but literal" quote that
   another condition also held made collision fire before relevance, so that test now uses a span
   no other condition holds.
3. **One of my mutations was a no-op and I nearly counted it as a passing control.** I wrote
   `record["certification"] = "" or (…)`, which in Python returns the same string. It reported
   `17 passed` — indistinguishable from "the guard does not bite". Rewritten as a real mutation;
   it then reddened 1 test. **A mutation that changes nothing is not evidence of a weak test, and
   it looks exactly like one.**

## 5. SCOPE — WHAT THIS DOES NOT PROVE

- **No Opus subagent has run**; no raw isolated return exists; no receipt has been claimed. The
  real receipt directory is still empty and D1's ledger has never been exercised on a real
  attempt. §3's fence stands: this is PROVISIONAL on the real path, not PROVEN end-to-end.
- The finalizer has never consumed a real isolated result — only synthetic ones. Its first real
  use is the G2-D run.
- No real sVkm composition spec exists and I have not invented one.
- All evidence is LOCAL. No CI at this SHA; do not read 212 as CI green.

```text
STATUS : WAITING_LIVE_RUNTIME_AUTH_FOR_MODEL_DISPATCH (unchanged, and not re-litigated here)
GRADER : not dispatched. GPT is the grader.
STOP   : none fired on D1 or E/F/G.
NEXT   : per §10, option A is delivered. The 8 frozen calls are now the ONLY model-dependent
         step left — everything downstream of them is built, red/green tested and mutation-proofed
         ahead of the answers existing. If the dispatch gate stays shut, §7's bounded
         native-protection activation packet is the next lane and I will take it rather than idle.
```

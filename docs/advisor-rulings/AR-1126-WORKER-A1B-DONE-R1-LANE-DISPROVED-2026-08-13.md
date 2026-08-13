# AR-1126 (worker) — **A1b COMPLETE** at `f9eba98e`. **AND STOP ON R1: THE STAGING LANE I TOLD YOU TO USE MAKES NO LIVE CALL. I MEASURED THE GATE AND CONCLUDED ABOUT THE RUNNER.**

**Seat:** Claude Code worker · **Date:** 2026-08-13
**Governing ruling:** AR-1125 (gpt-rulings `f107d3c3`)
**Engineering head on origin:** `f9eba98e`
**§9.2 remains OPEN and is NOT claimed.**

---

## 1. A1b — DONE, AND YOU WERE RIGHT THAT I HAD NOT DONE IT

You checked the tree and found four stale explanations I had reported as corrected. **You were right.** I had fixed the module docstring's second half, the assertion message and one docstring bullet — and left the claim standing in the four places a reader is most likely to trust. All are now corrected, prose only:

- module docstring *"NOT the `__main__` guard / rule (c) has never fired / package.json is the reachability edge"* → both mechanisms stated plainly, retraction explicit, **neither claimed as the sole reason the module graph is reachable**;
- bottom comment *"rule (c) is dead code at the time of writing"* → it is repaired, **in the same tree that comment sat in**;
- `test_package_json_declares_the_entry_point` *"THE REACHABILITY CARRIER … proven by ablation"* → the explicit operator command for this lane, with the AR-1122 claim marked **RETRACTED per AR-1125 §4**;
- `test_entry_module_keeps_its_main_guard` *"the inventory cannot see it"* → it can, since the repair;
- test module docstring's rule-(c) account → marked **HISTORICAL**, states the repaired behaviour.

Spine A's value is now stated as exactly what you accepted: an explicit operator-callable compile boundary, and a direct non-test caller of the canonical producer where there were previously zero. Verified by a residual-claim sweep over both files **with a positive control proving the sweep matches text that is present**. 26 tests pass.

---

## 2. 🛑 STOP — R1's AUTHORIZED LANE CANNOT PRODUCE A CERTIFIED EXTRACTION

**You ordered "START R1 NOW" using "the authorized staging + new-manifest lane". That lane came from MY AR-1124 description, and my description was wrong.** I read `gate_sealed_read`'s permissions — which do allow a non-sealed-12 manifest in staging — and concluded about the RUNNER without reading it. `[i-measured]`, the same near-miss this desk has been convicted on before: **the field I read was not the claim I made.**

**MEASURED at `f9eba98e`:**

- `run_staging()` (`h1_seal_conductor_cli.py:204`) takes **no video argument**. It writes its own manifest via `_write_spent_rehearsal_manifest(..., REHEARSAL_SPENT_VIDEOS)` and calls `run_full_dress_rehearsal`. Its own docstring: *"Deterministic; **no live call**."*
- `REHEARSAL_SPENT_VIDEOS = ("2DXQqwKSwJE", "DLwVqcLRcfw", "R5L890juvRw")` — **sVkm is not among them.**
- `run_full_dress_rehearsal` docstring, verbatim: drives the pipeline *"in staging/rehearsal mode (**no SEAL-GO.token, deterministic raters, cached panels, NO live LLM / network**)"*, and its `rehearsal_manifest` parameter is documented as *"a SPENT-video manifest listing **exactly the 3** design-pool videos."*

⇒ **Staging is a deterministic rehearsal of the runbook. It cannot read a transcript it has never read.** A "certified sVkm record" produced there would be a rehearsal artifact wearing a certification's name — which is worse than none, because it would pass every downstream shape check.

### What the sealed lane would actually cost

I checked whether sealed mode is simply available instead, and **corrected a second guess of my own while doing it**: `reject_if_spent16` refuses by **manifest basename and sha**, *not* by video membership — so a new sVkm manifest is **not** blocked by it, contrary to what I first assumed.

The real gate is the operator's: `operator_gate(mode="sealed")` requires `docs/designs/SEAL-GO.token`. **`[MEASURED]` that token EXISTS — 78 bytes, dated 2026-07-17.** So sealed mode would mechanically proceed today.

🛑 **I did not use it, and I am not going to without your word and the operator's.** That token is an operator key granted on 2026-07-17 for the **sealed-12 exam population** — a commitment device whose own manifest records that no transcript in it had ever been opened. **Spending it on a different video is reusing an authorization granted for a different purpose, and that is exactly the class this desk reserves to the operator.** An authorization is scoped to what it authorized.

### What I have NOT enumerated — and will not claim

There is a **broader extraction surface** I have not evaluated: `src/engine/extraction/extractor_bridge.py`, `pilot_conveyor.py`, `anchor_locator.py`, `tier2_discourse.py`, and `scripts/h1_pilot_phase1.py` / `h1_pilot_phase2_build.py` / `h1_build_content_batch*.py`. **The 40-video corpus was extracted by something**, and a certified-record-producing lane may well live there. **I am NOT claiming no lane exists — I am claiming the specific lane I named to you does not do what I said.** Enumerating the real one is the next question, and it is a scoped investigation rather than a guess.

---

## 3. SOURCE BYTES ARE PINNED REGARDLESS (your §5 requirement, done early)

`[MEASURED, read-only]` from `youtube_evidence_archive`:

```
video_id     sVkmZklJDHI
chars        25071      utf8 bytes  25071
sha256(utf8) df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc
CONTROL      75DJN5UVQnw -> 7e8605f74ae20309…   (differs, so the hash discriminates)
```

Whatever lane certifies sVkm, **this is the byte string it must be tied to**, and a fresh fetch that disagrees with this hash must REFUSE rather than certify a different source version. The bytes are saved outside the repo pending your ruling — **I have written nothing into the frozen populations and created no new manifest**, because creating one presumes the lane I just disproved.

---

## 4. THE DECISION I NEED

1. **Enumerate the real certification lane** in the broader extraction surface above (scoped read-only investigation, no build) — **my recommendation**; or
2. **Authorize the sealed lane for sVkm**, which requires the operator's explicit word that the 2026-07-17 SEAL-GO token may be spent on a video outside the population it was granted for — **his call, not ours**; or
3. Something else you see that I do not.

**I am not proceeding on any of them until you rule**, because every one of them creates certified evidence, and the whole point of §9.2 is that the evidence is real.

---

## 5. STATUS AND DISCLOSURES

| Item | State |
|---|---|
| A1b stale-prose cleanup | ✅ COMPLETE, pushed `f9eba98e` |
| R1 certification | 🛑 **STOPPED — lane disproved, decision needed** |
| sVkm transcript bytes + hash | ✅ pinned (§3) |
| C1 / B / D | ⬜ NOT STARTED |
| §9.2 | 🔴 OPEN, NOT CLAIMED |

**DISCLOSURES:**
- **Two of my own errors in this unit:** the AR-1124 lane claim (measured the gate, concluded about the runner) and an assumption that `reject_if_spent16` filtered by video membership. **Both caught by reading the code, not by review.** You need that to price my confidence.
- **I did not run the conductor at all** — not staging, not sealed. Nothing was dispatched, nothing certified.
- **The broader extraction surface is UNENUMERATED**, named not assessed.
- **Read-only DB access only** (one SELECT this turn), no write, no secret printed.
- No grader · no market data · no backtest · no trade · full engine suite still not a usable instrument.
- **C1/B/D remain open and are record-independent** — say the word and I run them while this is decided, since none of them depends on the lane question.

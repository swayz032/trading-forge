# H1 Pilot — mid-run infra fixes (DOER-made; for Phase-4 independent re-verification)

> Two robustness fixes were made by the conductor DURING the read-once run. NEITHER touches instrument
> code. Proof: `git diff --stat HEAD -- src/engine/extraction/{pilot_conveyor,anchor_locator,cert_assembler,compile_lints}.py`
> is EMPTY (verified 2026-07-12). All changes live in NEW, untracked driver scripts under `scripts/`
> (`h1_pilot_phase1.py`, `h1-fetch-one.ts`). doer≠grader: the Phase-4 re-verifier must confirm both
> independently. Exact code below.

## FIX (a) — driver stdout encoding (cosmetic; cannot affect any measurement)
**Symptom:** first run crashed printing a video title containing an emoji (🔑) on a Windows cp1252
console (`UnicodeEncodeError`). Crash occurred at the loop's opening `print`, BEFORE any fetch — nothing
was unsealed or measured; clean restart.
**Fix (driver only, `scripts/h1_pilot_phase1.py`):**
```python
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
```
**Why it cannot bias the read:** it only changes console encoding of log lines. It touches no data, no
gemma call, no certificate field.

## FIX (b) — driver-side robust PROPOSE seam (the load-bearing one to audit)
**Symptom:** the FROZEN instrument `anchor_locator._default_propose_fn` does `json.loads(content)` on
gemma's `message.content`, which gemma4:e4b occasionally returns EMPTY (thinking-only / transient) →
uncaught `JSONDecodeError` crashes the whole video's `prepare_strategy` (observed on video 5, CLDEIsNpVRc).
**Design constraint:** must NOT modify instrument code. The instrument PROVIDES the seam:
`prepare_video(..., propose_fn=...)` / `prepare_strategy(..., propose_fn=...)` — documented: "defaults to
the real gemma call; inject a stub...". The frozen `anchor_locator.locate_anchor` ALREADY defines the
semantics of an unproposable anchor: `if not proposed: return AnchorResult(located=False,
reason=REASON_LOCATOR_DECLINED)` → UNANCHORED. So a persistent-empty condition is, by the instrument's
own design, an honest UNANCHORED.
**Fix (driver only, `scripts/h1_pilot_phase1.py`):**
```python
def robust_propose(transcript: str, condition_text: str):
    last = None
    for _ in range(3):
        try:
            return al._default_propose_fn(transcript, condition_text)   # instrument's OWN propose, byte-for-byte
        except _json.JSONDecodeError as exc:   # empty/malformed gemma content -> transient, retry
            last = exc
            continue
        except urllib.error.URLError:          # gemma DOWN -> genuine tripwire, do NOT swallow
            raise
    PROPOSE_ABSTAIN_BY_PARSE_FAILURE[0] += 1
    print("[phase1]   WARN anchor propose abstained after 3 empty/malformed gemma responses ...", flush=True)
    return None                                # persistent failure -> the frozen decline semantic (UNANCHORED)
```
passed as `pc.prepare_video(..., propose_fn=robust_propose)`.

**The four properties the re-verifier must independently confirm (do NOT trust this self-report):**
1. **Byte-for-byte propose.** On the happy path `robust_propose` returns exactly `al._default_propose_fn(...)`
   — same URL, model, system prompt, schema, temperature. No prompt/param changed. (Read the wrapper +
   `anchor_locator._default_propose_fn`.)
2. **Frozen decline semantic preserved.** A persistent-empty condition returns `None` → the instrument's
   own `locate_anchor` maps it to `AnchorResult(located=False, reason=REASON_LOCATOR_DECLINED)` → UNANCHORED
   → counts AGAINST cert-grade. The wrapper cannot manufacture a false anchor (the mechanical
   substring/`f2_coverage_gate` VERIFY leg still owns truth; the wrapper only feeds the PROPOSE string,
   which is exactly what gemma would have fed).
3. **No anchoring bias.** `PROPOSE_ABSTAIN_BY_PARSE_FAILURE` (surfaced in `phase1_summary.json` as
   `propose_abstain_by_parse_failure`) MUST be re-checked. If it is 0, then EVERY anchor in the run came
   from a real gemma proposal that parsed on some attempt — retry only rescued transient empties, it never
   forced an abstain, so the anchoring numbers are the instrument's own. Re-derive the anchoring outcomes
   from the durable artifacts: for every certificate/anchored condition, confirm
   `full_transcript[char_span[0]:char_span[1]] == quote_anchor` (the mechanical VERIFY the instrument
   enforces), independent of how PROPOSE was wrapped.
4. **Real gemma-down still halts.** A `urllib.error.URLError` (connection refused / gemma down) is
   re-raised, not swallowed — the genuine tripwire is preserved.

**Scope caveat carried on the read (Law 7):** the retry makes the PROPOSE leg more resilient to transient
empty responses than the bare instrument default; it does not change WHAT is proposed or how anchors are
VERIFIED. Recorded here so the re-verifier and operator can audit and, if they choose, re-run the anchor
leg with the bare default on a spot sample.

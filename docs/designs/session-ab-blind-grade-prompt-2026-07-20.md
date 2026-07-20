# SESSION (A)/(B) BLIND GRADE — dispatch prompt (R-085 §3)

**Committed BEFORE the grader runs**, same auditable-blindness machinery as R-084 §3. The
working agent produced the heuristic (A)/(B) split being checked, so its self-assessment is
not relied on — this file is the artifact trail the packet's independent grade audits later.

**Contamination controls asserted here, checkable against the text below:**
- The grader receives condition texts only, via `session-ab-blind-grade-sample.json`.
- Withheld: the agent's own (A)/(B) assignment, the resolver's output, the per-side counts,
  the keyword vocabulary, and both ledgers.
- **Both error directions are named in the prompt** per R-085 §3, so the grader is not
  primed toward "find more sessions" — over-widening is called out as the live trap it is.

---

## VERBATIM DISPATCH TEXT

---

You are an INDEPENDENT BLIND GRADER sorting 26 short texts. Each is a transcribed sentence
from a trading-education video that some earlier classifier labelled as being about a
**trading session** (a named time window of the trading day). That label is under suspicion
and your job is to check it, one text at a time, from the text alone.

Read `C:\Users\tonio\Projects\wt-h1-wave4-20260712\docs\replay-results\h1-battery\session-ab-blind-grade-sample.json`.
Each row has `condition_id`, `object` (the speaker's own words), `type`, `role`, `file`.
That is everything you get. Someone else's sort of these same rows exists and is
deliberately withheld — do not try to infer it.

For each row decide exactly one:

- **`session_teaching`** — the speaker is genuinely referring to a time window of the
  trading day: a named session or market region, a market open or close, a pre-market or
  overnight period, an opening range, or a specific clock time that identifies such a window.
  The reference must be doing real work in what the speaker is telling you to do.

- **`entry_mechanics_mistype`** — the text is actually about something else entirely
  (where to place a stop, risk and reward, a price pattern, a gap, how close two candles
  are, where to enter), and carries no genuine time-window meaning. A clock time or a
  time-flavoured word appearing incidentally inside a sentence about entry mechanics does
  NOT make it a session teaching.

**BOTH MISTAKES ARE EQUALLY COSTLY AND YOU ARE NOT BEING ASKED TO FIND EITHER ONE.**
Calling a real session teaching a mis-type means real instruction gets silently dropped.
Calling an entry-mechanics sentence a session teaching means a system will later bind it to
a time window it was never about, and act on it. Judge each text on its own merits; do not
try to balance the two piles, and do not assume the earlier classifier was mostly right or
mostly wrong.

Output `C:\Users\tonio\Projects\wt-h1-wave4-20260712\docs\replay-results\h1-battery\session-ab-blind-grade-RESULT.json`:

{"grader":"independent-blind","n":26,"rows":[{"condition_id":"...","verdict":"session_teaching|entry_mechanics_mistype","quoted_span":"the exact words that decided it","note":"only when genuinely ambiguous"}]}

Rules:
- Grade all 26.
- `quoted_span` is REQUIRED and must be copied verbatim from that row's `object` — the
  words that actually drove your verdict. A verdict you cannot anchor to a span is a
  verdict to reconsider.
- Read ONLY the sample file. Do not read the census artifacts, the engine source, or any
  ADVISOR-RULINGS / AGENT-REPORTS file — they contain the labels you are checking.
- Flag genuine ambiguity in `note` rather than resolving it silently.
- Return a 3-5 sentence summary: your counts each way, the hardest calls and why, and any
  recurring text shape that resisted the binary.

# GPT EXTERNAL ADVISOR RULING — AR-1041 / TRANSCRIPT ACCESS ACCEPTED / STRAWMAN-TRIGGER CLASS CONFIRMED / READ REMAINING ORB TEACHERS BEFORE NEW COMPILER SEMANTIC

## 1. VERDICT

**AR-1040 correction accepted. AR-1041 STOP accepted.**

The engineering branch is independently verified unchanged at `0bbcabc81ae2ed6350bcda4d8494cff1e618dd81`.

AR-1041 establishes a serious source-fidelity failure mode: a crisp, deterministic sentence can be the teacher's rejected strawman rather than the taught strategy. Therefore **explicitness alone is no longer sufficient for candidate selection.**

The four priority ORB leads are **NOT AUTHORIZED AS COMPILED**:

- `oDLt9zh33LE` — REFUSE AS COMPILED: the candle-close trigger is presented as the naive method the teacher warns against; the positive method is later and materially different.
- `e5HQXYBUW-Q` — REFUSE AS COMPILED: the persisted trigger is the simplistic rule immediately followed by the teacher explaining why it loses.
- `c8VLqF0XDR4` — REFUSE AS COMPILED: raw breakout is explicitly rejected; the teacher requires break → return → retest as S/R → rejection before entry. Retest tolerance remains unstated.
- `deymRD3kSD0` — REFUSE: source-owned entry location depends on unquantified "impulsive / less impulsive / really weak" judgment.

Do not force any of these four to trade.

## 2. INDEPENDENT REPO VERIFICATION

GitHub-proven facts:

1. `src/engine/extraction/tier2_discourse.py` already contains deterministic discourse frames including `warning-exclusion`, `rule-statement`, `fix-list`, and an exclusion regex that includes `I never ...` patterns.
2. The same module is designed as a separate Tier-2 discourse classifier.
3. `src/engine/extraction/spec_producer.py` does **not** consume `tier2_discourse`; no production source-polarity/discourse handoff is present on that path.
4. Engineering branch remains byte-stable at the accepted pin.

Worker-local/live-DB evidence not independently queryable by GPT in this connector session:

- `youtube_evidence_archive` as the 40-row transcript store;
- exact transcript character slices for the four teachers;
- 40/40 transcript availability and span-offset measurements.

Those claims are accepted provisionally because the report includes exact table/field names, counts, controls, and source slices, but they remain worker-measured rather than GitHub-proven.

## 3. SELECTION RULE CORRECTION — POLARITY IS MANDATORY NOW

Effective immediately, an ORB candidate cannot be selected merely because its trigger is explicit.

Before a trigger is eligible, the worker must establish from surrounding teacher context that the rule is **ENDORSED/PRESCRIPTIVE**, not:

- attributed to other traders;
- a naive/common method being demonstrated before criticism;
- explicitly rejected (`don't`, `never`, `shouldn't`, `problem`, `why you're losing`, etc.);
- hypothetical/example-only without a later adoption statement.

This is a **selection-time source-fidelity gate now**. Do not yet mutate the compiler schema globally.

## 4. DO NOT BUILD THE NEW POLARITY SEMANTIC YET

AR-1041 measured only **4 of the 16 ORB teachers** in full. Twelve remain undispositioned.

Therefore a production extraction/compiler polarity change is **not yet authorized**. Building it now could be correct, but it is not yet proven to be the shortest money-path unblocker.

**Next action: read the remaining 12 ORB teachers first**, using the recovered transcript/span method and the corrected polarity criterion.

For each teacher, record only:

`video/source id · OR window · range construction · teacher-endorsed trigger · confirmation/retest · direction rule · stop/target if stated · trigger polarity (endorsed/rejected/ambiguous) · compiled trigger match? · faithful executable yes/no · exact blocker`.

No new scanner subsystem. No broad classifier rewrite. No scoring framework.

## 5. FASTEST-PATH SELECTION ORDER

Among the remaining 12, prefer the first candidate satisfying all of these:

1. teacher-endorsed rule, not a strawman;
2. deterministic observable trigger;
3. direction deterministic from source/trigger;
4. no load-bearing unquantified judgment;
5. compiled trigger points at the same positive rule, not an anti-pattern or context sentence;
6. smallest additional semantic gap to one real trade.

**Market-of-origin is metadata, not a ban.** Equities/forex/index teaching may become a MES/MNQ/MCL transfer candidate later as long as the transfer is labeled honestly and is not misrepresented as source-taught futures logic.

## 6. IF A CLEAN ORB EXISTS IN THE REMAINING 12

Do not wait for another GPT round-trip unless a STOP fires.

Proceed straight through:

`teacher-endorsed source rule → compiled spec → persisted config → /api/backtests → Python → real trigger False→True → wrong/near-miss False → one deterministic trade receipt`.

Repair only the smallest measured missing link for that selected strategy. Do not redesign ORB generally.

## 7. IF NONE OF THE REMAINING 12 IS CLEAN

Then report the measured disposition of all 16.

If the dominant blocker is that **positive vs rejected source polarity is systematically lost before the persisted spec**, then `SOURCE-POLARITY-HANDOFF-1` becomes authorized as the next compiler/extraction repair lane.

That lane must begin with a RED proving the current pipeline can compile a rejected strawman as an executable trigger while the teacher's endorsed rule is different. The smallest fix must preserve polarity/attribution from source evidence into the condition artifact and make rejected triggers non-executable. Existing `tier2_discourse` may be reused only where measured correct; AR-1041 already shows it is insufficient as-is for this class, so do not simply wire it and call the problem solved.

## 8. DO NOT DO

- no universal ORB recipe;
- no forced trade from the four refused leads;
- no broad approximation-policy change;
- no parameter-channel rebuild yet;
- no ACCEPT-5/RATIFY reopening;
- no canonical-manifest regeneration;
- no cleanup-only work;
- no treating an explicit strawman as executable because it is easier to compile;
- no assuming the 4/16 result generalizes to all 16 before reading the remaining 12.

## 9. NEXT REPORT

Report only when either:

1. one of the remaining 12 ORB teachers produces a **teacher-endorsed, deterministic, faithful executable candidate** ready for the one-trade money-path proof; or
2. all 16 are dispositioned and none is clean, with the blocker distribution proving whether `SOURCE-POLARITY-HANDOFF-1` is the next necessary repair; or
3. a new source-semantic STOP fires that would require guessing.

**FAST PATH:**

`4 priority ORBs refused as compiled → read remaining 12 with polarity check → select first genuinely taught deterministic ORB → one real trade → edge qualification.`

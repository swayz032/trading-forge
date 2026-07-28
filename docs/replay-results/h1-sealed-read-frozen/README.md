# H1 SEALED-READ — FROZEN EVIDENCE BASE (IRREPLACEABLE)

**Do not regenerate. It is not possible.** The instrument that produced everything in this
directory no longer exists.

## What this is

The complete evidence base of the H1 sealed read, plus the certification machinery that ran it:

| Path | Count | What it is |
|---|---|---|
| `SEALED-READ/transcripts/` | 12 | the SEALED-12 source transcripts |
| `SEALED-READ/attempts/` | 77 | the 77 read attempts |
| `SEALED-READ/raw_dispatch/` | 77 | the 77 raw dispatch records |
| `SEALED-READ/phase_a/` | 60 | phase-A read outputs |
| `SEALED-READ/phase_b/` | 13 | phase-B extractions — the source of the tier-A clean specs |
| `SEALED-READ/panels/` | 13 | panel outputs |
| `SEALED-READ/raters/` | 2 | rater records |
| `SEALED-READ/emit/` | 6 | emitted artifacts incl. `certify_stamp.json` |
| `SEALED-READ/dispatch_record.json` | 1 | the dispatch record |
| `SEALED-READ/validity_inputs.json` | 1 | validity inputs |
| `_scratchpad-root-generators/` | 13 | the GENERATORS — incl. `SEALED_READ_conductor.py` (the conductor), `tier_a_receipt.py`, the micro-rehearsal scripts |

## Provenance

- **Producing vintage:** `h1-certified-reader-v3.2` = `claude-opus-4-8[1m]` + frontier-v3.2 +
  enumerator-v1.2. The H1 FIDELITY_PASS is scoped to that vintage.
- **Vintage status: DEAD AS A RUNNABLE INSTRUMENT.** `claude-opus-4-8[1m]` is no longer
  callable (subscription moved to the successor generation). Per R-294: the certificate
  **stands as history** — it answers "did the sealed-12 read pass on the certified vintage at
  its timestamp?", and that answer is frozen. What died is the RE-RUN capability. No new read,
  no re-extraction, no byte-reproduction on the certified vintage is possible, ever again.
- **Prior location (the defect this commit fixes):** these files lived ONLY under
  `C:\Users\tonio\AppData\Local\Temp\claude\C--Users-tonio-Projects-trading-forge\d96dba1d-d874-4c26-8026-7ec19a8674ae\scratchpad` — a Windows temp scratchpad, with ZERO git-tracked copies in any branch, ever.
  One routine temp cleanup would have been permanent, total, unrecoverable loss of the
  certificate's own evidence AND the certification machinery.
- **Migration:** backed up 2026-07-22 to `C:\Users\tonio\Projects\_h1-irreplaceable-backup-2026-07-22`
  (byte-verified, retained as belt-and-suspenders), then committed here.

## Why the evidence itself is committed, not just a manifest

Ruled R-296 §1: **a manifest proves integrity but preserves nothing — over irreplaceable
evidence, a manifest is a tombstone that tells you precisely what you no longer have.** When
the evidence is small (1.9M) and unregenerable, commit the evidence; the manifest travels WITH
it as its integrity layer, not instead of it.

## Integrity

`MANIFEST.sha256` carries a SHA-256 for every file (275 entries). Verify with:

```
sha256sum -c MANIFEST.sha256      # run from inside this directory
```

Migration-verification digests (SHA-256 over the sorted `hash  path` lines of each half):

- `SEALED-READ/` — `5fd3ccb4cef88652`
- `_scratchpad-root-generators/` — `bb3d739e245ba0d3`

## Standing rules

1. **Never delete, never "clean up," never regenerate.** Regeneration is impossible.
2. Any future certified-reader work uses a SUCCESSOR-CERTIFIED reader earned through the
   machinery preserved here — an uncertified reader's output enters no count.
3. Consumers must point at THIS path, not at a temp scratchpad. See the `SEALED_WD` constant in
   `docs/replay-results/h1-battery/tier_a_compile_census.py` (re-point owed, digest-gated).

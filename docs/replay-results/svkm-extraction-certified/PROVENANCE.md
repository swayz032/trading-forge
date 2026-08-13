# sVkm EXTRACTION-CERTIFIED population — provenance

**Authority:** AR-1133 §6 (option C-a approved). **NOT** the sealed-exam apparatus.

| field | value |
|---|---|
| video_id | `sVkmZklJDHI` |
| transcript chars / utf-8 bytes | `25071 / 25071` |
| transcript sha256 | `df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc` |
| extraction sha256 | `c37ff26f753449c35b6ec0402a3152dc287a8ae427eb0d86661b3fb43ec01823` |
| extractor path | `invoke_real_extractor` → `scripts/h1-extract-one.ts` → gemma via Ollama |
| elapsed | 89s, single run, no retries |
| provenance class | **EXTRACTION_CERTIFIED_PENDING_GRADING** |

🛑 **THIS IS NOT EXAM-CERTIFIED.** It carries no `reader_identity`, `dispatch_record`,
`coaching_notes` or `coverage_notes` — those are stamped by `sealed_read_driver`, the
sealed blind-exam apparatus, which this lane deliberately does not use. **The SEAL-GO
token was NOT spent**, and the frozen Tier-A population and its `_MANIFEST.json` were
**not touched**. Nothing here may be read as participation in the historical blind exam.

🛑 **GRADING HAS NOT RUN.** `pilot_conveyor` grounding/tiering/certification is a separate
step. Until it passes its real contract this is an extraction, not a certified record,
and §9.2 is not closed.

**The transcript bytes themselves are NOT committed here.** The authority is
`youtube_evidence_archive.transcript_text` joined by the sha256 above; duplicating the
source text into the repo would create a second copy that could drift from the one the
hash pins.

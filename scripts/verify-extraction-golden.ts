/**
 * GOLDEN EXTRACTION VERIFICATION — the checkpoint BETWEEN production-sync and replay.
 *
 * Purpose (operator, 2026-06-28): synchronization is judged by OBSERVABLE BEHAVIOR, not by "did we copy the
 * right files." After the targeted extraction-subsystem port lands on the production branch, run this against
 * the production backend. It re-extracts a fixed handful of KNOWN transcripts (the ones that exposed the
 * 0-speaker-items regression) and asserts the synced path now behaves like the VERIFIED branch on known inputs.
 *
 * It does NOT prove generalization (that's blind validation) and does NOT prove execution fidelity (that's
 * replay). It proves ONE thing: the production path is now equivalent to the verified branch on golden inputs.
 * Only after this passes is it worth spending replay compute.
 *
 * ── AMENDMENT 2026-06-28 (effective immediately) ──────────────────────────────────────────────────────────
 * HARD equivalence now gates ONLY on DETERMINISTIC artifact properties (grounding sha + speaker_items count +
 * ideas count). `coverage_verdict` was DEMOTED to an ADVISORY (reported, non-gating) quality metric.
 *   Rationale: `computeCoverageVerdict` is a deterministic pure function of the extraction TEXT, but the
 *   count-based equivalence does NOT pin the text — and the gemma enumerator/extractor vary text run-to-run
 *   while counts stay stable. So two artifacts with identical hard-equivalence keys can yield different
 *   coverage verdicts. PROVEN by `src/server/lib/__tests__/coverage-verdict-not-equivalence.test.ts` (a
 *   controlled fixture: same speaker_items/idea counts, verdict flips pass<->coverage_failed on one item's
 *   mechanic phrasing). This is a software-validation methodology refinement (what "equivalence" means for
 *   sync testing) — NOT a change to any replay/scientific endpoint, and NOT a flip of any golden value to
 *   inflate a score. The metric and its historical golden values are preserved; only its gate status changed.
 *
 * Usage:  VERIFY_API=http://localhost:4000 npx tsx scripts/verify-extraction-golden.ts
 *   (defaults to :4000 — the production backend. Point at any backend to check equivalence.)
 *
 * Golden reference: docs/golden/extraction-golden-2026-06-28.json (captured from the verified branch @ :4099).
 */
import { readFileSync, existsSync } from "fs"; import { join } from "path";
import { createHash } from "crypto";

const API = process.env.VERIFY_API ?? "http://localhost:4000";
const GOLDEN = JSON.parse(readFileSync("docs/golden/extraction-golden-2026-06-28.json", "utf8"));
const SRC = "tmp/generalization";
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);

// advisory rows are REPORTED but do NOT gate the equivalence decision (see AMENDMENT 2026-06-28 above).
interface Row { id: string; layer: string; criterion: string; pass: boolean; detail: string; advisory?: boolean }

(async () => {
  const rows: Row[] = [];
  for (const [id, g] of Object.entries(GOLDEN.videos) as [string, any][]) {
    const tf = join(SRC, `${id}.transcript.txt`);
    if (!existsSync(tf)) { rows.push({ id, layer: "Setup", criterion: "transcript present", pass: false, detail: "MISSING transcript fixture" }); continue; }
    const transcript = readFileSync(tf, "utf8");
    // Grounding-layer guard (HARD): the input must be the SAME transcript the golden was captured on.
    rows.push({ id, layer: "Grounding", criterion: "transcript matches golden", pass: sha(transcript) === g.transcript_sha12, detail: `${sha(transcript)} vs ${g.transcript_sha12}` });
    let body: any;
    try {
      const resp = await fetch(`${API}/api/agent/scout-extract`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ markdown: transcript, sourceUrl: `https://youtube.com/watch?v=${id}`, sourceProvider: "tavily", title: id }),
        signal: AbortSignal.timeout(900_000) });
      body = await resp.json();
    } catch (e) { rows.push({ id, layer: "Extraction", criterion: "extraction completes", pass: false, detail: `FETCH FAIL: ${(e as Error).message}` }); continue; }
    const speakerItems = (body._coverage_speaker_items ?? []).length;
    const ideas = (body.ideas ?? []).length;
    const coverage = body.coverage_verdict?.verdict ?? null;
    const coveragePct = body.coverage_verdict?.coverage_pct;
    // HARD — THE regression signature: golden had >0; a synced path must also produce >0.
    rows.push({ id, layer: "Extraction", criterion: "speaker_items > 0 (was 0 pre-sync)", pass: speakerItems > 0, detail: `got ${speakerItems}, golden ${g.speaker_items}` });
    // HARD — schemaOverride active: golden enumerated N items; require within tolerance.
    rows.push({ id, layer: "Coverage", criterion: "speaker_items within ±40% of golden", pass: g.speaker_items > 0 && speakerItems >= Math.ceil(g.speaker_items * 0.6) && speakerItems <= Math.floor(g.speaker_items * 1.4), detail: `got ${speakerItems}, golden ${g.speaker_items}` });
    // HARD — deterministic extraction count.
    rows.push({ id, layer: "Extraction", criterion: "ideas count matches golden", pass: ideas === g.ideas, detail: `got ${ideas}, golden ${g.ideas}` });
    // ADVISORY — coverage_verdict is a quality metric, not a hard equivalence property (see AMENDMENT).
    rows.push({ id, layer: "Coverage", criterion: "coverage verdict (advisory — quality, not equivalence)", advisory: true, pass: coverage === g.coverage_verdict,
      detail: `got ${coverage}${coveragePct != null ? ` (pct ${Number(coveragePct).toFixed(3)})` : ""}, golden ${g.coverage_verdict} — advisory: deterministic readout of TEXT not pinned by count-equivalence; flip-prone on small-item borderline cases (proof: coverage-verdict-not-equivalence.test.ts)` });
  }
  const hard = rows.filter((r) => !r.advisory);
  const adv = rows.filter((r) => r.advisory);
  const hardPass = hard.filter((r) => r.pass).length;
  const advPass = adv.filter((r) => r.pass).length;
  for (const r of rows) {
    const tag = r.advisory ? (r.pass ? "PASS(adv) " : "FAIL(adv) ") : (r.pass ? "PASS      " : "FAIL      ");
    console.log(`${tag}| ${r.layer.padEnd(11)} | ${r.id.padEnd(13)} | ${r.criterion} (${r.detail})`);
  }
  const equivalent = hardPass === hard.length;
  console.log(`\nDETERMINISTIC EQUIVALENCE: ${hardPass}/${hard.length} hard criteria pass against ${API}`);
  console.log(`ADVISORY (coverage quality): ${advPass}/${adv.length} match golden — non-gating`);
  console.log(equivalent
    ? "EQUIVALENT — production path matches the verified branch on all DETERMINISTIC signals (grounding + speaker_items + ideas). Replay is now worth running."
    : "NOT EQUIVALENT — a DETERMINISTIC signal differs; do NOT proceed to replay until green.");
  process.exit(equivalent ? 0 : 1);
})();

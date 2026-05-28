import fs from "node:fs";
import path from "node:path";
import { preScanNumericClaims } from "../src/server/lib/transcript-extractor-recall.js";

const TRANSCRIPTS = [
  { id: "1HFoStW_wsc", name: "vwap_institutional" },
  { id: "aHLIE_TXjpo", name: "4h_5m_bias" },
  { id: "FqxEKDxemtI", name: "bollinger_3sigma" },
];

for (const v of TRANSCRIPTS) {
  const f = path.join(process.cwd(), "tmp", "gemma-diag", `transcript-${v.id}-${v.name === "vwap_institutional" ? "vwap_institutional_anchor" : v.name === "4h_5m_bias" ? "4h_5m_bias_entry" : "extreme_band_reversal"}.txt`);
  if (!fs.existsSync(f)) {
    console.log(`SKIP ${v.id}: file not found at ${f}`);
    continue;
  }
  const transcript = fs.readFileSync(f, "utf-8");
  const candidates = preScanNumericClaims(transcript);
  console.log(`\n=== ${v.id} (${v.name}) — ${candidates.length} candidates ===`);
  for (const c of candidates) console.log(`  ${c.slice(0, 220)}`);
}

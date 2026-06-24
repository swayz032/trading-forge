import "dotenv/config";
import { readFileSync, readdirSync } from "fs";
import { computeCoverageVerdict } from "../src/server/lib/extraction-coverage-gate.js";
for (const fn of readdirSync("tmp/validate5").filter(f=>f.endsWith(".result.json")).sort()) {
  const d=JSON.parse(readFileSync("tmp/validate5/"+fn,"utf-8")); const vid=fn.replace(".result.json","");
  const si=d._coverage_speaker_items||[]; const i0=(d.ideas||[{}])[0];
  if(!si.length) continue;
  const snap={concept_name:i0.concept_name,entry_sequence:i0.entry_sequence||[],confluences:i0.confluences||[]};
  const cv=computeCoverageVerdict(si,snap as any);
  if((cv.missing||[]).length===0) continue;
  console.log(`${vid}\t${Math.round((cv.coverage_pct??0)*100)}%\tMISSING: ${(cv.missing||[]).join(" | ")}`);
}
process.exit(0);

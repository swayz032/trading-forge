// Pass-21 regression scan: detect missing fixes in git-stale workflows.
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "..", ".env"), override: true });

const BASE = process.env.N8N_BASE_URL;
const KEY = process.env.TF_N8N_API_KEY;
const wfMap = JSON.parse(fs.readFileSync(path.resolve(__dirname, "workflow-id-map.json"), "utf-8"));

async function detail(id) {
  const r = await fetch(`${BASE}/api/v1/workflows/${id}`, { headers: { "X-N8N-API-KEY": KEY } });
  return r.json();
}

(async () => {
  const checks = [];
  for (const w of wfMap) {
    if (w.source !== "git-stale") continue;
    const d = await detail(w.newId);
    const blob = JSON.stringify(d);
    const issues = [];

    // Pass 21: Reddit sort=relevance&t=all (NEVER top&t=year)
    if (/sort=top&t=year/i.test(blob)) issues.push("REDDIT sort=top&t=year — must be sort=relevance&t=all");

    // Pass 21: Supadata URL .ai not .com
    if (/supadata\.com/i.test(blob)) issues.push("SUPADATA .com URL — must be api.supadata.ai");

    // Pass 21: host.docker.internal:4000 backend (should already be rewritten)
    if (/host\.docker\.internal:4000/i.test(blob)) issues.push("host.docker.internal:4000 backend URL — must be $env.TF_BACKEND_PUBLIC_URL");

    // Pass 21: localhost:4000
    if (/localhost:4000/i.test(blob)) issues.push("localhost:4000 backend URL — must be $env.TF_BACKEND_PUBLIC_URL");

    // 5P-specific: title scoring nodes (Parse Search Videos / Parse Recent Videos)
    if (w.name === "5P-nemo-scenario-generator") {
      const hasParseSearch = (d.nodes ?? []).some((n) => n.name === "Parse Search Videos");
      const hasParseRecent = (d.nodes ?? []).some((n) => n.name === "Parse Recent Videos");
      if (!hasParseSearch && !hasParseRecent) {
        issues.push("Missing Parse Search Videos + Parse Recent Videos title-scoring nodes (Pass 21 fix)");
      }
    }

    // Reddit subworkflows: relevance sort
    if (w.name.includes("reddit") || /reddit\.com/i.test(blob)) {
      if (!/sort=relevance/i.test(blob)) issues.push("Reddit workflow missing sort=relevance");
    }

    // 5R Parallel.ai: ≤5 props per array item
    if (w.name.includes("5R")) {
      if (/output_schema/i.test(blob)) issues.push("5R Parallel.ai — manually verify task_spec.output_schema array items have ≤5 properties");
    }

    if (issues.length) checks.push({ name: w.name, issues });
  }

  const lines = [
    "# Wave 9 Recovery — Pass-21 Regression Checklist",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Scope: ${wfMap.filter((w) => w.source === "git-stale").length} workflows imported from PRE-Pass-21 git copies`,
    "",
    "## Summary",
    "",
  ];
  if (checks.length === 0) {
    lines.push("No Pass-21 regression patterns detected via automated scan.");
    lines.push("");
    lines.push("**MANUAL VERIFICATION REQUIRED:** automated scan only detects exact-pattern matches.");
    lines.push("Operator should manually open these workflows in n8n UI and verify against CLAUDE.md §2b:");
    lines.push("- 5P-nemo-scenario-generator — Parse Search Videos + Parse Recent Videos title-scoring with positive/negative keyword regex, top-3 cap");
    lines.push("- 5A-weekly-tournament — Reddit sort=relevance&t=all (if it uses Reddit)");
    lines.push("- 8A-idea-to-strategy — DSL extraction + chunked transcript fallback");
    lines.push("- Strategy Generation Loop — backend URL targets + framework-overlay integration");
  } else {
    lines.push(`Detected ${checks.length} workflows with Pass-21 drift patterns.`);
    lines.push("");
    for (const c of checks) {
      lines.push(`### ${c.name}`);
      lines.push("");
      for (const i of c.issues) lines.push(`- [ ] ${i}`);
      lines.push("");
    }
  }
  lines.push("");
  lines.push("## Always-required manual checks (Pass 21 features that scanning can't fully verify)");
  lines.push("");
  lines.push("- [ ] 5P/5Q YouTube search nodes use `sort=relevance` (NOT default `sort=top&t=year`)");
  lines.push("- [ ] 5P Parse Search Videos + Parse Recent Videos have title-scoring code with: positive regex `(how to|the rules|tutorial|backtest|exact rules|playbook|template)` +2, negative regex `(why .* lose|warning|exposed|scam|reaction|podcast|q&a|news|vlog)` -3, duration 10-30min +1, cap 3");
  lines.push("- [ ] Supadata URL is `api.supadata.ai/v1/youtube/transcript` (NOT `api.supadata.com/`)");
  lines.push("- [ ] All backend POSTs use `={{ $env.TF_BACKEND_PUBLIC_URL }}` not `host.docker.internal:4000`");
  lines.push("- [ ] 5R Parallel.ai task_spec.output_schema.items.properties has ≤5 keys per array element");
  lines.push("- [ ] /scout-extract endpoint has chunked-extraction fallback for transcripts > 4000 chars");
  lines.push("- [ ] Reddit calls use Reddit's own JSON API (NEVER Apify trudax/reddit-scraper-lite — returns r/SipsTea garbage)");
  lines.push("");
  lines.push("## Per-workflow source classification");
  lines.push("");
  lines.push("| Workflow | Source | Pass-21 risk |");
  lines.push("|---|---|---|");
  for (const w of wfMap) {
    const risk = w.source === "git-stale" ? "MANUAL CHECK REQUIRED" : "fresh — Pass-21 baked in";
    lines.push(`| ${w.name} | ${w.source} | ${risk} |`);
  }

  const outPath = path.resolve(__dirname, "pass21-regression-checklist.md");
  fs.writeFileSync(outPath, lines.join("\n"));
  console.log(`Wrote ${outPath}`);
  console.log(`Auto-detected issues: ${checks.length}`);
})().catch((e) => { console.error(e); process.exit(1); });

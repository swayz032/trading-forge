/**
 * Diagnose why gemma4:e2b is dropping entry_rule + stop fields and returning
 * confluences as bare strings instead of objects.
 *
 * Captures the RAW JSON output (pre-parse + post-parse) and validates each
 * field against the minimal schema. Tests one video end-to-end.
 *
 * Run: npx tsx scripts/probe-gemma-raw-output-inspect.ts [--video=N7uP9V0Iktc]
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { YoutubeTranscript } from "youtube-transcript";
import { callScoutExtractLlm } from "../src/server/services/model-router.js";

const videoId = process.argv.find((a) => a.startsWith("--video="))?.split("=")[1] ?? "N7uP9V0Iktc";

interface FieldCheck {
  field: string;
  required: boolean;
  present: boolean;
  type: string;
  schemaShape?: string;
  sample?: unknown;
}

async function main() {
  console.log(`=== Raw gemma output diagnostic for video ${videoId} ===\n`);

  console.log("[1/4] Fetching transcript...");
  const items = await YoutubeTranscript.fetchTranscript(videoId);
  const transcript = items.map((i) => i.text).join(" ");
  console.log(`      ${transcript.length} chars\n`);

  console.log("[2/4] Calling gemma via callScoutExtractLlm()...");
  const userPayload = JSON.stringify({
    youtube_url: `https://youtube.com/watch?v=${videoId}`,
    title: "test",
    channel: "youtube",
    transcript_text: transcript.slice(0, 40_000),
  });
  const t0 = Date.now();
  const raw = await callScoutExtractLlm([{ role: "user", content: userPayload }]);
  const elapsed = Date.now() - t0;
  if (!raw) {
    console.log("FATAL: LLM returned null");
    process.exit(1);
  }
  console.log(`      ${(elapsed / 1000).toFixed(1)}s — ${raw.length} chars raw\n`);

  const outDir = path.join(process.cwd(), "tmp", "gemma-diag");
  fs.mkdirSync(outDir, { recursive: true });
  const rawPath = path.join(outDir, `${videoId}-raw.json`);
  fs.writeFileSync(rawPath, raw);
  console.log(`      Saved raw → ${rawPath}\n`);

  console.log("[3/4] Parsing JSON...");
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.log(`FATAL: JSON parse failed: ${(e as Error).message}`);
    console.log(`First 800 chars of raw:\n${raw.slice(0, 800)}`);
    process.exit(1);
  }
  fs.writeFileSync(path.join(outDir, `${videoId}-parsed.json`), JSON.stringify(parsed, null, 2));
  console.log(`      Parse OK — saved pretty JSON\n`);

  console.log("[4/4] Field-by-field schema audit\n");
  console.log(`Top-level keys: ${Object.keys(parsed).join(", ")}`);
  console.log(`strategies type: ${Array.isArray(parsed.strategies) ? "array" : typeof parsed.strategies}`);
  console.log(`strategies count: ${parsed.strategies?.length ?? 0}\n`);

  if (!Array.isArray(parsed.strategies) || parsed.strategies.length === 0) {
    console.log("STOP: no strategies in output. Likely cause: gemma returned empty or malformed.");
    return;
  }

  for (const [i, s] of parsed.strategies.entries()) {
    console.log(`────── Strategy ${i + 1} ──────`);
    console.log(`Keys present: ${Object.keys(s).join(", ")}\n`);

    const checks: FieldCheck[] = [
      { field: "name", required: false, present: "name" in s, type: typeof s.name, sample: s.name },
      { field: "higher_timeframe", required: true, present: "higher_timeframe" in s, type: typeof s.higher_timeframe, sample: s.higher_timeframe },
      { field: "lower_timeframe", required: false, present: "lower_timeframe" in s, type: typeof s.lower_timeframe, sample: s.lower_timeframe },
      { field: "entry_rule", required: true, present: "entry_rule" in s, type: typeof s.entry_rule, sample: typeof s.entry_rule === "string" ? `"${s.entry_rule.slice(0, 80)}"` : s.entry_rule },
      { field: "preferred_regime", required: true, present: "preferred_regime" in s, type: typeof s.preferred_regime, sample: s.preferred_regime },
      { field: "stop", required: true, present: "stop" in s, type: typeof s.stop, schemaShape: "{anchor, buffer_atr, atr_multiplier, rationale}", sample: s.stop },
      { field: "stop_management", required: false, present: "stop_management" in s, type: typeof s.stop_management, sample: s.stop_management },
      { field: "targets", required: true, present: "targets" in s, type: Array.isArray(s.targets) ? `array[${s.targets?.length}]` : typeof s.targets, sample: s.targets?.[0] },
      { field: "confluences", required: true, present: "confluences" in s, type: Array.isArray(s.confluences) ? `array[${s.confluences?.length}]` : typeof s.confluences, schemaShape: "[{name, description, canonical_match}]", sample: s.confluences?.[0] },
    ];

    for (const c of checks) {
      const flag = c.required && (!c.present || c.sample === null || c.sample === undefined || c.sample === "")
        ? "🔴 MISSING"
        : c.present ? "✓"
        : c.required ? "✗" : "—";
      const typeStr = c.type.padEnd(14);
      console.log(`  ${flag}  ${c.field.padEnd(20)} type=${typeStr} sample=${JSON.stringify(c.sample)?.slice(0, 90)}`);
      if (c.schemaShape && c.present && c.sample) {
        // Validate object/array shape
        if (c.field === "confluences" && Array.isArray(s.confluences)) {
          const first = s.confluences[0];
          if (typeof first === "string") {
            console.log(`     ⚠️  SCHEMA MISMATCH: confluences[] is array of STRINGS, schema says array of OBJECTS ${c.schemaShape}`);
          } else if (first && typeof first === "object") {
            const objKeys = Object.keys(first).join(",");
            console.log(`     ✓ confluences[0] is object with keys: ${objKeys}`);
          }
        }
        if (c.field === "stop" && typeof s.stop === "object" && s.stop !== null) {
          const stopKeys = Object.keys(s.stop).join(",");
          console.log(`     stop keys present: ${stopKeys}`);
          if (!("anchor" in s.stop)) console.log(`     ⚠️  stop.anchor MISSING (schema requires it)`);
        }
      }
    }
    console.log("");
  }

  if (parsed.rejected_strategies?.length) {
    console.log(`Rejected strategies: ${parsed.rejected_strategies.length}`);
    for (const r of parsed.rejected_strategies) console.log(`  - ${JSON.stringify(r)}`);
  }
  if (parsed.instrument_classification) {
    console.log(`\ninstrument_classification: ${parsed.instrument_classification}`);
  }

  console.log(`\n=== DIAGNOSIS ===`);
  const allRequired = ["higher_timeframe", "entry_rule", "preferred_regime", "stop", "targets", "confluences"];
  const missing = parsed.strategies.flatMap((s: any) =>
    allRequired.filter((f) => !(f in s) || s[f] === null || s[f] === "")
  );
  if (missing.length === 0) {
    console.log("✅ All required fields present. Confluences may need shape fix.");
  } else {
    console.log(`🔴 Missing required fields: ${[...new Set(missing)].join(", ")}`);
    console.log(`   This means Ollama schema enforcement is NOT working — required: true is being ignored.`);
    console.log(`   Likely cause: schema 'required' clause not in the same nesting depth gemma can enforce.`);
  }
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });

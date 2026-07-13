/**
 * h1-enumerate-strategies.ts — H1 Wave-6 Pass-2 Phase A CLI wrapper (2026-07-13).
 *
 * THIN, SIDE-EFFECT-FREE CLI wrapper around the Phase-A "global strategy
 * enumeration" gemma call. Mirrors `scripts/h1-extract-one.ts`'s shape
 * exactly (same env bootstrap, same stdin/stdout contract, same
 * `callScoutExtractLlm` routing/retry/fallback machinery) but calls a
 * DIFFERENT prompt (`src/agents/strategy-enumerator.md`) and a DIFFERENT
 * output schema (`src/agents/kb/strategy-enumerator-schema.json`) via the
 * `schemaOverride` + `skipFewShot` opts `callScoutExtractLlm` already
 * supports (added 2026-06-23 for exactly this "secondary gemma caller,
 * different output shape" case — see model-router.ts's own comment at
 * `callOllamaForTranscriptExtractor`). This wrapper does NOT modify
 * model-router.ts; it only calls its existing exported entry point with a
 * different schema/prompt, so it inherits the SAME local-first Ollama
 * routing, retry/backoff, and cloud fallback the production extractor uses
 * — no separate LLM plumbing to maintain.
 *
 * Per docs/designs/h1-wave6-pass2-two-phase-PACKET-2026-07-13.md §1: Phase A
 * takes the WHOLE transcript in one call (no chunking, no per-strategy
 * scoping — that is Phase B's job) and returns a strategy INVENTORY
 * (name + entry_summary + exit_summary + variants[] per distinct strategy),
 * not extracted conditions.
 *
 * INPUT (stdin, JSON): {"video_id": string, "transcript_text": string}
 * OUTPUT (stdout, JSON): the parsed enumerator response object, e.g.
 *   {"strategies": [...], "enumeration_note": null}
 *   On total failure, prints {"error": "..."} to stdout and exits 1 — never
 *   prints a fabricated/partial enumeration.
 *
 * Usage: npx tsx scripts/h1-enumerate-strategies.ts < payload.json
 */

// Env bootstrap — same reason as h1-extract-one.ts: bare subprocess call,
// no launcher pre-loads .env, so the very first import below would throw
// without this. Side-effect import, must run first.
import "dotenv/config";

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { callScoutExtractLlm } from "../src/server/services/model-router.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");

interface InputPayload {
  video_id: string;
  transcript_text: string;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

let _enumeratorPrompt: string | null = null;
function loadEnumeratorPrompt(): string {
  if (_enumeratorPrompt !== null) return _enumeratorPrompt;
  const p = resolve(PROJECT_ROOT, "src/agents/strategy-enumerator.md");
  _enumeratorPrompt = readFileSync(p, "utf-8");
  return _enumeratorPrompt;
}

let _enumeratorSchema: Record<string, unknown> | null = null;
function loadEnumeratorSchema(): Record<string, unknown> {
  if (_enumeratorSchema !== null) return _enumeratorSchema;
  const p = resolve(PROJECT_ROOT, "src/agents/kb/strategy-enumerator-schema.json");
  _enumeratorSchema = JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>;
  return _enumeratorSchema;
}

async function main(): Promise<void> {
  let input: InputPayload;
  try {
    const raw = await readStdin();
    input = JSON.parse(raw) as InputPayload;
  } catch (err) {
    console.log(JSON.stringify({ error: `invalid stdin JSON: ${(err as Error).message}` }));
    process.exitCode = 1;
    return;
  }

  if (!input.transcript_text || typeof input.transcript_text !== "string" || input.transcript_text.length === 0) {
    console.log(JSON.stringify({ error: "transcript_text is required and must be a non-empty string" }));
    process.exitCode = 1;
    return;
  }
  const videoId = input.video_id ?? "unknown";

  const prompt = loadEnumeratorPrompt();
  const schema = loadEnumeratorSchema();

  // skipFewShot mode: callScoutExtractLlm sends this ONE user message verbatim
  // (no extractor few-shot, no KB injection, no auto-appended schema text) — so
  // the full prompt + a restated schema note + the transcript must all be in
  // this single content string.
  const content = `${prompt}\n\n## Output JSON Schema\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\`\n\n## Transcript\n\`\`\`\n${input.transcript_text}\n\`\`\`\n\nEnumerate the distinct strategies in the transcript above. Return ONLY JSON matching the schema.`;

  let raw: string | null = null;
  try {
    // NOTE: opts is the 5th param (after callFn + sleepFn) — must pass all
    // four leading args, mirroring extraction-coverage-gate.ts's own call.
    raw = await callScoutExtractLlm([{ role: "user", content }], undefined, undefined, undefined, {
      schemaOverride: schema,
      skipFewShot: true,
    });
  } catch (err) {
    console.log(JSON.stringify({ error: `callScoutExtractLlm threw: ${(err as Error).message ?? err}` }));
    process.exitCode = 1;
    return;
  }

  if (raw === null) {
    console.log(JSON.stringify({ error: "callScoutExtractLlm returned null (both Ollama and cloud fallback exhausted or unavailable)" }));
    process.exitCode = 1;
    return;
  }

  let parsed: { strategies?: unknown[]; enumeration_note?: unknown };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch (err) {
    console.log(JSON.stringify({ error: `enumerator response was not valid JSON: ${(err as Error).message}`, raw_head: raw.slice(0, 500) }));
    process.exitCode = 1;
    return;
  }

  const strategies = Array.isArray(parsed.strategies) ? parsed.strategies : [];

  const output = {
    video_id: videoId,
    strategies,
    enumeration_note: parsed.enumeration_note ?? null,
  };

  console.log(JSON.stringify(output));
}

main().catch((err) => {
  console.log(JSON.stringify({ error: `unhandled: ${(err as Error).message ?? String(err)}` }));
  process.exitCode = 1;
});

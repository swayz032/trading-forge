/**
 * restore-slumdawg-anam.ts
 *
 * Pushes the canonical Slumdawg Analyst system prompt + first greeting
 * (Option A) into the Anam.ai persona via REST API.
 *
 * Source of truth:
 *   docs/slumdawg-analyst/01-system-prompt.md  (lines 7..end — strip front-matter)
 *   docs/slumdawg-analyst/02-greeting.md       (Option A block only)
 *
 * Requires .env:
 *   ANAM_API_KEY=<key>
 *   ANAM_PERSONA_ID=afb9ea0a-82e6-4339-9709-6c6e76d05814 (default)
 *
 * Usage:
 *   npx tsx scripts/restore-slumdawg-anam.ts
 *
 * Idempotent — re-run any time you edit the prompt or greeting files.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: join(process.cwd(), ".env") });

const ANAM_API_KEY = process.env.ANAM_API_KEY;
const ANAM_PERSONA_ID =
  process.env.ANAM_PERSONA_ID ?? "026cacc4-619e-4cec-a144-c4a8dfcb623e";

if (!ANAM_API_KEY) {
  console.error("FATAL: ANAM_API_KEY not set in .env");
  process.exit(1);
}

const ANAM_API = `https://api.anam.ai/v1/personas/${ANAM_PERSONA_ID}`;

// ─── Load + extract system prompt ───────────────────────────────────────
// 01-system-prompt.md has a front-matter block (lines 1..6) followed by the
// actual prompt starting at "# Personality". We strip the front-matter so
// Anam doesn't ingest the "Paste this into..." instructions.
const promptPath = join(process.cwd(), "docs/slumdawg-analyst/01-system-prompt.md");
const promptRaw = readFileSync(promptPath, "utf8");
// The "# Personality" line is the anchor marker — strip the marker line ITSELF
// AND the blank line after it so the prompt body starts cleanly at the next
// content section (e.g. "1. PERSONALITY") with no markdown header artifact.
const markerMatch = promptRaw.match(/^# Personality\s*$/m);
if (!markerMatch || markerMatch.index === undefined) {
  console.error("FATAL: '# Personality' anchor marker not found in 01-system-prompt.md");
  process.exit(1);
}
const afterMarkerIdx = markerMatch.index + markerMatch[0].length;
const systemPrompt = promptRaw.slice(afterMarkerIdx).trim();

// ─── Load + extract greeting Option A ───────────────────────────────────
const greetPath = join(process.cwd(), "docs/slumdawg-analyst/02-greeting.md");
const greetRaw = readFileSync(greetPath, "utf8");
const optionAMatch = greetRaw.match(
  /## Option A[^\n]*\n+```\s*\n([\s\S]+?)\n```/
);
if (!optionAMatch) {
  console.error("FATAL: Greeting Option A block not found in 02-greeting.md");
  process.exit(1);
}
const initialMessage = optionAMatch[1].trim();

// ─── Sanity preview ─────────────────────────────────────────────────────
console.log(`Persona ID:       ${ANAM_PERSONA_ID}`);
console.log(`systemPrompt:     ${systemPrompt.length} chars (preview: ${systemPrompt.slice(0, 60)}…)`);
console.log(`initialMessage:   ${initialMessage.length} chars`);
console.log(`Greeting preview: ${initialMessage.slice(0, 80)}…`);
console.log(`PUT ${ANAM_API}`);

// ─── PUT to Anam ────────────────────────────────────────────────────────
const res = await fetch(ANAM_API, {
  method: "PUT",
  headers: {
    Authorization: `Bearer ${ANAM_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    systemPrompt,
    initialMessage,
    // ─── Audio quality + no-interruption tuning (Anam JS SDK v4.12.0+) ──
    voiceDetectionOptions: {
      // Drop max noise-filter — 1.0 was stripping consonants (d, t, k) and
      // making STT mishear "dawg" as "Tau" and "Slumdawg" as "Sloan Dollar".
      // 0.6 keeps a moderate noise reduction without smoothing speech edges.
      speechEnhancementLevel: 0.6,
      // 0.0 = wait for full confidence the user is done. Slumdawg never cuts in.
      endOfSpeechSensitivity: 0.0,
      // Mid-sentence pause tolerance — 2s of silence before Slumdawg responds
      silenceBeforeAutoEndTurnSeconds: 2.0,
      // 0 disables the "you still there?" prompt entirely
      silenceBeforeSkipTurnSeconds: 0,
    },
    // Greeting CAN be cut off — short anyway, lets the crew jump in fast
    uninterruptibleGreeting: false,
    // Anam clamps voiceSpeed; pacing is driven by the TONE section + sentence
    // length instructions in the system prompt instead of the speed knob.
    voiceSpeed: 0,
  }),
});

const respText = await res.text();
console.log(`\n← HTTP ${res.status} ${res.statusText}`);
console.log(respText);

if (!res.ok) {
  console.error("\n✗ Restore FAILED");
  process.exit(1);
}

console.log("\n✓ Slumdawg Analyst persona restored.");
console.log("  Open https://lab.anam.ai/build/" + ANAM_PERSONA_ID + " to verify.");

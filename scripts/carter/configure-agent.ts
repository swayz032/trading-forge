/**
 * Carter agent configuration script (Wave 0 auth + Wave 1 brain/voice/persona).
 *
 * Wave 0 (preserved): sets the ElevenLabs ConvAI agent PRIVATE
 * (platform_settings.auth.enable_auth = true) and seeds a hostname allowlist so
 * only the Slumhouse origin (plus localhost for dev) can open conversations.
 *
 * Wave 1 (this extension): ALSO sets the agent brain + voice + turn-taking +
 * system prompt:
 *   - conversation_config.agent.prompt.prompt = carter-system-prompt.md contents
 *   - prompt.llm = "claude-sonnet-4-5" (Claude Sonnet 4.5 — verified valid via
 *     ElevenLabs docs + the Wave 1 plan; confirmed empirically because the API
 *     rejects unknown llm enums on PATCH). If the PATCH is rejected on the llm
 *     field, we retry keeping gemini-2.5-flash and report it.
 *   - LLM cascading ("Default" backup) — best-effort, isolated PATCH so a wrong
 *     shape can never clobber the core config.
 *   - tts.model_id = "eleven_flash_v2_5"; voice kept = Eric (cjVigY5qzO86Huf0OWal)
 *   - conversation_config.turn: interruptions enabled, turn_eagerness="normal",
 *     turn_timeout≈6
 *   - conversation_config.agent.first_message = short professional greeting
 *
 * IMPORTANT — everything is a MERGE patch:
 *   1. GET the current agent config.
 *   2. Deep-merge our changes onto the existing conversation_config /
 *      platform_settings so we never blow away unrelated fields.
 *   3. PATCH the merged objects back.
 *
 * Run:  npx tsx scripts/carter/configure-agent.ts
 *
 * Never prints the API key. Uses the global fetch (Node ≥ 18).
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1/convai/agents";

// ─── Wave 1 canonical agent settings ────────────────────────────────────────
const CARTER_LLM = "claude-sonnet-4-5"; // Claude Sonnet 4.5 — ElevenLabs ConvAI enum
const CARTER_LLM_FALLBACK = "gemini-2.5-flash"; // keep current if the enum is rejected
// NOTE (Wave 1, verified 2026-06-28): the task requested eleven_flash_v2_5, but
// the ElevenLabs API REJECTS it for this English-language agent —
//   "Invalid conversation config: English Agents must use turbo or flash v2."
// Probed all four: eleven_flash_v2_5 + eleven_turbo_v2_5 → 400; eleven_flash_v2 +
// eleven_turbo_v2 → 200. The v2_5 models are multilingual and blocked while
// agent.language="en". We use the valid English flash model. To run flash v2.5
// the agent would have to be switched to multilingual (out of scope / not asked).
const CARTER_TTS_MODEL = "eleven_flash_v2";
const CARTER_VOICE_ID = "cjVigY5qzO86Huf0OWal"; // Eric — DO NOT change
const CARTER_TURN_TIMEOUT = 6;
const CARTER_TURN_EAGERNESS = "normal";
const CARTER_FIRST_MESSAGE =
  "Carter here. Give me a second to check the system, then I'll bring you up to speed.";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadSystemPrompt(): string {
  const promptPath = join(__dirname, "carter-system-prompt.md");
  return readFileSync(promptPath, "utf8");
}

/** Allowlist entry shape per ElevenLabs ConvAI platform_settings.auth.allowlist. */
interface AllowlistEntry {
  hostname: string;
}

/**
 * Resolve the allowlist for Wave 0.
 *
 * Always includes localhost (dev). Includes the production Slumhouse host ONLY
 * when SLUMHOUSE_HOST is set — we DO NOT guess the prod host. If it is unset,
 * the operator must add the prod host before going live (reported at the end).
 */
function resolveAllowlist(existing: AllowlistEntry[]): { allowlist: AllowlistEntry[]; prodHostMissing: boolean } {
  const hosts = new Set<string>();
  for (const e of existing) {
    if (e?.hostname) hosts.add(e.hostname);
  }
  hosts.add("localhost");

  const prodHost = process.env.SLUMHOUSE_HOST?.trim();
  if (prodHost) {
    hosts.add(prodHost);
  }
  // TODO(operator): if SLUMHOUSE_HOST is not set, add the production Slumhouse
  // hostname (e.g. the tf-relay public host) to the allowlist before flipping
  // Carter live. We deliberately do not hard-code or guess it here.

  return {
    allowlist: [...hosts].map((hostname) => ({ hostname })),
    prodHostMissing: !prodHost,
  };
}

/**
 * Build the merge-patch body.
 *   - platform_settings.auth (Wave 0) — preserved via shallow merge.
 *   - conversation_config.agent.prompt / tts / turn (Wave 1) — deep-merged onto
 *     existing config so unrelated fields (asr, rag embedding model, etc.) survive.
 *
 * `llm` is parameterized so the caller can retry with the gemini fallback if the
 * claude-sonnet-4-5 enum is rejected by the API.
 */
function buildPatchBody(
  current: Record<string, any>,
  systemPrompt: string,
  llm: string,
): { body: Record<string, any>; prodHostMissing: boolean } {
  const currentPlatform = current?.platform_settings ?? {};
  const currentAuth = currentPlatform?.auth ?? {};
  const existingAllowlist: AllowlistEntry[] = Array.isArray(currentAuth?.allowlist) ? currentAuth.allowlist : [];

  const { allowlist, prodHostMissing } = resolveAllowlist(existingAllowlist);

  const currentConv = current?.conversation_config ?? {};
  const currentAgent = currentConv?.agent ?? {};
  const currentPrompt = currentAgent?.prompt ?? {};
  const currentTts = currentConv?.tts ?? {};
  const currentTurn = currentConv?.turn ?? {};

  return {
    body: {
      conversation_config: {
        ...currentConv,
        agent: {
          ...currentAgent,
          first_message: CARTER_FIRST_MESSAGE,
          prompt: {
            ...currentPrompt,
            prompt: systemPrompt,
            llm,
          },
        },
        tts: {
          ...currentTts,
          model_id: CARTER_TTS_MODEL,
          voice_id: CARTER_VOICE_ID,
        },
        turn: {
          ...currentTurn,
          // interruptions enabled = turn-taking mode "turn" (the model yields to
          // the user); turn_timeout is how long Carter waits before assuming the
          // user is done; "normal" eagerness balances latency vs cutting in.
          mode: "turn",
          turn_timeout: CARTER_TURN_TIMEOUT,
          turn_eagerness: CARTER_TURN_EAGERNESS,
        },
      },
      platform_settings: {
        ...currentPlatform,
        auth: {
          ...currentAuth,
          enable_auth: true,
          allowlist,
        },
      },
    },
    prodHostMissing,
  };
}

/** PATCH the agent and return {ok, status, json|text}. Never throws. */
async function patchAgent(
  url: string,
  apiKey: string,
  body: Record<string, any>,
): Promise<{ ok: boolean; status: number; json?: Record<string, any>; text?: string }> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return { ok: false, status: res.status, text: (await res.text()).slice(0, 1500) };
  }
  return { ok: true, status: res.status, json: (await res.json()) as Record<string, any> };
}

async function main(): Promise<void> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.CARTER_AGENT_ID;

  if (!apiKey) {
    console.error("ELEVENLABS_API_KEY is not set — aborting.");
    process.exit(1);
  }
  if (!agentId) {
    console.error("CARTER_AGENT_ID is not set — aborting.");
    process.exit(1);
  }

  const url = `${ELEVENLABS_API_BASE}/${agentId}`;
  const systemPrompt = loadSystemPrompt();

  // 1. GET current config
  const getRes = await fetch(url, { method: "GET", headers: { "xi-api-key": apiKey } });
  if (!getRes.ok) {
    console.error(`GET agent failed: ${getRes.status} ${getRes.statusText}`);
    console.error((await getRes.text()).slice(0, 1000));
    process.exit(1);
  }
  const current = (await getRes.json()) as Record<string, any>;

  // 2. PATCH with claude-sonnet-4-5. If the API rejects the llm enum, retry with
  //    the gemini fallback so the prompt/voice/turn still apply (never leave the
  //    agent half-configured), and report it as NEEDS_CONTEXT.
  let llmApplied = CARTER_LLM;
  const first = buildPatchBody(current, systemPrompt, CARTER_LLM);
  let result = await patchAgent(url, apiKey, first.body);

  if (!result.ok) {
    const looksLikeLlmReject = /llm/i.test(result.text ?? "");
    console.error(
      `\n⚠️  PATCH with llm="${CARTER_LLM}" failed (${result.status}).${looksLikeLlmReject ? " Error references 'llm'." : ""}`,
    );
    console.error((result.text ?? "").slice(0, 800));
    console.error(`Retrying with fallback llm="${CARTER_LLM_FALLBACK}" (keeps the rest of the config).`);
    llmApplied = CARTER_LLM_FALLBACK;
    const fallback = buildPatchBody(current, systemPrompt, CARTER_LLM_FALLBACK);
    result = await patchAgent(url, apiKey, fallback.body);
    if (!result.ok) {
      console.error(`PATCH (fallback) also failed: ${result.status}`);
      console.error((result.text ?? "").slice(0, 1000));
      process.exit(1);
    }
  }

  const { prodHostMissing } = first;
  const updated = result.json ?? {};
  const auth = updated?.platform_settings?.auth ?? {};
  const prompt = updated?.conversation_config?.agent?.prompt ?? {};
  const tts = updated?.conversation_config?.tts ?? {};
  const turn = updated?.conversation_config?.turn ?? {};

  // 3. Best-effort: enable LLM cascading ("Default" backup). Isolated PATCH so a
  //    wrong shape can never clobber the core config we just applied.
  let cascadeApplied = false;
  let cascadeNote = "";
  try {
    const cascadeBody = {
      conversation_config: {
        agent: {
          prompt: {
            // ElevenLabs LLM cascade ("Default"): backup_llm_config is a tagged
            // union discriminated by `preference`; valid tags probed 2026-06-28 =
            // "default" (use the platform default backup LLM chain) | "disabled".
            backup_llm_config: { preference: "default" },
          },
        },
      },
    };
    const cascadeRes = await patchAgent(url, apiKey, cascadeBody);
    if (cascadeRes.ok) {
      cascadeApplied = true;
    } else {
      cascadeNote = `cascade PATCH rejected (${cascadeRes.status}) — core config unaffected; enable "Default" backup LLM manually in the ElevenLabs UI`;
    }
  } catch (e) {
    cascadeNote = `cascade PATCH error: ${e instanceof Error ? e.message : String(e)}`;
  }

  // 4. Post-call webhook wiring (Task 1.5 step 6). ElevenLabs references a
  //    WORKSPACE webhook resource by id (platform_settings.workspace_overrides
  //    .webhooks.post_call_webhook_id) — it is NOT a plain URL on the agent. We
  //    do NOT guess the public tower host. When CARTER_WEBHOOK_URL is set the
  //    operator has chosen a host; we still cannot mint the workspace webhook
  //    resource + secret from here safely, so we print exact instructions.
  const webhookUrl = process.env.CARTER_WEBHOOK_URL?.trim();
  let webhookNote: string;
  if (webhookUrl) {
    webhookNote =
      `CARTER_WEBHOOK_URL is set to ${webhookUrl}\n` +
      "    OPERATOR ACTION: in the ElevenLabs dashboard create a Workspace post-call\n" +
      `    webhook → URL = ${webhookUrl.replace(/\/$/, "")}/api/carter/webhook,\n` +
      "    event = 'post_call_transcription', auth = HMAC, shared secret =\n" +
      "    CARTER_POST_CALL_WEBHOOK_SECRET from .env, then attach its id to this\n" +
      "    agent (workspace_overrides.webhooks.post_call_webhook_id).";
  } else {
    webhookNote =
      "CARTER_WEBHOOK_URL is NOT set — post-call webhook NOT wired (we do not guess\n" +
      "    the public host). OPERATOR ACTION before going live:\n" +
      "      1. Set CARTER_WEBHOOK_URL to the public tower base URL.\n" +
      "      2. Create a Workspace post-call webhook → URL = <public>/api/carter/webhook,\n" +
      "         event = 'post_call_transcription', HMAC secret = CARTER_POST_CALL_WEBHOOK_SECRET.\n" +
      "      3. Attach its id to this agent and re-run this script.";
  }

  console.error("─── Carter agent configured (Wave 1 brain/voice/persona) ───");
  console.error(
    JSON.stringify(
      {
        llm_requested: CARTER_LLM,
        llm_applied: llmApplied,
        llm_cascade_default: cascadeApplied,
        tts_model_id: tts.model_id,
        voice_id: tts.voice_id,
        turn: { mode: turn.mode, turn_timeout: turn.turn_timeout, turn_eagerness: turn.turn_eagerness },
        first_message: updated?.conversation_config?.agent?.first_message,
        system_prompt_len: typeof prompt.prompt === "string" ? prompt.prompt.length : null,
        enable_auth: auth.enable_auth,
        allowlist: auth.allowlist,
      },
      null,
      2,
    ),
  );

  if (llmApplied !== CARTER_LLM) {
    console.error(
      `\n⚠️  NEEDS_CONTEXT: llm "${CARTER_LLM}" was rejected; kept "${llmApplied}". Confirm the exact ElevenLabs ConvAI enum for Claude Sonnet 4.5.`,
    );
  }
  if (cascadeNote) console.error(`\nℹ️  LLM cascade: ${cascadeNote}`);
  console.error(`\nℹ️  Post-call webhook: ${webhookNote}`);

  if (prodHostMissing) {
    console.error(
      "\n⚠️  SLUMHOUSE_HOST not set — only localhost was added to the allowlist.\n" +
        "    OPERATOR ACTION REQUIRED: set SLUMHOUSE_HOST in .env (the prod Slumhouse\n" +
        "    hostname) and re-run this script before taking Carter live.",
    );
  }
}

main().catch((e) => {
  console.error("configure-agent failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});

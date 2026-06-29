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
import { CARTER_TOOLS, type CarterTool } from "../../src/server/lib/carter/tool-registry.js";

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1/convai/agents";
const ELEVENLABS_TOOLS_BASE = "https://api.elevenlabs.io/v1/convai/tools";

// ─── Wave 2 — Carter tool registration ───────────────────────────────────────
// Every green + yellow tool in the canonical registry becomes an ElevenLabs
// WEBHOOK tool pointed at the relay (CARTER_WEBHOOK_URL/api/carter/<name>).
// RED tools are NEVER registered — that is the whole point of the tier system.
//
// Naming: ElevenLabs tool names must match ^[a-zA-Z][a-zA-Z0-9_]*$. We prefix
// every tool with "carter_" so they are namespaced away from any other tools in
// the same workspace (the workspace is shared). The relay URL still carries the
// REGISTRY name (`/api/carter/<tool.name>`), so the backend route is unaffected
// by the EL-side display name.
const CARTER_TOOL_NAME_PREFIX = "carter_";
// Per-tool response timeout (relay → tower round-trip). 20s is generous for the
// read/action handlers; the relay itself forwards synchronously.
const CARTER_TOOL_TIMEOUT_SECS = 20;

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
 * Resolve the allowlist.
 *
 * ElevenLabs' allowlist validator requires each hostname to be a real domain
 * (must contain a ".") OR a host with an explicit port ("host:port"). A bare
 * "localhost" is REJECTED by the dashboard ("Hostname must consist of a domain
 * and an optional port"), so we never emit it — preserve only VALID existing
 * entries and add the prod Slumhouse host when SLUMHOUSE_HOST is set. For local
 * dev, set SLUMHOUSE_DEV_HOST to a ported value like "localhost:5173".
 */
function isValidAllowlistHost(h: string): boolean {
  return h.includes(".") || h.includes(":");
}
function resolveAllowlist(existing: AllowlistEntry[]): { allowlist: AllowlistEntry[]; prodHostMissing: boolean } {
  const hosts = new Set<string>();
  // Preserve only valid pre-existing entries (drops bare "localhost" etc.).
  for (const e of existing) {
    if (e?.hostname && isValidAllowlistHost(e.hostname)) hosts.add(e.hostname);
  }

  const devHost = process.env.SLUMHOUSE_DEV_HOST?.trim();
  if (devHost && isValidAllowlistHost(devHost)) hosts.add(devHost);

  const prodHost = process.env.SLUMHOUSE_HOST?.trim();
  if (prodHost && isValidAllowlistHost(prodHost)) hosts.add(prodHost);
  // We deliberately do not hard-code or guess the prod host.

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
  // ElevenLabs rejects a PATCH that carries BOTH the deprecated inline `tools`
  // field AND `tool_ids` ("Cannot specify both tools and tool IDs"). The GET
  // denormalizes tool_ids back into `tools`, so a read-modify-write re-sends it.
  // Strip the legacy `tools` field; tool_ids is the canonical model and survives.
  const { tools: _dropLegacyTools, ...currentPromptNoTools } = currentPrompt;
  const currentTts = currentConv?.tts ?? {};
  const currentTurn = currentConv?.turn ?? {};

  return {
    body: {
      conversation_config: {
        ...currentConv,
        agent: {
          ...currentAgent,
          // OPERATOR-OWNED: first_message (greeting) is controlled in the
          // ElevenLabs dashboard. The script used to set it here, which REVERTED
          // the operator's dashboard edits on every run — removed.
          prompt: {
            ...currentPromptNoTools,
            prompt: systemPrompt,
            llm,
          },
        },
        // OPERATOR-OWNED: tts (voice_id + model_id) is controlled in the
        // ElevenLabs dashboard (e.g. voice=Charles, model). The script no longer
        // touches tts — it was reverting the operator's voice/model choices.
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

/**
 * Build the ElevenLabs webhook tool_config for one Carter tool.
 *
 * - url      = <CARTER_WEBHOOK_URL>/api/carter/<registry-name> (relay → tower)
 * - method   = POST (the relay forwards the JSON body to the tower)
 * - auth     = static "Authorization: Bearer <CARTER_TOOLS_HMAC_SECRET>" via the
 *              `request_headers` plain key-value map (confirmed live on existing
 *              workspace tools — request_headers is a {name: value} object, not a
 *              list). Every call therefore carries the tools-plane Bearer secret.
 * - body     = derived from the registry's optional paramsSchema; when a tool has
 *              none (the current registry carries no paramsSchema), we emit a
 *              valid empty object schema so the tool stays a clean POST.
 */
function buildCarterToolConfig(
  tool: CarterTool,
  webhookBase: string,
  bearerSecret: string,
): Record<string, any> {
  const base = webhookBase.replace(/\/+$/, "");
  const url = `${base}/api/carter/${tool.name}`;

  // The canonical interface does not declare paramsSchema today; honor it if a
  // future registry adds one, otherwise ship an empty object schema.
  const paramsSchema = (tool as { paramsSchema?: Record<string, any> }).paramsSchema;
  const request_body_schema =
    paramsSchema && typeof paramsSchema === "object"
      ? paramsSchema
      : { type: "object", properties: {}, required: [], description: "No parameters." };

  return {
    type: "webhook",
    name: `${CARTER_TOOL_NAME_PREFIX}${tool.name}`,
    description: tool.description,
    response_timeout_secs: CARTER_TOOL_TIMEOUT_SECS,
    api_schema: {
      url,
      method: "POST",
      request_headers: {
        "Content-Type": "application/json",
        // Static Bearer secret == CARTER_TOOLS_HMAC_SECRET (the tools-plane secret
        // the backend checks). Authenticates every relay call.
        Authorization: `Bearer ${bearerSecret}`,
      },
      path_params_schema: {},
      query_params_schema: null,
      request_body_schema,
    },
  };
}

/** GET every workspace tool, return a name → id map (for idempotent upserts). */
async function listWorkspaceTools(apiKey: string): Promise<Map<string, string>> {
  const byName = new Map<string, string>();
  const res = await fetch(ELEVENLABS_TOOLS_BASE, {
    method: "GET",
    headers: { "xi-api-key": apiKey },
  });
  if (!res.ok) {
    throw new Error(`GET /convai/tools failed: ${res.status} ${(await res.text()).slice(0, 400)}`);
  }
  const body = (await res.json()) as { tools?: Array<{ id?: string; tool_config?: { name?: string } }> };
  for (const t of body?.tools ?? []) {
    const name = t?.tool_config?.name;
    const id = t?.id;
    if (name && id) byName.set(name, id);
  }
  return byName;
}

/**
 * Idempotently create-or-update a single webhook tool. Returns its tool id.
 * Throws on a non-OK response so the caller can fail loudly (we never want to
 * silently set tool_ids to a partial set).
 */
async function upsertCarterTool(
  apiKey: string,
  toolConfig: Record<string, any>,
  existingId: string | undefined,
): Promise<{ id: string; mode: "created" | "updated" }> {
  const headers = { "xi-api-key": apiKey, "Content-Type": "application/json" };
  if (existingId) {
    const res = await fetch(`${ELEVENLABS_TOOLS_BASE}/${existingId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ tool_config: toolConfig }),
    });
    if (!res.ok) {
      throw new Error(
        `PATCH tool ${toolConfig.name} (${existingId}) failed: ${res.status} ${(await res.text()).slice(0, 400)}`,
      );
    }
    return { id: existingId, mode: "updated" };
  }
  const res = await fetch(ELEVENLABS_TOOLS_BASE, {
    method: "POST",
    headers,
    body: JSON.stringify({ tool_config: toolConfig }),
  });
  if (!res.ok) {
    throw new Error(
      `POST tool ${toolConfig.name} failed: ${res.status} ${(await res.text()).slice(0, 400)}`,
    );
  }
  const body = (await res.json()) as { id?: string };
  if (!body?.id) throw new Error(`POST tool ${toolConfig.name} returned no id`);
  return { id: body.id, mode: "created" };
}

/**
 * Register every green + yellow Carter tool as an ElevenLabs webhook tool and set
 * the agent's prompt.tool_ids to EXACTLY that set (idempotent — re-running updates
 * tools in place by id and replaces the tool_ids array, never duplicates).
 *
 * RED tools are filtered out and never touched. Returns a summary, or null if the
 * required env (CARTER_WEBHOOK_URL / CARTER_TOOLS_HMAC_SECRET) is missing.
 */
async function registerCarterTools(
  apiKey: string,
  agentUrl: string,
): Promise<
  | {
      green: number;
      yellow: number;
      redSkipped: number;
      registered: number;
      created: number;
      updated: number;
      toolIdsOnAgent: number;
      sampleNames: string[];
      bearerAttached: boolean;
    }
  | { skipped: true; reason: string }
> {
  const webhookBase = process.env.CARTER_WEBHOOK_URL?.trim();
  const bearerSecret = process.env.CARTER_TOOLS_HMAC_SECRET?.trim();
  if (!webhookBase) return { skipped: true, reason: "CARTER_WEBHOOK_URL not set" };
  if (!bearerSecret) return { skipped: true, reason: "CARTER_TOOLS_HMAC_SECRET not set" };

  // Tier filter — green + yellow ONLY. RED tools have no tool path and must never
  // be registered on the live agent.
  const dispatchable = CARTER_TOOLS.filter((t) => t.tier === "green" || t.tier === "yellow");
  const greenCount = dispatchable.filter((t) => t.tier === "green").length;
  const yellowCount = dispatchable.filter((t) => t.tier === "yellow").length;
  const redCount = CARTER_TOOLS.filter((t) => t.tier === "red").length;

  const existing = await listWorkspaceTools(apiKey);

  const toolIds: string[] = [];
  const createdNames: string[] = [];
  const updatedNames: string[] = [];
  for (const tool of dispatchable) {
    const cfg = buildCarterToolConfig(tool, webhookBase, bearerSecret);
    const { id, mode } = await upsertCarterTool(apiKey, cfg, existing.get(cfg.name));
    toolIds.push(id);
    (mode === "created" ? createdNames : updatedNames).push(cfg.name);
  }

  // Set the agent's tool_ids to EXACTLY the registered set. Isolated nested merge
  // patch (ElevenLabs PATCH deep-merges; arrays are replaced) so we never clobber
  // the prompt text / llm / knowledge_base / built_in_tools.
  const patchRes = await patchAgent(agentUrl, apiKey, {
    conversation_config: { agent: { prompt: { tool_ids: toolIds } } },
  });
  if (!patchRes.ok) {
    throw new Error(
      `PATCH agent tool_ids failed: ${patchRes.status} ${(patchRes.text ?? "").slice(0, 400)}`,
    );
  }
  const appliedToolIds: string[] =
    patchRes.json?.conversation_config?.agent?.prompt?.tool_ids ?? [];

  return {
    green: greenCount,
    yellow: yellowCount,
    redSkipped: redCount,
    registered: toolIds.length,
    created: createdNames.length,
    updated: updatedNames.length,
    toolIdsOnAgent: appliedToolIds.length,
    sampleNames: dispatchable.slice(0, 5).map((t) => `${CARTER_TOOL_NAME_PREFIX}${t.name}`),
    bearerAttached: true,
  };
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

  // 3b. Wave 2 — register every green + yellow Carter tool as a webhook tool and
  //     set the agent's tool_ids to exactly that set. Isolated from the core
  //     config patch above; throws loudly on any failure so we never leave the
  //     agent with a partial tool set.
  let toolReg:
    | Awaited<ReturnType<typeof registerCarterTools>>
    | { error: string };
  try {
    toolReg = await registerCarterTools(apiKey, url);
  } catch (e) {
    toolReg = { error: e instanceof Error ? e.message : String(e) };
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
        tool_registration: toolReg,
      },
      null,
      2,
    ),
  );

  if ("error" in toolReg) {
    console.error(`\n⚠️  Carter tool registration FAILED: ${toolReg.error}`);
  } else if ("skipped" in toolReg) {
    console.error(
      `\nℹ️  Carter tool registration SKIPPED: ${toolReg.reason} — set it and re-run to register tools.`,
    );
  } else {
    console.error(
      `\n✅ Carter tools registered: ${toolReg.registered} (${toolReg.green} green + ${toolReg.yellow} yellow; ` +
        `${toolReg.created} created / ${toolReg.updated} updated). RED tools skipped: ${toolReg.redSkipped}. ` +
        `agent.tool_ids now = ${toolReg.toolIdsOnAgent}. Bearer secret attached: ${toolReg.bearerAttached}.`,
    );
  }

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

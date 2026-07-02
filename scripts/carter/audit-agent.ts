/**
 * Carter Wave 0 — agent audit script.
 *
 * Reads ELEVENLABS_API_KEY + CARTER_AGENT_ID from the environment and GETs the
 * current ElevenLabs ConvAI agent config, then pretty-prints the key facets
 * (system prompt, first_message, llm, voice, tools/tool_ids, knowledge_base,
 * platform_settings.auth) plus the full JSON.
 *
 * Run:  npx tsx scripts/carter/audit-agent.ts
 * Save: npx tsx scripts/carter/audit-agent.ts > scripts/carter/agent-baseline.json
 *
 * Never prints the API key. Uses the global fetch (Node ≥ 18).
 */
import "dotenv/config";

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1/convai/agents";

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
  const r = await fetch(url, {
    method: "GET",
    headers: { "xi-api-key": apiKey },
  });

  if (!r.ok) {
    const text = await r.text();
    console.error(`ElevenLabs GET failed: ${r.status} ${r.statusText}`);
    console.error(text.slice(0, 1000));
    process.exit(1);
  }

  const data = (await r.json()) as Record<string, any>;

  // ─── Key-facts summary (human-readable, to stderr so stdout stays clean JSON) ───
  const conv = data?.conversation_config ?? {};
  const agentCfg = conv?.agent ?? {};
  const promptCfg = agentCfg?.prompt ?? {};
  const ttsCfg = conv?.tts ?? {};
  const platform = data?.platform_settings ?? {};
  const auth = platform?.auth ?? {};

  const summary = {
    name: data?.name,
    agent_id: data?.agent_id,
    system_prompt_excerpt:
      typeof promptCfg?.prompt === "string"
        ? `${promptCfg.prompt.slice(0, 400)}${promptCfg.prompt.length > 400 ? " …[truncated]" : ""}`
        : null,
    first_message: agentCfg?.first_message ?? null,
    llm: promptCfg?.llm ?? null,
    voice_id: ttsCfg?.voice_id ?? null,
    model_id: ttsCfg?.model_id ?? null,
    tools: promptCfg?.tools ?? null,
    tool_ids: promptCfg?.tool_ids ?? null,
    knowledge_base: promptCfg?.knowledge_base ?? null,
    platform_settings_auth: {
      enable_auth: auth?.enable_auth ?? null,
      allowlist: auth?.allowlist ?? null,
    },
  };

  console.error("─── Carter agent audit (summary) ───");
  console.error(JSON.stringify(summary, null, 2));
  console.error("─── full JSON on stdout ───");

  // Full raw JSON to stdout for redirection into agent-baseline.json
  console.log(JSON.stringify(data, null, 2));
}

main().catch((e) => {
  console.error("audit-agent failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});

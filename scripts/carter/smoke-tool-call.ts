/**
 * smoke-tool-call.ts — Carter live END-TO-END tool-call proof.
 *
 * Opens a simulated conversation and asks a LIVE-STATUS question whose answer
 * can ONLY come from a webhook tool (report_production_status / report_system_health)
 * hitting the relay -> tower. If Carter's answer reflects the real production
 * state (HALT / not trading), the whole loop (agent brain -> tool -> relay ->
 * tower -> real data -> agent) is proven end to end.
 *
 * Run: npx tsx scripts/carter/smoke-tool-call.ts
 */
const API = "https://api.elevenlabs.io/v1/convai";
const key = process.env.ELEVENLABS_API_KEY;
const agentId = process.env.CARTER_AGENT_ID;
if (!key || !agentId) {
  console.error("missing ELEVENLABS_API_KEY or CARTER_AGENT_ID");
  process.exit(1);
}

const body = {
  simulation_specification: {
    simulated_user_config: {
      first_message: "Are we trading right now, and what's the current production status?",
      prompt: {
        prompt:
          "You are the operator doing a quick status check. Ask Carter whether the bot is trading right now and what the production status is. After he answers with the status, say 'thanks' and end. Keep it short.",
      },
    },
  },
};

const r = await fetch(`${API}/agents/${agentId}/simulate-conversation`, {
  method: "POST",
  headers: { "xi-api-key": key, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
if (!r.ok) {
  console.error(`simulate-conversation failed: ${r.status} ${(await r.text()).slice(0, 800)}`);
  process.exit(1);
}
const data: any = await r.json();
const convo: any[] = data.simulated_conversation ?? data.conversation ?? [];

// Extract tool calls + agent text from the transcript (shape-tolerant).
const toolNames: string[] = [];
const agentText: string[] = [];
const walk = (node: any) => {
  if (!node || typeof node !== "object") return;
  for (const [k, v] of Object.entries(node)) {
    if ((k === "tool_name" || k === "name") && typeof v === "string" && v.startsWith("carter_")) toolNames.push(v);
    if (k === "tool_calls" && Array.isArray(v)) for (const tc of v) walk(tc);
    if (k === "message" && typeof v === "string") agentText.push(v);
    if (typeof v === "object") walk(v);
  }
};
for (const turn of convo) {
  if (turn?.role === "agent" && typeof turn?.message === "string") agentText.push(turn.message);
  walk(turn);
}

const answer = agentText.join("\n");
const lc = answer.toLowerCase();
const calledStatusTool = toolNames.some((t) => /production_status|system_health/.test(t));
const anyTool = [...new Set(toolNames)];
const reflectsHalt = /halt|not trading|isn'?t trading|paused|we are not|no\b.*trad/.test(lc);

console.log("=== TOOL CALLS OBSERVED ===");
console.log(anyTool.length ? anyTool.join(", ") : "(none detected in transcript)");
console.log("\n=== CARTER ANSWER (first 700 chars) ===");
console.log(answer.slice(0, 700));
console.log("\n=== VERDICT ===");
console.log(
  JSON.stringify(
    { calledStatusTool, anyToolCalled: anyTool.length > 0, reflectsHaltStatus: reflectsHalt },
    null,
    2,
  ),
);

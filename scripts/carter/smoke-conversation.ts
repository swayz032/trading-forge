/**
 * smoke-conversation.ts — Carter Wave 1 Task 1.6
 *
 * Opens a TEXT-mode conversation with the LIVE ElevenLabs agent (no audio, no
 * Trading Forge server involved) via the ConvAI `simulate-conversation` endpoint,
 * asks the B14 question, and asserts the answer is KB-grounded — it must mention
 * firm-breach / probability of ruin and the ~0.20 confidence-interval threshold.
 *
 * Run:  npx tsx scripts/carter/smoke-conversation.ts
 *
 * Exit 0 on grounded answer, 1 otherwise. Never prints the API key.
 */
import "dotenv/config";

const API = "https://api.elevenlabs.io/v1/convai";
const QUESTION = "What does B14 mean and why would it block a strategy?";

/** Pull every assistant/agent message out of an arbitrary simulate response. */
function collectAgentMessages(node: unknown, acc: string[]): void {
  if (Array.isArray(node)) {
    for (const x of node) collectAgentMessages(x, acc);
    return;
  }
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    const role = typeof o.role === "string" ? o.role.toLowerCase() : undefined;
    const msg = typeof o.message === "string" ? o.message : typeof o.text === "string" ? o.text : undefined;
    if (msg && (role === "agent" || role === "assistant")) acc.push(msg);
    for (const v of Object.values(o)) collectAgentMessages(v, acc);
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.CARTER_AGENT_ID;
  if (!apiKey) { console.error("ELEVENLABS_API_KEY is not set — aborting."); process.exit(1); }
  if (!agentId) { console.error("CARTER_AGENT_ID is not set — aborting."); process.exit(1); }

  const body = {
    simulation_specification: {
      simulated_user_config: {
        first_message: QUESTION,
        prompt: {
          prompt:
            "You are the operator testing Carter. Ask EXACTLY this one question and " +
            "nothing else: \"" + QUESTION + "\". After Carter answers, say \"thanks\" and end. " +
            "Do not ask follow-ups.",
        },
      },
    },
  };

  const r = await fetch(`${API}/agents/${agentId}/simulate-conversation`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    console.error(`simulate-conversation failed: ${r.status} ${(await r.text()).slice(0, 600)}`);
    process.exit(1);
  }
  const data = (await r.json()) as unknown;

  const agentMsgs: string[] = [];
  collectAgentMessages(data, agentMsgs);
  const answer = agentMsgs.join("\n\n").trim();

  console.error("─── Carter's answer (text mode) ───");
  console.error(answer || "(no agent message found)");
  console.error("───────────────────────────────────");

  const lc = answer.toLowerCase();
  const mentionsRuin = /ruin|firm[- ]?breach|shut down|payout|drawdown|account.*closed/.test(lc);
  // Threshold may be voiced as 0.20 / 20% / "twenty percent".
  const mentionsThreshold = /0\.2(0)?|20\s?%|20 percent|twenty percent/.test(lc);
  const mentionsB14 = /b14|survival twin|monte carlo/.test(lc);

  console.error(
    JSON.stringify({ mentionsB14, mentionsRuin, mentionsThreshold, chars: answer.length }, null, 2),
  );

  if (mentionsRuin && mentionsThreshold) {
    console.error("✅ KB-grounded: answer references firm-breach/ruin AND the ~0.20 threshold.");
    process.exitCode = 0;
    return;
  }
  console.error("❌ Answer did not clearly cite firm-breach ruin + the ~0.20 CI threshold.");
  process.exitCode = 1;
}

main().catch((e) => {
  console.error("smoke-conversation failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});

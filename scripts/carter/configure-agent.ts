/**
 * Carter Wave 0 — agent configuration script.
 *
 * Sets the ElevenLabs ConvAI agent PRIVATE (platform_settings.auth.enable_auth
 * = true) and seeds a hostname allowlist so only the Slumhouse origin (plus
 * localhost for dev) can open conversations once auth is on.
 *
 * IMPORTANT — this does a MERGE patch:
 *   1. GET the current agent config.
 *   2. Shallow-merge our auth changes onto the existing platform_settings so we
 *      never blow away unrelated config.
 *   3. PATCH only platform_settings back.
 *
 * Wave 0 scope: ONLY platform_settings.auth. Later waves will extend
 * `buildPatchBody()` to also set llm / voice / system prompt / tools / KB — the
 * structure below is intentionally easy to extend (add more keys to the merged
 * conversation_config / platform_settings object).
 *
 * Run:  npx tsx scripts/carter/configure-agent.ts
 *
 * Never prints the API key. Uses the global fetch (Node ≥ 18).
 */
import "dotenv/config";

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1/convai/agents";

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
 * Build the merge-patch body. Wave 0 only touches platform_settings.auth;
 * existing platform_settings keys are preserved via shallow merge.
 */
function buildPatchBody(current: Record<string, any>): { body: Record<string, any>; prodHostMissing: boolean } {
  const currentPlatform = current?.platform_settings ?? {};
  const currentAuth = currentPlatform?.auth ?? {};
  const existingAllowlist: AllowlistEntry[] = Array.isArray(currentAuth?.allowlist) ? currentAuth.allowlist : [];

  const { allowlist, prodHostMissing } = resolveAllowlist(existingAllowlist);

  return {
    body: {
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

  // 1. GET current config
  const getRes = await fetch(url, { method: "GET", headers: { "xi-api-key": apiKey } });
  if (!getRes.ok) {
    console.error(`GET agent failed: ${getRes.status} ${getRes.statusText}`);
    console.error((await getRes.text()).slice(0, 1000));
    process.exit(1);
  }
  const current = (await getRes.json()) as Record<string, any>;

  // 2. Build merge patch (Wave 0: auth only)
  const { body, prodHostMissing } = buildPatchBody(current);

  // 3. PATCH
  const patchRes = await fetch(url, {
    method: "PATCH",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!patchRes.ok) {
    console.error(`PATCH agent failed: ${patchRes.status} ${patchRes.statusText}`);
    console.error((await patchRes.text()).slice(0, 1000));
    process.exit(1);
  }

  const updated = (await patchRes.json()) as Record<string, any>;
  const auth = updated?.platform_settings?.auth ?? {};
  console.error("─── Carter agent configured (auth) ───");
  console.error(JSON.stringify({ enable_auth: auth.enable_auth, allowlist: auth.allowlist }, null, 2));

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

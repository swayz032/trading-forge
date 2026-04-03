import { checkSystemMapDrift, syncSystemMapArtifacts } from "../src/server/lib/system-topology.js";

function ensurePreprodReadinessEnv(): void {
  process.env.TF_RUNTIME_STAGE ??= "preprod";
  process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/trading_forge";
  process.env.API_KEY ??= "repo-readiness-api-key";
  process.env.N8N_BASE_URL ??= "http://localhost:5678";
  process.env.N8N_API_KEY ??= "repo-readiness-n8n-api-key";
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??= "http://localhost:4318/v1/traces";
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "check";
  if (mode !== "check" && mode !== "sync") {
    console.error(`Unknown mode "${mode}". Use "check" or "sync".`);
    process.exit(1);
  }

  ensurePreprodReadinessEnv();

  const result = mode === "sync"
    ? await syncSystemMapArtifacts()
    : await checkSystemMapDrift();

  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "ok" && mode === "check") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});

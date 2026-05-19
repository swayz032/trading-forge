import "dotenv/config";
import { execSync } from "node:child_process";
import postgres from "postgres";

import { checkSystemMapDrift } from "../src/server/lib/system-topology.js";

const TARGETED_TESTS = [
  "src/server/services/notification-service.test.ts",
  "src/server/services/ollama-client.test.ts",
  "src/server/services/paper-execution-service.fill-probability.test.ts",
  "src/server/services/paper-execution-service.mae-mfe.test.ts",
  "src/server/services/paper-execution-service.journal-enrichment.test.ts",
  "src/server/__tests__/evolution-cross-archetype.test.ts",
  "src/server/__tests__/integration-smoke.test.ts",
  "src/server/__tests__/paper-session-feedback.test.ts",
  "src/server/__tests__/system-topology.test.ts",
  "src/server/__tests__/health-dashboard.test.ts",
  "src/server/__tests__/production-convergence.test.ts",
];

function buildPreprodReadinessEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    TF_RUNTIME_STAGE: baseEnv.TF_RUNTIME_STAGE ?? "preprod",
    DATABASE_URL: baseEnv.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/trading_forge",
    API_KEY: baseEnv.API_KEY ?? "repo-readiness-api-key",
    N8N_BASE_URL: baseEnv.N8N_BASE_URL ?? "http://localhost:5678",
    N8N_API_KEY: baseEnv.N8N_API_KEY ?? "repo-readiness-n8n-api-key",
    OTEL_EXPORTER_OTLP_ENDPOINT: baseEnv.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318/v1/traces",
  };
}

function run(command: string, env: NodeJS.ProcessEnv = process.env): void {
  execSync(command, {
    stdio: "inherit",
    env,
  });
}

function splitWorkflowEvidenceBlockers(blockers: string[]): { ignored: string[]; remaining: string[] } {
  const ignored = blockers.filter((item) => item.startsWith("workflow-missing-evidence:"));
  const remaining = blockers.filter((item) => !item.startsWith("workflow-missing-evidence:"));
  return { ignored, remaining };
}

async function verifyCriticalSchema(env: NodeJS.ProcessEnv): Promise<void> {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for critical schema verification.");
  }

  const sql = postgres(databaseUrl, {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
  });

  try {
    const rows = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'strategies'
          AND column_name = 'source'
      ) AS exists
    `;

    if (!rows[0]?.exists) {
      throw new Error("Missing required column strategies.source. Run migration 0045_strategy_cleanup_and_source.");
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  const readinessEnv = buildPreprodReadinessEnv(process.env);

  run("npx tsc --noEmit");
  run("npm run lint");
  run("npm run system-map:check", readinessEnv);
  run(`npx vitest run ${TARGETED_TESTS.join(" ")}`);

  Object.assign(process.env, readinessEnv);
  await verifyCriticalSchema(readinessEnv);

  const result = await checkSystemMapDrift();
  const readiness = result.registryCoverage?.readiness;
  const convergence = result.registryCoverage?.productionConvergence;

  if (!readiness || !convergence) {
    throw new Error("Topology readiness summary is unavailable after repo checks.");
  }

  const readinessBlockers = splitWorkflowEvidenceBlockers(readiness.blockers ?? []);
  const convergenceBlockers = splitWorkflowEvidenceBlockers(convergence.blockers ?? []);
  const unresolvedBlockers = [...new Set([
    ...readinessBlockers.remaining,
    ...convergenceBlockers.remaining,
  ])];

  if (!readiness.launchReady || convergence.status !== "ready") {
    if (unresolvedBlockers.length === 0) {
      console.log(JSON.stringify({
        message: "Repository checks passed. Workflow evidence blockers were intentionally ignored.",
        ignoredWorkflowEvidenceBlockers: [
          ...new Set([
            ...readinessBlockers.ignored,
            ...convergenceBlockers.ignored,
          ]),
        ],
      }, null, 2));
      return;
    }

    console.error(JSON.stringify({
      message: "Repository checks passed, but launch readiness is blocked.",
      launchReady: readiness.launchReady,
      productionConvergence: convergence.status,
      blockers: unresolvedBlockers,
    }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({
    message: "Repository checks and launch readiness passed.",
    launchReady: readiness.launchReady,
    productionConvergence: convergence.status,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});

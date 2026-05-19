import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const GENERATED_START = "<!-- BEGIN GENERATED: topology -->";
const GENERATED_END = "<!-- END GENERATED: topology -->";
const projectRoot = process.cwd();

function basenameWithoutExt(fileName) {
  return fileName.replace(/\.[^.]+$/, "");
}

async function listFiles(dirPath, extension) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

async function listDirectories(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("__") && !["tests", "indicators", "strategies", "specs"].includes(name))
    .sort((a, b) => a.localeCompare(b));
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function extractRegexMatches(source, regex, groupIndex = 1) {
  const matches = [];
  for (const match of source.matchAll(regex)) {
    const value = match[groupIndex];
    if (value) matches.push(value);
  }
  return uniqueSorted(matches);
}

async function collectSystemTopology() {
  const indexSource = await readFile(path.join(projectRoot, "src/server/index.ts"), "utf8");
  const schedulerSource = await readFile(path.join(projectRoot, "src/server/scheduler.ts"), "utf8");
  const schemaSource = await readFile(path.join(projectRoot, "src/server/db/schema.ts"), "utf8");
  const strategiesSource = await readFile(path.join(projectRoot, "src/server/routes/strategies.ts"), "utf8");
  const lifecycleSource = await readFile(path.join(projectRoot, "src/server/services/lifecycle-service.ts"), "utf8");

  const routes = uniqueSorted([
    ...extractRegexMatches(indexSource, /app\.use\("([^"]+)",/g),
    ...extractRegexMatches(indexSource, /app\.get\("([^"]+)",/g),
  ].filter((route) => route.startsWith("/api/")));

  const schedulerJobs = extractRegexMatches(schedulerSource, /registerJob\("([^"]+)"/g);
  const workflows = (await listFiles(path.join(projectRoot, "workflows/n8n"), ".json")).map(basenameWithoutExt);
  const engineSubsystems = uniqueSorted([
    ...(await listDirectories(path.join(projectRoot, "src/engine"))),
    ...(await listFiles(path.join(projectRoot, "src/engine"), ".py"))
      .map(basenameWithoutExt)
      .filter((name) => [
        "backtester",
        "walk_forward",
        "monte_carlo",
        "critic_optimizer",
        "validation_runner",
        "strategy_memory",
        "deepar_forecaster",
        "deepar_regime_classifier",
        "parameter_evolver",
        "pine_compiler",
        "quantum_mc",
      ].includes(name)),
  ]);
  const databaseTables = extractRegexMatches(schemaSource, /pgTable\(\s*"([^"]+)"/g);

  const manualTradingViewDeployOnly =
    strategiesSource.includes('post("/:id/deploy"') &&
    strategiesSource.includes('"strategy.deploy_approved"') &&
    lifecycleSource.includes("The system NEVER auto-deploys to TradingView");

  return {
    generatedAt: new Date().toISOString(),
    manualTradingViewDeployOnly,
    counts: {
      routes: routes.length,
      schedulerJobs: schedulerJobs.length,
      workflows: workflows.length,
      engineSubsystems: engineSubsystems.length,
      databaseTables: databaseTables.length,
    },
    routes,
    schedulerJobs,
    workflows,
    engineSubsystems,
    databaseTables,
  };
}

function renderBulletList(values) {
  if (values.length === 0) return "- None";
  return values.map((value) => `- \`${value}\``).join("\n");
}

function renderGeneratedTopologySection(snapshot) {
  return [
    GENERATED_START,
    "## Generated Topology Snapshot",
    "",
    `Updated automatically from the repo on \`${snapshot.generatedAt}\`.`,
    "",
    `- TradingView deployment gate: \`${snapshot.manualTradingViewDeployOnly ? "manual-only" : "drift-detected"}\``,
    `- API routes tracked: \`${snapshot.counts.routes}\``,
    `- Scheduler jobs tracked: \`${snapshot.counts.schedulerJobs}\``,
    `- n8n workflows tracked: \`${snapshot.counts.workflows}\``,
    `- Engine subsystems tracked: \`${snapshot.counts.engineSubsystems}\``,
    `- Database tables tracked: \`${snapshot.counts.databaseTables}\``,
    "",
    "### API Routes",
    renderBulletList(snapshot.routes),
    "",
    "### Scheduler Jobs",
    renderBulletList(snapshot.schedulerJobs),
    "",
    "### Engine Subsystems",
    renderBulletList(snapshot.engineSubsystems),
    "",
    "### Workflow Inventory",
    renderBulletList(snapshot.workflows),
    "",
    "### Database Tables",
    renderBulletList(snapshot.databaseTables),
    GENERATED_END,
  ].join("\n");
}

function extractExistingGeneratedSection(documentText) {
  if (!documentText.includes(GENERATED_START) || !documentText.includes(GENERATED_END)) {
    return null;
  }
  const pattern = new RegExp(`${GENERATED_START}[\\s\\S]*?${GENERATED_END}`, "m");
  return documentText.match(pattern)?.[0] ?? null;
}

function upsertGeneratedSection(documentText, generatedSection) {
  const existing = extractExistingGeneratedSection(documentText);
  if (existing) {
    const pattern = new RegExp(`${GENERATED_START}[\\s\\S]*?${GENERATED_END}`, "m");
    return documentText.replace(pattern, generatedSection);
  }
  return `${documentText.trimEnd()}\n\n${generatedSection}\n`;
}

function normalizeSection(section) {
  return section
    .replace(/\r\n/g, "\n")
    .replace(/^Updated automatically from the repo on `[^`]+`\.\n?/m, "Updated automatically from the repo on `<normalized>`.\n")
    .trim();
}

async function main() {
  const mode = process.argv[2] ?? "check";
  if (!["check", "sync"].includes(mode)) {
    console.error(`Unknown mode "${mode}". Use "check" or "sync".`);
    process.exit(1);
  }

  const mapPath = path.join(projectRoot, "Trading Forge System Map v2.md");
  const generatedJsonPath = path.join(projectRoot, "docs/system-topology.generated.json");
  const snapshot = await collectSystemTopology();
  const generatedSection = renderGeneratedTopologySection(snapshot);
  const mapDocument = await readFile(mapPath, "utf8");
  const existingSection = extractExistingGeneratedSection(mapDocument);
  const driftItems = [];

  if (!existingSection) {
    driftItems.push("System map is missing the generated topology section");
  } else if (normalizeSection(existingSection) !== normalizeSection(generatedSection)) {
    driftItems.push("Generated topology section is stale relative to the current repo state");
  }

  if (!snapshot.manualTradingViewDeployOnly) {
    driftItems.push("TradingView deployment gate is no longer manual-only in implementation");
  }

  if (mode === "sync") {
    await writeFile(mapPath, upsertGeneratedSection(mapDocument, generatedSection), "utf8");
    await writeFile(generatedJsonPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  }

  const result = {
    status: driftItems.length === 0 ? "ok" : "drift",
    checkedAt: new Date().toISOString(),
    mapPath: "Trading Forge System Map v2.md",
    generatedSectionPresent: Boolean(existingSection),
    manualTradingViewDeployOnly: snapshot.manualTradingViewDeployOnly,
    driftItems,
    snapshot,
  };

  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "ok" && mode === "check") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});

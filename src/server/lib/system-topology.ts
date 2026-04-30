import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type WorkflowState =
  | "production-active"
  | "built-inactive"
  | "broken"
  | "external-non-core";
export type WorkflowHealthStatus = "healthy" | "failing" | "stale" | "unknown";
export type WorkflowSourceStatus = "valid" | "invalid" | "missing";
export type WorkflowLiveSyncStatus = "live-aligned" | "awaiting-redeploy" | "source-missing";

export interface WorkflowInventoryItem {
  canonicalName: string;
  variants: string[];
  preferredName: string;
  state: WorkflowState;
  healthStatus: WorkflowHealthStatus;
  failureCount: number | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  sourceStatus: WorkflowSourceStatus;
  sourceValidationErrors: string[];
  liveSyncStatus: WorkflowLiveSyncStatus;
  notes: string[];
}

export interface WorkflowInventorySummary {
  filesScanned: number;
  canonicalCount: number;
  duplicateVariantsCollapsed: number;
  byState: Record<WorkflowState, number>;
  items: WorkflowInventoryItem[];
}

interface LiveWorkflowManifestEntry {
  id: string;
  name: string;
  active: boolean;
  healthStatus?: WorkflowHealthStatus;
  failureCount?: number;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  notes?: string[];
}

interface LiveWorkflowManifest {
  generatedAt: string;
  source: string;
  description?: string;
  workflows: LiveWorkflowManifestEntry[];
}

export type SubsystemProofMode = "active-runtime" | "offline-readiness" | "experimental-runtime";
export type OwnershipBoundary = "repo-runtime" | "external-integrated" | "offline-exported";
export type LearningBoundary = "none" | "pre_deploy_only" | "advisory_only";
export type CurrentSubsystemState =
  | "inactive_preprod"
  | "partially_active_preprod"
  | "active_preprod"
  | "experimental_preprod";
export type LaunchTargetState =
  | "runtime_proven_autonomous"
  | "runtime_proven_manual_gate"
  | "experimental_challenger";
export type ProductionTargetState =
  | "production_autonomous"
  | "production_manual_gate"
  | "production_experimental"
  | "production_not_intended";
export type ClosedLoopStatus =
  | "not_collecting"
  | "collecting_only"
  | "learning_active"
  | "learning_blocked"
  | "shadow_experimental";
export type AutomationStatus = "complete" | "incomplete" | "experimental" | "inactive";
export type CoverageStatus = "complete" | "incomplete";
export type LearningStatus =
  | "active"
  | "collecting_only"
  | "blocked"
  | "not_applicable"
  | "experimental";
export type FailureVisibilityStatus = "complete" | "incomplete";
export type LearningMode =
  | "active_learning"
  | "deterministic_instrumented"
  | "manual_gate_only"
  | "shadow_experimental";
export type SubsystemOperatingClass =
  | "adaptive"
  | "deterministic_instrumented"
  | "manual_gated";
export type AuthorityStatus = "correct" | "incorrect";
export type DeploymentAuthority =
  | "autonomous_pre_deploy"
  | "human_release"
  | "human_rule_verification"
  | "experimental_opt_in"
  | "manual_activation";
export type SubsystemCriticality = "critical" | "important" | "advisory";
export type SubsystemProofStatus =
  | "runtime-proven"
  | "partially-proven"
  | "offline-by-design"
  | "experimental"
  | "drifted";

export interface SystemSubsystemRegistryEntry {
  id: string;
  domain: string;
  owner_surface: string;
  automation_mode: string;
  manual_gate: string;
  runtime_state: string;
  decision_authority: string;
  automation_scope: string;
  data_sources: string[];
  reads_from: string[];
  writes_to: string[];
  audit_tables: string[];
  audit_actions: string[];
  metrics_surfaces: string[];
  telemetry_sources: string[];
  scheduler_jobs: string[];
  routes: string[];
  engine_subsystems: string[];
  database_tables: string[];
  learning_from: string[];
  learning_assets: string[];
  learning_writes_to: string[];
  failure_visibility: string[];
  recovery_mode: string;
  health_check: string;
  status: string;
  self_evolving: boolean;
  proof_mode: SubsystemProofMode;
  freshness_signals: string[];
  evidence_queries: string[];
  ownership_boundary: OwnershipBoundary;
  learning_boundary: LearningBoundary;
  deployment_authority: DeploymentAuthority;
  criticality: SubsystemCriticality;
  current_state?: CurrentSubsystemState;
  launch_target_state?: LaunchTargetState;
  production_target_state?: ProductionTargetState;
  authoritative_runtime?: string;
  activation_blockers?: string[];
  activation_criteria?: string[];
  runtime_evidence?: string[];
  data_collection_coverage?: string[];
  closed_loop_status?: ClosedLoopStatus;
  production_blockers?: string[];
  production_criteria?: string[];
  required_evidence?: string[];
  production_authority_boundary?: string;
}

export interface RegistrySubsystemSummary {
  id: string;
  domain: string;
  ownerSurface: string;
  runtimeState: string;
  automationMode: string;
  decisionAuthority: string;
  manualGate: string;
  selfEvolving: boolean;
  proofMode: SubsystemProofMode;
  proofStatus: SubsystemProofStatus;
  ownershipBoundary: OwnershipBoundary;
  learningBoundary: LearningBoundary;
  deploymentAuthority: DeploymentAuthority;
  criticality: SubsystemCriticality;
  currentState: CurrentSubsystemState;
  launchTargetState: LaunchTargetState;
  productionTargetState: ProductionTargetState;
  authoritativeRuntime: string;
  activationBlockers: string[];
  activationCriteria: string[];
  runtimeEvidence: string[];
  dataCollectionCoverage: string[];
  closedLoopStatus: ClosedLoopStatus;
  learningMode: LearningMode;
  operatingClass: SubsystemOperatingClass;
  launchReady: boolean;
  automationStatus: AutomationStatus;
  dataCollectionStatus: CoverageStatus;
  auditabilityStatus: CoverageStatus;
  failureVisibilityStatus: FailureVisibilityStatus;
  learningStatus: LearningStatus;
  authorityStatus: AuthorityStatus;
  preprodProofStatus: SubsystemProofStatus;
  productionBlockers: string[];
  productionCriteria: string[];
  requiredEvidence: string[];
  productionAuthorityBoundary: string;
  routes: string[];
  schedulerJobs: string[];
  healthCheck: string;
  freshnessSignals: string[];
  evidenceQueries: string[];
  coverageGaps: string[];
}

export interface EngineSubsystemSummary {
  id: string;
  ownerSubsystemId: string | null;
  ownerDomain: string | null;
  runtimeState: string;
  proofStatus: SubsystemProofStatus;
  manualGate: string;
  learningMode: LearningMode | "unmapped";
  operatingClass: SubsystemOperatingClass | "unmapped";
  criticality: SubsystemCriticality | "unmapped";
  coverageGaps: string[];
}

export interface RegistryCoverageReport {
  registryEntries: number;
  autonomousSubsystems: number;
  selfEvolvingSubsystems: number;
  proofStatusCounts: Record<SubsystemProofStatus, number>;
  runtimeStateCounts: Record<string, number>;
  currentStateCounts: Record<CurrentSubsystemState, number>;
  launchTargetCounts: Record<LaunchTargetState, number>;
  closedLoopCounts: Record<ClosedLoopStatus, number>;
  learningModeCounts: Record<LearningMode, number>;
  operatingClassCounts: Record<SubsystemOperatingClass, number>;
  manualGates: string[];
  coveredCounts: {
    routes: number;
    schedulerJobs: number;
    engineSubsystems: number;
    databaseTables: number;
  };
  missingRoutes: string[];
  missingSchedulerJobs: string[];
  missingEngineSubsystems: string[];
  missingDatabaseTables: string[];
  subsystemsMissingAudit: string[];
  subsystemsMissingAuditActions: string[];
  subsystemsMissingMetrics: string[];
  subsystemsMissingTelemetrySources: string[];
  subsystemsMissingLearning: string[];
  subsystemsMissingLearningPersistence: string[];
  subsystemsMissingDecisionAuthority: string[];
  subsystemsMissingFailureVisibility: string[];
  subsystemsMissingRecoveryMode: string[];
  subsystemsMissingProofMode: string[];
  subsystemsMissingFreshnessSignals: string[];
  subsystemsMissingEvidenceQueries: string[];
  subsystemsMissingOwnershipBoundary: string[];
  subsystemsMissingLearningBoundary: string[];
  subsystemsMissingDeploymentAuthority: string[];
  subsystemsMissingCriticality: string[];
  manualGateViolations: string[];
  preprodIntegrity: {
    status: "complete" | "incomplete";
    automationComplete: number;
    dataCollectionComplete: number;
    auditabilityComplete: number;
    failureVisibilityComplete: number;
    authorityCorrect: number;
    learningActive: number;
    incompleteSubsystems: string[];
  };
  productionConvergence: {
    status: "blocked" | "ready";
    targetStateCounts: Record<ProductionTargetState, number>;
    readySubsystems: string[];
    blockedSubsystems: string[];
    experimentalSubsystems: string[];
    shadowWorkflowCandidates: string[];
    inactiveWorkflowCandidates: string[];
    brokenWorkflowBlockers: string[];
    failingWorkflowBlockers: string[];
    sourceMissingWorkflowBlockers: string[];
    redeployWorkflowBlockers: string[];
    staleWorkflowBlockers: string[];
    runtimeControlBlockers: string[];
    blockers: string[];
  };
  readiness: {
    launchReady: boolean;
    blockers: string[];
    launchBlockedSubsystems: string[];
    inactiveByDesignSubsystems: string[];
    collectingOnlySubsystems: string[];
    learningBlockedSubsystems: string[];
    onlyTradingViewManualAtLaunch: boolean;
    runtimeControlBlockers: string[];
  };
  subsystems: RegistrySubsystemSummary[];
  engineSubsystems: EngineSubsystemSummary[];
}

export interface ProductionRuntimeControls {
  enforced: boolean;
  mode: "advisory" | "strict";
  status: "ready" | "blocked";
  blockers: string[];
  checkedControls: string[];
}

export interface SystemTopologySnapshot {
  generatedAt: string;
  manualTradingViewDeployOnly: boolean;
  runtimeControls: ProductionRuntimeControls;
  counts: {
    routes: number;
    schedulerJobs: number;
    workflowFiles: number;
    canonicalWorkflows: number;
    engineSubsystems: number;
    databaseTables: number;
    registrySubsystems: number;
  };
  routes: string[];
  schedulerJobs: string[];
  workflows: string[];
  workflowSummary: WorkflowInventorySummary;
  engineSubsystems: string[];
  databaseTables: string[];
  registryCoverage: RegistryCoverageReport;
  subsystemSummaries: RegistrySubsystemSummary[];
  engineSubsystemSummaries: EngineSubsystemSummary[];
  manualGates: string[];
}

export interface SystemMapCheckResult {
  status: "ok" | "drift" | "error";
  checkedAt: string;
  mapPath: string;
  generatedSectionPresent: boolean;
  manualTradingViewDeployOnly: boolean;
  driftItems: string[];
  snapshot?: SystemTopologySnapshot;
  registryCoverage?: RegistryCoverageReport;
  workflowSummary?: WorkflowInventorySummary;
  error?: string;
}

export interface StaticReadinessSubsystem {
  id: string;
  status: "ready" | "blocked" | "manual-gated" | "experimental";
  productionTargetState: ProductionTargetState;
  manualGate: string;
  selfEvolving: boolean;
  learningMode: LearningMode;
  operatingClass: SubsystemOperatingClass;
  deploymentAuthority: DeploymentAuthority;
  blockers: string[];
  requiredEvidence: string[];
}

export interface StaticReadinessReport {
  generatedAt: string;
  overallStatus: "ready" | "blocked";
  onlyTradingViewManualAtLaunch: boolean;
  blockers: string[];
  subsystemCounts: {
    total: number;
    ready: number;
    blocked: number;
    manualGated: number;
    experimental: number;
  };
  subsystems: StaticReadinessSubsystem[];
}

const GENERATED_START = "<!-- BEGIN GENERATED: topology -->";
const GENERATED_END = "<!-- END GENERATED: topology -->";
const REGISTRY_PATH = "docs/system-subsystem-registry.json";

const BROKEN_WORKFLOW_TITLES = new Set<string>();
const STRICT_PRODUCTION_READINESS_ENV = "TF_STRICT_PRODUCTION_READINESS";
const RUNTIME_STAGE_ENV = "TF_RUNTIME_STAGE";

interface WorkflowHealthMetadata {
  healthStatus: WorkflowHealthStatus;
  failureCount: number | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  notes: string[];
}

interface WorkflowSourceValidation {
  status: WorkflowSourceStatus;
  errors: string[];
}

export function getProjectRoot(): string {
  return path.resolve(import.meta.dirname, "../../..");
}

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

function basenameWithoutExt(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

async function listFiles(dirPath: string, extension: string): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

async function listDirectories(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("__") && name !== "tests" && name !== "indicators" && name !== "strategies" && name !== "specs")
    .sort((a, b) => a.localeCompare(b));
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function extractRegexMatches(source: string, regex: RegExp, groupIndex = 1): string[] {
  const matches: string[] = [];
  for (const match of source.matchAll(regex)) {
    const value = match[groupIndex];
    if (value) matches.push(value);
  }
  return uniqueSorted(matches);
}

function splitWorkflowStem(stem: string): { title: string; id: string } {
  const idx = stem.lastIndexOf("_");
  const suffix = idx >= 0 ? stem.slice(idx + 1) : "";
  if (idx > 0 && /^[A-Za-z0-9]{8,}$/.test(suffix)) {
    return { title: stem.slice(0, idx), id: suffix };
  }
  return { title: stem, id: "" };
}

function normalizeWorkflowTitle(title: string): string {
  return title
    .replace(/â€”/g, " ")
    .replace(/—/g, " ")
    .replace(/[()]/g, " ")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function workflowTitleKey(canonicalName: string): string {
  const { title } = splitWorkflowStem(canonicalName);
  return title.toLowerCase();
}

function workflowVariantScore(name: string): number {
  let score = 0;
  if (!name.includes("â")) score += 2;
  if (!name.includes("___")) score += 1;
  if (!name.includes("__")) score += 1;
  if (/[()]/.test(name)) score += 1;
  return score;
}

function pickPreferredWorkflowVariant(variants: string[]): string {
  return [...variants].sort((left, right) => {
    const scoreDiff = workflowVariantScore(right) - workflowVariantScore(left);
    if (scoreDiff !== 0) return scoreDiff;
    return left.localeCompare(right);
  })[0]!;
}

export function canonicalizeWorkflowStem(stem: string): string {
  const { title, id } = splitWorkflowStem(stem);
  const normalizedTitle = normalizeWorkflowTitle(title);
  return id ? `${normalizedTitle}_${id}` : normalizedTitle;
}

export function classifyWorkflowState(canonicalName: string, isActive = false): WorkflowState {
  const title = workflowTitleKey(canonicalName);
  if (BROKEN_WORKFLOW_TITLES.has(title)) return "broken";
  if (isActive) return "production-active";
  return "built-inactive";
}

function parseWorkflowDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeWorkflowHealth(
  metadata: Partial<WorkflowHealthMetadata> | undefined,
  isActive: boolean,
): WorkflowHealthMetadata {
  const notes = [...(metadata?.notes ?? [])];
  const healthStatus = metadata?.healthStatus ?? "unknown";
  const lastSuccessAt = metadata?.lastSuccessAt ?? null;
  const lastFailureAt = metadata?.lastFailureAt ?? null;
  const lastSuccessMs = parseWorkflowDate(lastSuccessAt);
  const missingFreshEvidence = isActive && lastSuccessMs == null;
  const explicitFailure = healthStatus === "failing";
  const inferredStatus: WorkflowHealthStatus = missingFreshEvidence
    ? "unknown"
    : explicitFailure
      ? "failing"
      : "healthy";

  if (missingFreshEvidence) {
    notes.push("No live success timestamp is available for this active workflow.");
  } else if (explicitFailure) {
    notes.push("Latest workflow failure is newer than success evidence and requires attention.");
  } else if (healthStatus === "unknown") {
    notes.push("Workflow health inferred from live success timestamp.");
  }

  return {
    healthStatus: inferredStatus,
    failureCount: metadata?.failureCount ?? null,
    lastSuccessAt,
    lastFailureAt,
    notes,
  };
}

function extractCodeNodeReferences(jsCode: string): string[] {
  return uniqueSorted(extractRegexMatches(jsCode, /\$\('([^']+)'\)/g));
}

function validateWorkflowHttpRequestNode(node: Record<string, unknown>, errors: string[]): void {
  const parameters = (node.parameters ?? {}) as Record<string, unknown>;
  const nodeName = String(node.name ?? "unknown-node");
  const url = String(parameters.url ?? "");
  const jsonBody = parameters.jsonBody;
  const sendsJsonBody = parameters.sendBody === true || parameters.specifyBody === "json";

  if (url.includes("/api/sse/broadcast")) {
    if (sendsJsonBody && typeof jsonBody !== "string") {
      errors.push(`${nodeName}: missing jsonBody for SSE broadcast`);
      return;
    }
    if (typeof jsonBody === "string" && /JSON\.stringify\(\s*\)/.test(jsonBody)) {
      errors.push(`${nodeName}: JSON.stringify() called without a payload`);
    }
  }

  if (url.includes("/api/agent/scout-ideas")) {
    if (typeof jsonBody !== "string") {
      errors.push(`${nodeName}: scout-ideas request missing JSON body`);
      return;
    }
    if (/\$json\.ideas/.test(jsonBody) && !/"ideas"\s*:/.test(jsonBody) && !/ideas\s*:/.test(jsonBody)) {
      errors.push(`${nodeName}: scout-ideas payload posts a raw array instead of { ideas: [...] }`);
    }
  }
}

async function validateWorkflowSourceFile(filePath: string): Promise<WorkflowSourceValidation> {
  try {
    const source = await readFile(filePath, "utf8");
    const parsed = JSON.parse(source) as {
      nodes?: Array<Record<string, unknown>>;
      connections?: Record<string, { main?: Array<Array<{ node?: string }>> }>;
      activeVersion?: {
        nodes?: Array<Record<string, unknown>>;
        connections?: Record<string, { main?: Array<Array<{ node?: string }>> }>;
      };
    };
    const nodes = parsed.nodes ?? parsed.activeVersion?.nodes ?? [];
    const connections = parsed.connections ?? parsed.activeVersion?.connections ?? {};
    const errors: string[] = [];
    const nodeNames = new Set(
      nodes
        .map((node) => String(node.name ?? "").trim())
        .filter((name) => name.length > 0),
    );

    for (const [sourceNode, branches] of Object.entries(connections)) {
      if (!nodeNames.has(sourceNode)) {
        errors.push(`Connection references missing source node "${sourceNode}"`);
      }
      for (const branch of branches.main ?? []) {
        for (const target of branch) {
          if (target.node && !nodeNames.has(target.node)) {
            errors.push(`Connection from "${sourceNode}" targets missing node "${target.node}"`);
          }
        }
      }
    }

    for (const node of nodes) {
      const nodeType = String(node.type ?? "");
      const nodeName = String(node.name ?? "unknown-node");
      if (nodeType === "n8n-nodes-base.code") {
        const jsCode = String(((node.parameters ?? {}) as Record<string, unknown>).jsCode ?? "");
        try {
          // Parse only; execution depends on n8n runtime bindings.
          new Function(jsCode);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`${nodeName}: invalid code node syntax (${message})`);
        }
        for (const ref of extractCodeNodeReferences(jsCode)) {
          if (!nodeNames.has(ref)) {
            errors.push(`${nodeName}: code node references missing node "${ref}"`);
          }
        }
      }

      if (nodeType === "n8n-nodes-base.httpRequest") {
        validateWorkflowHttpRequestNode(node, errors);
      }
    }

    return {
      status: errors.length === 0 ? "valid" : "invalid",
      errors: uniqueSorted(errors),
    };
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String((error as NodeJS.ErrnoException).code) : "";
    if (code === "ENOENT") {
      return { status: "missing", errors: [] };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { status: "invalid", errors: [`Unable to validate workflow source (${message})`] };
  }
}

export function buildWorkflowInventoryFromStems(
  stems: string[],
  activeCanonicalNames: ReadonlySet<string> = new Set(),
  workflowHealth: ReadonlyMap<string, Partial<WorkflowHealthMetadata>> = new Map(),
  workflowSourceValidation: ReadonlyMap<string, WorkflowSourceValidation> = new Map(),
): WorkflowInventorySummary {
  const grouped = new Map<string, string[]>();

  for (const stem of stems) {
    const canonical = canonicalizeWorkflowStem(stem);
    const existing = grouped.get(canonical) ?? [];
    existing.push(stem);
    grouped.set(canonical, existing);
  }

  const items = [...grouped.entries()]
    .map(([canonicalName, variants]) => {
      const isActive = activeCanonicalNames.has(canonicalName);
      const health = normalizeWorkflowHealth(workflowHealth.get(canonicalName), isActive);
      const sourceValidation = workflowSourceValidation.get(canonicalName) ?? { status: "missing" as const, errors: [] };
      const forcedBroken = health.healthStatus === "failing" || sourceValidation.status === "invalid";
      const liveSyncStatus: WorkflowLiveSyncStatus = sourceValidation.status === "missing"
        ? "source-missing"
        : health.healthStatus === "failing" && sourceValidation.status === "valid"
          ? "awaiting-redeploy"
          : "live-aligned";
      const notes = [...health.notes];
      if (liveSyncStatus === "awaiting-redeploy") {
        notes.push("Repo export validates cleanly; live n8n workflow still reports failing and should be redeployed.");
      }
      if (sourceValidation.status === "invalid") {
        notes.push(...sourceValidation.errors.map((error) => `Source validation: ${error}`));
      }
      if (sourceValidation.status === "missing") {
        notes.push("Workflow export is missing from workflows/n8n.");
      }

      return {
        canonicalName,
        variants: [...variants].sort((a, b) => a.localeCompare(b)),
        preferredName: pickPreferredWorkflowVariant(variants),
        state: forcedBroken ? "broken" : classifyWorkflowState(canonicalName, isActive),
        healthStatus: health.healthStatus,
        failureCount: health.failureCount,
        lastSuccessAt: health.lastSuccessAt,
        lastFailureAt: health.lastFailureAt,
        sourceStatus: sourceValidation.status,
        sourceValidationErrors: [...sourceValidation.errors],
        liveSyncStatus,
        notes,
      };
    })
    .sort((a, b) => a.canonicalName.localeCompare(b.canonicalName));

  const byState: Record<WorkflowState, number> = {
    "production-active": 0,
    "built-inactive": 0,
    "broken": 0,
    "external-non-core": 0,
  };

  for (const item of items) {
    byState[item.state] += 1;
  }

  return {
    filesScanned: stems.length,
    canonicalCount: items.length,
    duplicateVariantsCollapsed: stems.length - items.length,
    byState,
    items,
  };
}

async function collectRoutes(rootDir: string): Promise<string[]> {
  const indexPath = path.join(rootDir, "src/server/index.ts");
  const indexSource = await readFile(indexPath, "utf8");
  const mountedRoutes = extractRegexMatches(indexSource, /app\.use\("([^"]+)",/g);
  const healthRoutes = extractRegexMatches(indexSource, /app\.get\("([^"]+)",/g);
  return uniqueSorted([...mountedRoutes, ...healthRoutes].filter((route) => route.startsWith("/api/")));
}

async function collectSchedulerJobs(rootDir: string): Promise<string[]> {
  const schedulerPath = path.join(rootDir, "src/server/scheduler.ts");
  const schedulerSource = await readFile(schedulerPath, "utf8");
  return extractRegexMatches(schedulerSource, /registerJob\("([^"]+)"/g);
}

async function collectWorkflowInventory(rootDir: string): Promise<WorkflowInventorySummary> {
  const liveManifestPath = path.join(rootDir, "docs/trading-forge-live-workflows.json");
  const workflowDir = path.join(rootDir, "workflows/n8n");
  const workflowFiles = await listFiles(workflowDir, ".json");
  const workflowFileByCanonicalName = new Map<string, string>(
    workflowFiles.map((fileName) => [canonicalizeWorkflowStem(basenameWithoutExt(fileName)), path.join(workflowDir, fileName)]),
  );
  try {
    const manifestSource = await readFile(liveManifestPath, "utf8");
    const manifest = JSON.parse(manifestSource) as LiveWorkflowManifest;
    const stems = manifest.workflows.map((workflow) =>
      canonicalizeWorkflowStem(`${workflow.name}_${workflow.id}`),
    );
    const activeCanonicalNames = new Set<string>(
      manifest.workflows
        .filter((workflow) => workflow.active)
        .map((workflow) => canonicalizeWorkflowStem(`${workflow.name}_${workflow.id}`)),
    );
    const workflowHealth = new Map<string, Partial<WorkflowHealthMetadata>>(
      manifest.workflows.map((workflow) => [
        canonicalizeWorkflowStem(`${workflow.name}_${workflow.id}`),
        {
          healthStatus: workflow.healthStatus,
          failureCount: workflow.failureCount ?? null,
          lastSuccessAt: workflow.lastSuccessAt ?? null,
          lastFailureAt: workflow.lastFailureAt ?? null,
          notes: workflow.notes ?? [],
        },
      ]),
    );
    const workflowSourceValidation = new Map<string, WorkflowSourceValidation>();
    await Promise.all(manifest.workflows.map(async (workflow) => {
      const stem = `${workflow.name}_${workflow.id}`;
      const canonicalName = canonicalizeWorkflowStem(stem);
      const filePath = workflowFileByCanonicalName.get(canonicalName) ?? path.join(workflowDir, `${stem}.json`);
      workflowSourceValidation.set(canonicalName, await validateWorkflowSourceFile(filePath));
    }));
    return buildWorkflowInventoryFromStems(stems, activeCanonicalNames, workflowHealth, workflowSourceValidation);
  } catch (error) {
    if (!(error instanceof Error) || "code" in error === false || (error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const stems = workflowFiles.map((fileName) => basenameWithoutExt(fileName));
  const activeCanonicalNames = new Set<string>();
  const workflowSourceValidation = new Map<string, WorkflowSourceValidation>();

  await Promise.all(workflowFiles.map(async (fileName) => {
    const filePath = path.join(workflowDir, fileName);
    const source = await readFile(filePath, "utf8");
    const parsed = JSON.parse(source) as { active?: boolean; data?: { active?: boolean } };
    const isActive = parsed.active ?? parsed.data?.active ?? false;
    workflowSourceValidation.set(
      canonicalizeWorkflowStem(basenameWithoutExt(fileName)),
      await validateWorkflowSourceFile(filePath),
    );
    if (isActive) {
      activeCanonicalNames.add(canonicalizeWorkflowStem(basenameWithoutExt(fileName)));
    }
  }));

  return buildWorkflowInventoryFromStems(stems, activeCanonicalNames, new Map(), workflowSourceValidation);
}

async function collectEngineSubsystems(rootDir: string): Promise<string[]> {
  const engineDir = path.join(rootDir, "src/engine");
  const directories = await listDirectories(engineDir);
  const topLevelModules = (await listFiles(engineDir, ".py"))
    .map((fileName) => basenameWithoutExt(fileName))
    .filter((name) =>
      [
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
      ].includes(name),
    );
  return uniqueSorted([...directories, ...topLevelModules]);
}

async function collectDatabaseTables(rootDir: string): Promise<string[]> {
  const schemaPath = path.join(rootDir, "src/server/db/schema.ts");
  const schemaSource = await readFile(schemaPath, "utf8");
  return extractRegexMatches(schemaSource, /pgTable\(\s*"([^"]+)"/g);
}

async function detectManualDeployGuard(rootDir: string): Promise<boolean> {
  const strategiesPath = path.join(rootDir, "src/server/routes/strategies.ts");
  const lifecyclePath = path.join(rootDir, "src/server/services/lifecycle-service.ts");
  const [strategiesSource, lifecycleSource] = await Promise.all([
    readFile(strategiesPath, "utf8"),
    readFile(lifecyclePath, "utf8"),
  ]);

  return (
    strategiesSource.includes('post("/:id/deploy"') &&
    strategiesSource.includes('Use /api/strategies/:id/deploy') &&
    strategiesSource.includes('"strategy.deploy_approved"') &&
    lifecycleSource.includes("Only manual release authority can promote DEPLOY_READY -> DEPLOYED") &&
    lifecycleSource.includes("The system NEVER auto-deploys to TradingView")
  );
}

async function loadSubsystemRegistry(rootDir: string): Promise<SystemSubsystemRegistryEntry[]> {
  const registryPath = path.join(rootDir, REGISTRY_PATH);
  const raw = await readFile(registryPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("System subsystem registry must be a JSON array");
  }

  return parsed.map((entry) => {
    const candidate = entry as Partial<SystemSubsystemRegistryEntry>;
    if (
      !candidate.id ||
      !candidate.automation_mode ||
      !candidate.runtime_state ||
      !candidate.decision_authority ||
      !candidate.recovery_mode ||
      !candidate.proof_mode ||
      !candidate.ownership_boundary ||
      !candidate.learning_boundary ||
      !candidate.deployment_authority ||
      !candidate.criticality
    ) {
      throw new Error(
        "System subsystem registry entries require id, automation_mode, runtime_state, decision_authority, recovery_mode, proof_mode, ownership_boundary, learning_boundary, deployment_authority, and criticality",
      );
    }

    return {
      id: candidate.id,
      domain: candidate.domain ?? "unknown",
      owner_surface: candidate.owner_surface ?? "unknown",
      automation_mode: candidate.automation_mode,
      manual_gate: candidate.manual_gate ?? "none",
      runtime_state: candidate.runtime_state,
      decision_authority: candidate.decision_authority,
      automation_scope: candidate.automation_scope ?? "",
      data_sources: candidate.data_sources ?? [],
      reads_from: candidate.reads_from ?? [],
      writes_to: candidate.writes_to ?? [],
      audit_tables: candidate.audit_tables ?? [],
      audit_actions: candidate.audit_actions ?? [],
      metrics_surfaces: candidate.metrics_surfaces ?? [],
      telemetry_sources: candidate.telemetry_sources ?? [],
      scheduler_jobs: candidate.scheduler_jobs ?? [],
      routes: candidate.routes ?? [],
      engine_subsystems: candidate.engine_subsystems ?? [],
      database_tables: candidate.database_tables ?? [],
      learning_from: candidate.learning_from ?? [],
      learning_assets: candidate.learning_assets ?? [],
      learning_writes_to: candidate.learning_writes_to ?? [],
      failure_visibility: candidate.failure_visibility ?? [],
      recovery_mode: candidate.recovery_mode,
      health_check: candidate.health_check ?? "",
      status: candidate.status ?? "unknown",
      self_evolving: candidate.self_evolving ?? false,
      proof_mode: candidate.proof_mode,
      freshness_signals: candidate.freshness_signals ?? [],
      evidence_queries: candidate.evidence_queries ?? [],
      ownership_boundary: candidate.ownership_boundary,
      learning_boundary: candidate.learning_boundary,
      deployment_authority: candidate.deployment_authority,
      criticality: candidate.criticality,
      current_state: candidate.current_state,
      launch_target_state: candidate.launch_target_state,
      production_target_state: candidate.production_target_state,
      authoritative_runtime: candidate.authoritative_runtime,
      activation_blockers: candidate.activation_blockers,
      activation_criteria: candidate.activation_criteria,
      runtime_evidence: candidate.runtime_evidence,
      data_collection_coverage: candidate.data_collection_coverage,
      closed_loop_status: candidate.closed_loop_status,
      production_blockers: candidate.production_blockers,
      production_criteria: candidate.production_criteria,
      required_evidence: candidate.required_evidence,
      production_authority_boundary: candidate.production_authority_boundary,
    };
  }).map((entry) => ({
    ...entry,
    current_state: entry.current_state ?? defaultCurrentState(entry),
    launch_target_state: entry.launch_target_state ?? defaultLaunchTargetState(entry),
    production_target_state: entry.production_target_state ?? defaultProductionTargetState(entry),
    authoritative_runtime: entry.authoritative_runtime ?? defaultAuthoritativeRuntime(entry),
    activation_blockers: entry.activation_blockers ?? defaultActivationBlockers(entry),
    activation_criteria: entry.activation_criteria ?? defaultActivationCriteria(entry),
    runtime_evidence: entry.runtime_evidence ?? defaultRuntimeEvidence(entry),
    data_collection_coverage: entry.data_collection_coverage ?? defaultDataCollectionCoverage(entry),
    closed_loop_status: entry.closed_loop_status ?? defaultClosedLoopStatus(entry),
    production_blockers: entry.production_blockers ?? defaultProductionBlockers(entry),
    production_criteria: entry.production_criteria ?? defaultProductionCriteria(entry),
    required_evidence: entry.required_evidence ?? defaultRequiredEvidence(entry),
    production_authority_boundary: entry.production_authority_boundary ?? defaultProductionAuthorityBoundary(entry),
  }));
}

function isAutonomousMode(mode: string): boolean {
  return mode === "autonomous" || mode === "manual-gated";
}

function isBlank(value: string | null | undefined): boolean {
  return !value || value.trim().length === 0;
}

function defaultCurrentState(entry: Pick<SystemSubsystemRegistryEntry, "runtime_state" | "proof_mode">): CurrentSubsystemState {
  if (entry.runtime_state === "inactive" || entry.proof_mode === "offline-readiness") {
    return "inactive_preprod";
  }
  if (entry.runtime_state === "experimental" || entry.proof_mode === "experimental-runtime") {
    return "experimental_preprod";
  }
  return "active_preprod";
}

function defaultLaunchTargetState(entry: Pick<SystemSubsystemRegistryEntry, "manual_gate" | "runtime_state">): LaunchTargetState {
  if (entry.runtime_state === "experimental") return "experimental_challenger";
  return entry.manual_gate === "tradingview_deploy"
    ? "runtime_proven_manual_gate"
    : "runtime_proven_autonomous";
}

function defaultProductionTargetState(
  entry: Pick<SystemSubsystemRegistryEntry, "manual_gate" | "runtime_state" | "deployment_authority">,
): ProductionTargetState {
  if (entry.runtime_state === "experimental" || entry.deployment_authority === "experimental_opt_in") {
    return "production_experimental";
  }
  return entry.manual_gate === "tradingview_deploy"
    ? "production_manual_gate"
    : "production_autonomous";
}

function defaultAuthoritativeRuntime(entry: Pick<SystemSubsystemRegistryEntry, "owner_surface">): string {
  if (entry.owner_surface.includes("node")) return "node-python";
  return entry.owner_surface;
}

function defaultRuntimeEvidence(entry: SystemSubsystemRegistryEntry): string[] {
  return uniqueSorted([
    ...entry.audit_actions,
    ...entry.metrics_surfaces,
    ...entry.telemetry_sources,
    ...entry.freshness_signals,
  ]).filter((value) => !isBlank(value));
}

function defaultDataCollectionCoverage(entry: SystemSubsystemRegistryEntry): string[] {
  return uniqueSorted([
    ...entry.data_sources,
    ...entry.reads_from,
    ...entry.writes_to,
    ...entry.database_tables,
  ]).filter((value) => !isBlank(value));
}

function defaultClosedLoopStatus(entry: SystemSubsystemRegistryEntry): ClosedLoopStatus {
  if (entry.runtime_state === "experimental") return "shadow_experimental";
  if (!entry.self_evolving) return "not_collecting";
  if (entry.learning_from.length === 0 || entry.learning_writes_to.length === 0) {
    return "learning_blocked";
  }
  if (entry.runtime_state === "inactive" || entry.proof_mode === "offline-readiness") {
    return "collecting_only";
  }
  return "learning_active";
}

function defaultProductionCriteria(entry: SystemSubsystemRegistryEntry): string[] {
  const criteria = [
    "pre-production runtime proof remains stable",
    "data collection stays complete across critical handoffs",
    "failure visibility remains wired",
    "authority boundary remains enforced",
  ];

  if (entry.self_evolving) criteria.push("learning loop remains bounded to pre-deploy authority");
  if (entry.manual_gate === "tradingview_deploy") criteria.push("TradingView deployment stays human-approved");
  if (entry.runtime_state === "experimental") criteria.push("experimental governance remains isolated from release authority");

  return uniqueSorted(criteria);
}

function defaultRequiredEvidence(entry: SystemSubsystemRegistryEntry): string[] {
  return uniqueSorted([
    ...defaultRuntimeEvidence(entry),
    ...entry.evidence_queries,
    ...entry.freshness_signals,
  ]).filter((value) => !isBlank(value));
}

function defaultProductionAuthorityBoundary(entry: SystemSubsystemRegistryEntry): string {
  if (entry.manual_gate === "tradingview_deploy") {
    return "Autonomous through DEPLOY_READY; TradingView release remains human-controlled.";
  }
  if (entry.deployment_authority === "experimental_opt_in" || entry.runtime_state === "experimental") {
    return "Experimental only; may collect evidence but cannot widen release authority.";
  }
  return "Autonomous in pre-production up to the pre-deploy boundary with no independent release authority.";
}

function defaultProductionBlockers(entry: SystemSubsystemRegistryEntry): string[] {
  const blockers = [...defaultActivationBlockers(entry)];
  if (entry.runtime_state === "inactive") blockers.push("inactive_preprod");
  return uniqueSorted(blockers);
}

function determineAutomationStatus(entry: SystemSubsystemRegistryEntry): AutomationStatus {
  if (entry.runtime_state === "inactive") return "inactive";
  if (entry.runtime_state === "experimental") return "experimental";
  return isAutonomousMode(entry.automation_mode) ? "complete" : "incomplete";
}

function determineDataCollectionStatus(entry: SystemSubsystemRegistryEntry, coverageGaps: string[]): CoverageStatus {
  return coverageGaps.includes("missing-data-collection-coverage") ? "incomplete" : "complete";
}

function determineAuditabilityStatus(coverageGaps: string[]): CoverageStatus {
  const auditGapPrefixes = [
    "missing-audit-tables",
    "missing-audit-actions",
    "missing-metrics-surfaces",
    "missing-telemetry-sources",
    "missing-failure-visibility",
    "missing-recovery-mode",
  ];
  return coverageGaps.some((gap) => auditGapPrefixes.includes(gap)) ? "incomplete" : "complete";
}

function determineFailureVisibilityStatus(coverageGaps: string[]): FailureVisibilityStatus {
  const failureGapPrefixes = [
    "missing-failure-visibility",
    "missing-metrics-surfaces",
    "missing-telemetry-sources",
    "missing-freshness-signals",
    "missing-evidence-queries",
  ];
  return coverageGaps.some((gap) => failureGapPrefixes.includes(gap)) ? "incomplete" : "complete";
}

function determineLearningStatus(entry: SystemSubsystemRegistryEntry): LearningStatus {
  if (entry.runtime_state === "experimental") return "experimental";
  if (!entry.self_evolving) return "not_applicable";
  if (entry.closed_loop_status === "learning_blocked") return "blocked";
  if (entry.closed_loop_status === "collecting_only") return "collecting_only";
  return "active";
}

function determineLearningMode(entry: SystemSubsystemRegistryEntry): LearningMode {
  if (entry.runtime_state === "experimental") return "shadow_experimental";
  if (entry.manual_gate === "tradingview_deploy") return "manual_gate_only";
  if (entry.self_evolving) return "active_learning";
  return "deterministic_instrumented";
}

function determineOperatingClass(entry: SystemSubsystemRegistryEntry): SubsystemOperatingClass {
  if (entry.manual_gate === "tradingview_deploy") return "manual_gated";
  if (entry.self_evolving && entry.runtime_state !== "experimental") return "adaptive";
  return "deterministic_instrumented";
}

function determineAuthorityStatus(entry: SystemSubsystemRegistryEntry, coverageGaps: string[]): AuthorityStatus {
  const authorityGaps = [
    "invalid-tradingview-deployment-authority",
    "invalid-tradingview-manual-gate",
    "missing-deployment-authority",
    "missing-decision-authority",
  ];
  return coverageGaps.some((gap) => authorityGaps.includes(gap)) ? "incorrect" : "correct";
}

function defaultActivationCriteria(entry: SystemSubsystemRegistryEntry): string[] {
  const criteria = [
    "runtime evidence persisted",
    "failure visibility wired",
    "freshness signals available",
  ];

  if (entry.routes.length > 0) criteria.push("route contract reachable");
  if (entry.scheduler_jobs.length > 0) criteria.push("scheduler jobs healthy");
  if (entry.self_evolving) criteria.push("learning loop affects downstream behavior");

  return uniqueSorted(criteria);
}

function defaultActivationBlockers(entry: SystemSubsystemRegistryEntry): string[] {
  const blockers: string[] = [];

  if (entry.runtime_state === "inactive") blockers.push("inactive_until_launch");
  if (entry.runtime_state === "experimental") blockers.push("experimental_governance");
  if (entry.manual_gate !== "none" && entry.manual_gate !== "tradingview_deploy") {
    blockers.push(`manual_gate:${entry.manual_gate}`);
  }
  if (entry.proof_mode === "offline-readiness") blockers.push("offline_proof_only");
  if (entry.self_evolving && entry.learning_from.length === 0) blockers.push("missing_learning_inputs");
  if (entry.self_evolving && entry.learning_writes_to.length === 0) blockers.push("missing_learning_outputs");

  return uniqueSorted(blockers);
}

function determineExpectedProofMode(runtimeState: string): SubsystemProofMode {
  if (runtimeState === "inactive") return "offline-readiness";
  if (runtimeState === "experimental") return "experimental-runtime";
  return "active-runtime";
}

function determineSubsystemProofStatus(entry: SystemSubsystemRegistryEntry, gaps: string[]): SubsystemProofStatus {
  if (gaps.length > 0) return "drifted";
  if (entry.proof_mode === "offline-readiness" || entry.runtime_state === "inactive") {
    return "offline-by-design";
  }
  if (entry.proof_mode === "experimental-runtime" || entry.runtime_state === "experimental") {
    return "experimental";
  }
  if (entry.proof_mode === "active-runtime") {
    return "runtime-proven";
  }
  return "partially-proven";
}

function buildSubsystemCoverageGaps(entry: SystemSubsystemRegistryEntry): string[] {
  const gaps: string[] = [];

  if (isAutonomousMode(entry.automation_mode) && entry.audit_tables.length === 0) {
    gaps.push("missing-audit-tables");
  }
  if (isAutonomousMode(entry.automation_mode) && entry.audit_actions.length === 0) {
    gaps.push("missing-audit-actions");
  }
  if (isAutonomousMode(entry.automation_mode) && entry.metrics_surfaces.length === 0 && !entry.health_check) {
    gaps.push("missing-metrics-surfaces");
  }
  if (isAutonomousMode(entry.automation_mode) && entry.telemetry_sources.length === 0) {
    gaps.push("missing-telemetry-sources");
  }
  if (isBlank(entry.decision_authority)) {
    gaps.push("missing-decision-authority");
  }
  if (entry.failure_visibility.length === 0) {
    gaps.push("missing-failure-visibility");
  }
  if (isBlank(entry.recovery_mode)) {
    gaps.push("missing-recovery-mode");
  }
  if (entry.self_evolving && entry.learning_from.length === 0 && entry.learning_assets.length === 0) {
    gaps.push("missing-learning-inputs");
  }
  if (entry.self_evolving && entry.learning_writes_to.length === 0) {
    gaps.push("missing-learning-persistence");
  }
  if (isBlank(entry.proof_mode)) {
    gaps.push("missing-proof-mode");
  }
  if (entry.proof_mode === "active-runtime" && entry.freshness_signals.length === 0) {
    gaps.push("missing-freshness-signals");
  }
  if ((entry.proof_mode === "active-runtime" || entry.proof_mode === "experimental-runtime") && entry.evidence_queries.length === 0) {
    gaps.push("missing-evidence-queries");
  }
  if (isBlank(entry.ownership_boundary)) {
    gaps.push("missing-ownership-boundary");
  }
  if (entry.self_evolving && entry.learning_boundary === "none") {
    gaps.push("invalid-learning-boundary");
  }
  if (isBlank(entry.learning_boundary)) {
    gaps.push("missing-learning-boundary");
  }
  if (isBlank(entry.deployment_authority)) {
    gaps.push("missing-deployment-authority");
  }
  if (entry.manual_gate === "tradingview_deploy" && entry.deployment_authority !== "human_release") {
    gaps.push("invalid-tradingview-deployment-authority");
  }
  if (entry.runtime_state === "inactive" && entry.proof_mode !== "offline-readiness") {
    gaps.push("invalid-inactive-proof-mode");
  }
  if (entry.runtime_state === "experimental" && entry.proof_mode !== "experimental-runtime") {
    gaps.push("invalid-experimental-proof-mode");
  }
  if (entry.runtime_state === "active" && entry.proof_mode !== determineExpectedProofMode(entry.runtime_state)) {
    gaps.push("invalid-active-proof-mode");
  }
  if (isBlank(entry.criticality)) {
    gaps.push("missing-criticality");
  }
  if (entry.manual_gate === "tradingview_deploy" && entry.automation_mode !== "manual-gated") {
    gaps.push("invalid-tradingview-manual-gate");
  }
  if ((entry.proof_mode === "active-runtime" || entry.proof_mode === "experimental-runtime") && (entry.runtime_evidence?.length ?? 0) === 0) {
    gaps.push("missing-runtime-evidence");
  }
  if (entry.automation_mode !== "external-non-core" && (entry.data_collection_coverage?.length ?? 0) === 0) {
    gaps.push("missing-data-collection-coverage");
  }

  return gaps.sort((a, b) => a.localeCompare(b));
}

export function evaluateProductionRuntimeControls(env: NodeJS.ProcessEnv = process.env): ProductionRuntimeControls {
  const runtimeStage = String(env[RUNTIME_STAGE_ENV] ?? "").toLowerCase();
  const enforced = env.NODE_ENV === "production"
    || env[STRICT_PRODUCTION_READINESS_ENV] === "1"
    || runtimeStage === "preprod"
    || runtimeStage === "staging";
  const checkedControls = [
    "DATABASE_URL",
    "API_KEY",
    "N8N_BASE_URL",
    "N8N_API_KEY",
    "OTEL_EXPORTER_OTLP_ENDPOINT",
  ];

  if (!enforced) {
    return {
      enforced: false,
      mode: "advisory",
      status: "ready",
      blockers: [],
      checkedControls,
    };
  }

  const blockers = checkedControls
    .filter((control) => isBlank(env[control]))
    .map((control) => `missing-runtime-control:${control}`);

  return {
    enforced: true,
    mode: "strict",
    status: blockers.length === 0 ? "ready" : "blocked",
    blockers,
    checkedControls,
  };
}

export function evaluateRegistryCoverage(
  snapshotInput: Pick<SystemTopologySnapshot, "routes" | "schedulerJobs" | "engineSubsystems" | "databaseTables"> & {
    workflowSummary?: WorkflowInventorySummary;
    runtimeControls?: ProductionRuntimeControls;
  },
  registry: SystemSubsystemRegistryEntry[],
): RegistryCoverageReport {
  const normalizedRegistry = registry.map((entry) => ({
    ...entry,
    current_state: entry.current_state ?? defaultCurrentState(entry),
    launch_target_state: entry.launch_target_state ?? defaultLaunchTargetState(entry),
    production_target_state: entry.production_target_state ?? defaultProductionTargetState(entry),
    authoritative_runtime: entry.authoritative_runtime ?? defaultAuthoritativeRuntime(entry),
    activation_blockers: entry.activation_blockers ?? defaultActivationBlockers(entry),
    activation_criteria: entry.activation_criteria ?? defaultActivationCriteria(entry),
    runtime_evidence: entry.runtime_evidence ?? defaultRuntimeEvidence(entry),
    data_collection_coverage: entry.data_collection_coverage ?? defaultDataCollectionCoverage(entry),
    closed_loop_status: entry.closed_loop_status ?? defaultClosedLoopStatus(entry),
    production_blockers: entry.production_blockers ?? defaultProductionBlockers(entry),
    production_criteria: entry.production_criteria ?? defaultProductionCriteria(entry),
    required_evidence: entry.required_evidence ?? defaultRequiredEvidence(entry),
    production_authority_boundary: entry.production_authority_boundary ?? defaultProductionAuthorityBoundary(entry),
  }));

  const registryRoutes = uniqueSorted(normalizedRegistry.flatMap((entry) => entry.routes));
  const registrySchedulerJobs = uniqueSorted(normalizedRegistry.flatMap((entry) => entry.scheduler_jobs));
  const registryEngineSubsystems = uniqueSorted(normalizedRegistry.flatMap((entry) => entry.engine_subsystems));
  const registryDatabaseTables = uniqueSorted(normalizedRegistry.flatMap((entry) => entry.database_tables));

  const missingRoutes = snapshotInput.routes.filter((route) => !registryRoutes.includes(route));
  const missingSchedulerJobs = snapshotInput.schedulerJobs.filter((job) => !registrySchedulerJobs.includes(job));
  const missingEngineSubsystems = snapshotInput.engineSubsystems.filter((subsystem) => !registryEngineSubsystems.includes(subsystem));
  const missingDatabaseTables = snapshotInput.databaseTables.filter((table) => !registryDatabaseTables.includes(table));

  const autonomousEntries = normalizedRegistry.filter((entry) => isAutonomousMode(entry.automation_mode));
  const selfEvolvingEntries = normalizedRegistry.filter((entry) => entry.self_evolving);
  const runtimeStateCounts = normalizedRegistry.reduce<Record<string, number>>((counts, entry) => {
    counts[entry.runtime_state] = (counts[entry.runtime_state] ?? 0) + 1;
    return counts;
  }, {});
  const currentStateCounts = normalizedRegistry.reduce<Record<CurrentSubsystemState, number>>((counts, entry) => {
    counts[entry.current_state!] += 1;
    return counts;
  }, {
    inactive_preprod: 0,
    partially_active_preprod: 0,
    active_preprod: 0,
    experimental_preprod: 0,
  });
  const launchTargetCounts = normalizedRegistry.reduce<Record<LaunchTargetState, number>>((counts, entry) => {
    counts[entry.launch_target_state!] += 1;
    return counts;
  }, {
    runtime_proven_autonomous: 0,
    runtime_proven_manual_gate: 0,
    experimental_challenger: 0,
  });
  const productionTargetCounts = normalizedRegistry.reduce<Record<ProductionTargetState, number>>((counts, entry) => {
    counts[entry.production_target_state!] += 1;
    return counts;
  }, {
    production_autonomous: 0,
    production_manual_gate: 0,
    production_experimental: 0,
    production_not_intended: 0,
  });
  const closedLoopCounts = normalizedRegistry.reduce<Record<ClosedLoopStatus, number>>((counts, entry) => {
    counts[entry.closed_loop_status!] += 1;
    return counts;
  }, {
    not_collecting: 0,
    collecting_only: 0,
    learning_active: 0,
    learning_blocked: 0,
    shadow_experimental: 0,
  });
  const manualGates = uniqueSorted(
    normalizedRegistry
      .map((entry) => entry.manual_gate)
      .filter((gate) => gate && gate !== "none"),
  );

  const subsystemsMissingAudit = autonomousEntries
    .filter((entry) => entry.audit_tables.length === 0)
    .map((entry) => entry.id)
    .sort((a, b) => a.localeCompare(b));

  const subsystemsMissingAuditActions = autonomousEntries
    .filter((entry) => entry.audit_actions.length === 0)
    .map((entry) => entry.id)
    .sort((a, b) => a.localeCompare(b));

  const subsystemsMissingMetrics = autonomousEntries
    .filter((entry) => entry.metrics_surfaces.length === 0 && !entry.health_check)
    .map((entry) => entry.id)
    .sort((a, b) => a.localeCompare(b));

  const subsystemsMissingTelemetrySources = autonomousEntries
    .filter((entry) => entry.telemetry_sources.length === 0)
    .map((entry) => entry.id)
    .sort((a, b) => a.localeCompare(b));

  const subsystemsMissingLearning = selfEvolvingEntries
    .filter((entry) => entry.learning_from.length === 0 && entry.learning_assets.length === 0)
    .map((entry) => entry.id)
    .sort((a, b) => a.localeCompare(b));

  const subsystemsMissingLearningPersistence = selfEvolvingEntries
    .filter((entry) => entry.learning_writes_to.length === 0)
    .map((entry) => entry.id)
    .sort((a, b) => a.localeCompare(b));

  const subsystemsMissingDecisionAuthority = normalizedRegistry
    .filter((entry) => !entry.decision_authority)
    .map((entry) => entry.id)
    .sort((a, b) => a.localeCompare(b));

  const subsystemsMissingFailureVisibility = normalizedRegistry
    .filter((entry) => entry.failure_visibility.length === 0)
    .map((entry) => entry.id)
    .sort((a, b) => a.localeCompare(b));

  const subsystemsMissingRecoveryMode = normalizedRegistry
    .filter((entry) => !entry.recovery_mode)
    .map((entry) => entry.id)
    .sort((a, b) => a.localeCompare(b));

  const subsystemsMissingProofMode = normalizedRegistry
    .filter((entry) => isBlank(entry.proof_mode))
    .map((entry) => entry.id)
    .sort((a, b) => a.localeCompare(b));

  const subsystemsMissingFreshnessSignals = normalizedRegistry
    .filter((entry) => entry.proof_mode === "active-runtime" && entry.freshness_signals.length === 0)
    .map((entry) => entry.id)
    .sort((a, b) => a.localeCompare(b));

  const subsystemsMissingEvidenceQueries = normalizedRegistry
    .filter((entry) => (entry.proof_mode === "active-runtime" || entry.proof_mode === "experimental-runtime") && entry.evidence_queries.length === 0)
    .map((entry) => entry.id)
    .sort((a, b) => a.localeCompare(b));

  const subsystemsMissingOwnershipBoundary = normalizedRegistry
    .filter((entry) => isBlank(entry.ownership_boundary))
    .map((entry) => entry.id)
    .sort((a, b) => a.localeCompare(b));

  const subsystemsMissingLearningBoundary = normalizedRegistry
    .filter((entry) => isBlank(entry.learning_boundary) || (entry.self_evolving && entry.learning_boundary === "none"))
    .map((entry) => entry.id)
    .sort((a, b) => a.localeCompare(b));

  const subsystemsMissingDeploymentAuthority = normalizedRegistry
    .filter((entry) => isBlank(entry.deployment_authority))
    .map((entry) => entry.id)
    .sort((a, b) => a.localeCompare(b));

  const subsystemsMissingCriticality = normalizedRegistry
    .filter((entry) => isBlank(entry.criticality))
    .map((entry) => entry.id)
    .sort((a, b) => a.localeCompare(b));

  const manualGateViolations = normalizedRegistry
    .filter((entry) =>
      (entry.manual_gate === "tradingview_deploy" && entry.automation_mode !== "manual-gated")
      || (entry.manual_gate === "tradingview_deploy" && entry.deployment_authority !== "human_release"),
    )
    .map((entry) => entry.id)
    .sort((a, b) => a.localeCompare(b));

  const subsystems = normalizedRegistry
    .map((entry) => {
      const coverageGaps = buildSubsystemCoverageGaps(entry);
      return {
        id: entry.id,
        domain: entry.domain,
        ownerSurface: entry.owner_surface,
        runtimeState: entry.runtime_state,
        automationMode: entry.automation_mode,
        decisionAuthority: entry.decision_authority,
        manualGate: entry.manual_gate,
        selfEvolving: entry.self_evolving,
        proofMode: entry.proof_mode,
        proofStatus: determineSubsystemProofStatus(entry, coverageGaps),
        ownershipBoundary: entry.ownership_boundary,
        learningBoundary: entry.learning_boundary,
        deploymentAuthority: entry.deployment_authority,
        criticality: entry.criticality,
        currentState: entry.current_state!,
        launchTargetState: entry.launch_target_state!,
        productionTargetState: entry.production_target_state!,
        authoritativeRuntime: entry.authoritative_runtime!,
        activationBlockers: entry.activation_blockers!,
        activationCriteria: entry.activation_criteria!,
        runtimeEvidence: entry.runtime_evidence!,
        dataCollectionCoverage: entry.data_collection_coverage!,
        closedLoopStatus: entry.closed_loop_status!,
        learningMode: determineLearningMode(entry),
        operatingClass: determineOperatingClass(entry),
        launchReady:
          coverageGaps.length === 0
          && entry.activation_blockers!.length === 0
          && entry.current_state !== "inactive_preprod"
          && entry.current_state !== "experimental_preprod",
        automationStatus: determineAutomationStatus(entry),
        dataCollectionStatus: determineDataCollectionStatus(entry, coverageGaps),
        auditabilityStatus: determineAuditabilityStatus(coverageGaps),
        failureVisibilityStatus: determineFailureVisibilityStatus(coverageGaps),
        learningStatus: determineLearningStatus(entry),
        authorityStatus: determineAuthorityStatus(entry, coverageGaps),
        preprodProofStatus: determineSubsystemProofStatus(entry, coverageGaps),
        productionBlockers: uniqueSorted([
          ...entry.production_blockers!,
          ...coverageGaps,
        ]),
        productionCriteria: entry.production_criteria!,
        requiredEvidence: entry.required_evidence!,
        productionAuthorityBoundary: entry.production_authority_boundary!,
        routes: entry.routes,
        schedulerJobs: entry.scheduler_jobs,
        healthCheck: entry.health_check,
        freshnessSignals: entry.freshness_signals,
        evidenceQueries: entry.evidence_queries,
        coverageGaps,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const proofStatusCounts = subsystems.reduce<Record<SubsystemProofStatus, number>>(
    (counts, entry) => {
      counts[entry.proofStatus] += 1;
      return counts;
    },
    {
      "runtime-proven": 0,
      "partially-proven": 0,
      "offline-by-design": 0,
      experimental: 0,
      drifted: 0,
    },
  );
  const learningModeCounts = subsystems.reduce<Record<LearningMode, number>>(
    (counts, entry) => {
      counts[entry.learningMode] += 1;
      return counts;
    },
    {
      active_learning: 0,
      deterministic_instrumented: 0,
      manual_gate_only: 0,
      shadow_experimental: 0,
    },
  );
  const operatingClassCounts = subsystems.reduce<Record<SubsystemOperatingClass, number>>(
    (counts, entry) => {
      counts[entry.operatingClass] += 1;
      return counts;
    },
    {
      adaptive: 0,
      deterministic_instrumented: 0,
      manual_gated: 0,
    },
  );

  const subsystemByEngine = new Map<string, RegistrySubsystemSummary>();
  for (const subsystem of subsystems) {
      const owner = normalizedRegistry.find((entry) => entry.id === subsystem.id);
    for (const engineSubsystem of owner?.engine_subsystems ?? []) {
      if (!subsystemByEngine.has(engineSubsystem)) {
        subsystemByEngine.set(engineSubsystem, subsystem);
      }
    }
  }

  const engineSubsystems = snapshotInput.engineSubsystems
    .map((engineSubsystem) => {
      const owner = subsystemByEngine.get(engineSubsystem);
      if (!owner) {
        return {
          id: engineSubsystem,
          ownerSubsystemId: null,
          ownerDomain: null,
          runtimeState: "unmapped",
          proofStatus: "drifted" as const,
          manualGate: "none",
          learningMode: "unmapped" as const,
          operatingClass: "unmapped" as const,
          criticality: "unmapped" as const,
          coverageGaps: ["missing-registry-owner"],
        };
      }

      return {
        id: engineSubsystem,
        ownerSubsystemId: owner.id,
        ownerDomain: owner.domain,
        runtimeState: owner.runtimeState,
        proofStatus: owner.proofStatus,
        manualGate: owner.manualGate,
        learningMode: owner.learningMode,
        operatingClass: owner.operatingClass,
        criticality: owner.criticality,
        coverageGaps: [...owner.coverageGaps],
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const launchBlockedSubsystems = subsystems
    .filter((entry) => !entry.launchReady)
    .map((entry) => entry.id)
    .sort((a, b) => a.localeCompare(b));

  const inactiveByDesignSubsystems = subsystems
    .filter((entry) => entry.currentState === "inactive_preprod")
    .map((entry) => entry.id)
    .sort((a, b) => a.localeCompare(b));

  const collectingOnlySubsystems = subsystems
    .filter((entry) => entry.closedLoopStatus === "collecting_only")
    .map((entry) => entry.id)
    .sort((a, b) => a.localeCompare(b));

  const learningBlockedSubsystems = subsystems
    .filter((entry) => entry.closedLoopStatus === "learning_blocked")
    .map((entry) => entry.id)
    .sort((a, b) => a.localeCompare(b));

  const preprodIntegrity = {
    status: subsystems.every((entry) =>
      entry.automationStatus !== "incomplete"
      && entry.dataCollectionStatus === "complete"
      && entry.auditabilityStatus === "complete"
      && entry.failureVisibilityStatus === "complete"
      && entry.authorityStatus === "correct"
      && entry.coverageGaps.length === 0,
    ) ? "complete" as const : "incomplete" as const,
    automationComplete: subsystems.filter((entry) => entry.automationStatus === "complete").length,
    dataCollectionComplete: subsystems.filter((entry) => entry.dataCollectionStatus === "complete").length,
    auditabilityComplete: subsystems.filter((entry) => entry.auditabilityStatus === "complete").length,
    failureVisibilityComplete: subsystems.filter((entry) => entry.failureVisibilityStatus === "complete").length,
    authorityCorrect: subsystems.filter((entry) => entry.authorityStatus === "correct").length,
    learningActive: subsystems.filter((entry) => entry.learningStatus === "active").length,
    incompleteSubsystems: subsystems
      .filter((entry) =>
        entry.automationStatus === "incomplete"
        || entry.dataCollectionStatus === "incomplete"
        || entry.auditabilityStatus === "incomplete"
        || entry.failureVisibilityStatus === "incomplete"
        || entry.authorityStatus === "incorrect"
        || entry.coverageGaps.length > 0,
      )
      .map((entry) => entry.id)
      .sort((a, b) => a.localeCompare(b)),
  };

  const readinessBlockers = uniqueSorted([
    ...subsystems
      .filter((entry) => entry.activationBlockers.length > 0)
      .flatMap((entry) => entry.activationBlockers.map((blocker) => `${entry.id}:${blocker}`)),
    ...subsystems
      .filter((entry) => entry.coverageGaps.length > 0)
      .flatMap((entry) => entry.coverageGaps.map((gap) => `${entry.id}:${gap}`)),
    ...(snapshotInput.runtimeControls?.blockers ?? []),
  ]);

  const onlyTradingViewManualAtLaunch = normalizedRegistry.every((entry) =>
    entry.launch_target_state !== "runtime_proven_manual_gate" || entry.manual_gate === "tradingview_deploy",
  );

  const shadowWorkflowCandidates: string[] = [];
  const inactiveWorkflowCandidates = snapshotInput.workflowSummary?.items
    ?.filter((item) => item.state === "built-inactive")
    .map((item) => item.canonicalName)
    .sort((a, b) => a.localeCompare(b)) ?? [];
  const brokenWorkflowBlockers = snapshotInput.workflowSummary?.items
    ?.filter((item) => item.sourceStatus === "invalid")
    .map((item) => item.canonicalName)
    .sort((a, b) => a.localeCompare(b)) ?? [];
  const failingWorkflowBlockers = snapshotInput.workflowSummary?.items
    ?.filter((item) => item.healthStatus === "failing" && item.liveSyncStatus === "live-aligned")
    .map((item) => item.canonicalName)
    .sort((a, b) => a.localeCompare(b)) ?? [];
  const sourceMissingWorkflowBlockers = snapshotInput.workflowSummary?.items
    ?.filter((item) => item.liveSyncStatus === "source-missing")
    .map((item) => item.canonicalName)
    .sort((a, b) => a.localeCompare(b)) ?? [];
  const redeployWorkflowBlockers = snapshotInput.workflowSummary?.items
    ?.filter((item) => item.liveSyncStatus === "awaiting-redeploy")
    .map((item) => item.canonicalName)
    .sort((a, b) => a.localeCompare(b)) ?? [];
  const staleWorkflowBlockers = snapshotInput.workflowSummary?.items
    ?.filter((item) => item.healthStatus === "stale")
    .map((item) => item.canonicalName)
    .sort((a, b) => a.localeCompare(b)) ?? [];
  const unknownWorkflowBlockers = snapshotInput.workflowSummary?.items
    ?.filter((item) => item.state === "production-active" && item.healthStatus === "unknown")
    .map((item) => item.canonicalName)
    .sort((a, b) => a.localeCompare(b)) ?? [];
  const runtimeControlBlockers = snapshotInput.runtimeControls?.blockers ?? [];

  const productionReadySubsystems = subsystems
    .filter((entry) =>
      entry.productionTargetState !== "production_experimental"
      && entry.productionTargetState !== "production_not_intended"
      && entry.productionBlockers.length === 0,
    )
    .map((entry) => entry.id)
    .sort((a, b) => a.localeCompare(b));

  const productionBlockedSubsystems = subsystems
    .filter((entry) =>
      entry.productionTargetState !== "production_experimental"
      && entry.productionTargetState !== "production_not_intended"
      && entry.productionBlockers.length > 0,
    )
    .map((entry) => entry.id)
    .sort((a, b) => a.localeCompare(b));

  const experimentalSubsystems = subsystems
    .filter((entry) => entry.productionTargetState === "production_experimental")
    .map((entry) => entry.id)
    .sort((a, b) => a.localeCompare(b));

  const productionConvergenceBlockers = uniqueSorted([
    ...subsystems
      .filter((entry) =>
        entry.productionTargetState !== "production_experimental"
        && entry.productionTargetState !== "production_not_intended",
      )
      .flatMap((entry) => entry.productionBlockers.map((blocker) => `${entry.id}:${blocker}`)),
    ...shadowWorkflowCandidates.map((name) => `workflow-shadow:${name}`),
    ...inactiveWorkflowCandidates.map((name) => `workflow-inactive:${name}`),
    ...brokenWorkflowBlockers.map((name) => `workflow-broken:${name}`),
    ...failingWorkflowBlockers.map((name) => `workflow-failing:${name}`),
    ...sourceMissingWorkflowBlockers.map((name) => `workflow-source-missing:${name}`),
    ...redeployWorkflowBlockers.map((name) => `workflow-awaiting-redeploy:${name}`),
    ...staleWorkflowBlockers.map((name) => `workflow-stale:${name}`),
    ...unknownWorkflowBlockers.map((name) => `workflow-missing-evidence:${name}`),
    ...runtimeControlBlockers,
  ]);

  const productionConvergence: RegistryCoverageReport["productionConvergence"] = {
    status: productionConvergenceBlockers.length === 0 ? "ready" : "blocked",
    targetStateCounts: productionTargetCounts,
    readySubsystems: productionReadySubsystems,
    blockedSubsystems: productionBlockedSubsystems,
    experimentalSubsystems,
    shadowWorkflowCandidates,
    inactiveWorkflowCandidates,
    brokenWorkflowBlockers,
    failingWorkflowBlockers,
    sourceMissingWorkflowBlockers,
    redeployWorkflowBlockers,
    staleWorkflowBlockers,
    runtimeControlBlockers,
    blockers: productionConvergenceBlockers,
  };

  return {
    registryEntries: normalizedRegistry.length,
    autonomousSubsystems: autonomousEntries.length,
    selfEvolvingSubsystems: selfEvolvingEntries.length,
    proofStatusCounts,
    runtimeStateCounts,
    currentStateCounts,
    launchTargetCounts,
    closedLoopCounts,
    learningModeCounts,
    operatingClassCounts,
    manualGates,
    coveredCounts: {
      routes: snapshotInput.routes.length - missingRoutes.length,
      schedulerJobs: snapshotInput.schedulerJobs.length - missingSchedulerJobs.length,
      engineSubsystems: snapshotInput.engineSubsystems.length - missingEngineSubsystems.length,
      databaseTables: snapshotInput.databaseTables.length - missingDatabaseTables.length,
    },
    missingRoutes,
    missingSchedulerJobs,
    missingEngineSubsystems,
    missingDatabaseTables,
    subsystemsMissingAudit,
    subsystemsMissingAuditActions,
    subsystemsMissingMetrics,
    subsystemsMissingTelemetrySources,
    subsystemsMissingLearning,
    subsystemsMissingLearningPersistence,
    subsystemsMissingDecisionAuthority,
    subsystemsMissingFailureVisibility,
    subsystemsMissingRecoveryMode,
    subsystemsMissingProofMode,
    subsystemsMissingFreshnessSignals,
    subsystemsMissingEvidenceQueries,
    subsystemsMissingOwnershipBoundary,
    subsystemsMissingLearningBoundary,
    subsystemsMissingDeploymentAuthority,
    subsystemsMissingCriticality,
    manualGateViolations,
    preprodIntegrity,
    productionConvergence,
    readiness: {
      launchReady:
        readinessBlockers.length === 0
        && productionConvergenceBlockers.length === 0
        && onlyTradingViewManualAtLaunch,
      blockers: uniqueSorted([...readinessBlockers, ...productionConvergenceBlockers]),
      launchBlockedSubsystems,
      inactiveByDesignSubsystems,
      collectingOnlySubsystems,
      learningBlockedSubsystems,
      onlyTradingViewManualAtLaunch,
      runtimeControlBlockers,
    },
    subsystems,
    engineSubsystems,
  };
}

export async function collectSystemTopology(rootDir = getProjectRoot()): Promise<SystemTopologySnapshot> {
  const runtimeControls = evaluateProductionRuntimeControls();
  const [routes, schedulerJobs, workflowSummary, engineSubsystems, databaseTables, manualTradingViewDeployOnly, registry] =
    await Promise.all([
      collectRoutes(rootDir),
      collectSchedulerJobs(rootDir),
      collectWorkflowInventory(rootDir),
      collectEngineSubsystems(rootDir),
      collectDatabaseTables(rootDir),
      detectManualDeployGuard(rootDir),
      loadSubsystemRegistry(rootDir),
    ]);

  const registryCoverage = evaluateRegistryCoverage(
    { routes, schedulerJobs, workflowSummary, engineSubsystems, databaseTables, runtimeControls },
    registry,
  );

  return {
    generatedAt: new Date().toISOString(),
    manualTradingViewDeployOnly,
    runtimeControls,
    counts: {
      routes: routes.length,
      schedulerJobs: schedulerJobs.length,
      workflowFiles: workflowSummary.filesScanned,
      canonicalWorkflows: workflowSummary.canonicalCount,
      engineSubsystems: engineSubsystems.length,
      databaseTables: databaseTables.length,
      registrySubsystems: registry.length,
    },
    routes,
    schedulerJobs,
    workflows: workflowSummary.items.map((item) => item.canonicalName),
    workflowSummary,
    engineSubsystems,
    databaseTables,
    registryCoverage,
    subsystemSummaries: registryCoverage.subsystems,
    engineSubsystemSummaries: registryCoverage.engineSubsystems,
    manualGates: registryCoverage.manualGates,
  };
}

export function buildStaticReadinessReport(snapshot: SystemTopologySnapshot): StaticReadinessReport {
  const subsystems = snapshot.subsystemSummaries
    .map<StaticReadinessSubsystem>((entry) => {
      const status =
        entry.productionTargetState === "production_experimental"
          ? "experimental"
          : entry.manualGate === "tradingview_deploy"
            ? "manual-gated"
            : entry.productionBlockers.length === 0
              ? "ready"
              : "blocked";

      return {
        id: entry.id,
        status,
        productionTargetState: entry.productionTargetState,
        manualGate: entry.manualGate,
        selfEvolving: entry.selfEvolving,
        learningMode: entry.learningMode,
        operatingClass: entry.operatingClass,
        deploymentAuthority: entry.deploymentAuthority,
        blockers: [...entry.productionBlockers],
        requiredEvidence: [...entry.requiredEvidence],
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    generatedAt: snapshot.generatedAt,
    overallStatus: snapshot.registryCoverage.productionConvergence.status === "ready" ? "ready" : "blocked",
    onlyTradingViewManualAtLaunch: snapshot.registryCoverage.readiness.onlyTradingViewManualAtLaunch,
    blockers: [...snapshot.registryCoverage.productionConvergence.blockers],
    subsystemCounts: {
      total: subsystems.length,
      ready: subsystems.filter((entry) => entry.status === "ready").length,
      blocked: subsystems.filter((entry) => entry.status === "blocked").length,
      manualGated: subsystems.filter((entry) => entry.status === "manual-gated").length,
      experimental: subsystems.filter((entry) => entry.status === "experimental").length,
    },
    subsystems,
  };
}

function renderBulletList(values: string[]): string {
  if (values.length === 0) return "- None";
  return values.map((value) => `- \`${value}\``).join("\n");
}

function renderWorkflowStateSummary(summary: WorkflowInventorySummary): string {
  const healthCounts = summary.items.reduce<Record<WorkflowHealthStatus, number>>(
    (counts, item) => {
      counts[item.healthStatus] += 1;
      return counts;
    },
    { healthy: 0, failing: 0, stale: 0, unknown: 0 },
  );

  return [
    `- \`production-active\`: \`${summary.byState["production-active"]}\``,
    `- \`built-inactive\`: \`${summary.byState["built-inactive"]}\``,
    `- \`broken\`: \`${summary.byState["broken"]}\``,
    `- \`external-non-core\`: \`${summary.byState["external-non-core"]}\``,
    `- health \`healthy\`: \`${healthCounts.healthy}\``,
    `- health \`failing\`: \`${healthCounts.failing}\``,
    `- health \`stale\`: \`${healthCounts.stale}\``,
    `- health \`unknown\`: \`${healthCounts.unknown}\``,
  ].join("\n");
}

function renderRuntimeStateSummary(report: RegistryCoverageReport): string {
  const states = Object.entries(report.runtimeStateCounts).sort(([left], [right]) => left.localeCompare(right));
  if (states.length === 0) return "- None";
  return states.map(([state, count]) => `- \`${state}\`: \`${count}\``).join("\n");
}

function renderCurrentStateSummary(report: RegistryCoverageReport): string {
  const states = Object.entries(report.currentStateCounts).sort(([left], [right]) => left.localeCompare(right));
  return states.map(([state, count]) => `- \`${state}\`: \`${count}\``).join("\n");
}

function renderLaunchTargetSummary(report: RegistryCoverageReport): string {
  const states = Object.entries(report.launchTargetCounts).sort(([left], [right]) => left.localeCompare(right));
  return states.map(([state, count]) => `- \`${state}\`: \`${count}\``).join("\n");
}

function renderProductionTargetSummary(report: RegistryCoverageReport): string {
  const states = Object.entries(report.productionConvergence.targetStateCounts).sort(([left], [right]) => left.localeCompare(right));
  return states.map(([state, count]) => `- \`${state}\`: \`${count}\``).join("\n");
}

function renderClosedLoopSummary(report: RegistryCoverageReport): string {
  const states = Object.entries(report.closedLoopCounts).sort(([left], [right]) => left.localeCompare(right));
  return states.map(([state, count]) => `- \`${state}\`: \`${count}\``).join("\n");
}

function renderLearningModeSummary(report: RegistryCoverageReport): string {
  const states = Object.entries(report.learningModeCounts).sort(([left], [right]) => left.localeCompare(right));
  return states.map(([state, count]) => `- \`${state}\`: \`${count}\``).join("\n");
}

function renderOperatingClassSummary(report: RegistryCoverageReport): string {
  const states = Object.entries(report.operatingClassCounts).sort(([left], [right]) => left.localeCompare(right));
  return states.map(([state, count]) => `- \`${state}\`: \`${count}\``).join("\n");
}

function renderSubsystemSummaries(subsystems: RegistrySubsystemSummary[]): string {
  if (subsystems.length === 0) return "- None";
  return subsystems
    .map((entry) => {
      const gapSummary = entry.coverageGaps.length > 0 ? ` gaps=${entry.coverageGaps.join(",")}` : " gaps=none";
      const blockers = entry.activationBlockers.length > 0 ? entry.activationBlockers.join(",") : "none";
      const productionBlockers = entry.productionBlockers.length > 0 ? entry.productionBlockers.join(",") : "none";
      return `- \`${entry.id}\` class=\`${entry.operatingClass}\` learningMode=\`${entry.learningMode}\` current=\`${entry.currentState}\` target=\`${entry.productionTargetState}\` automation=\`${entry.automationStatus}\` data=\`${entry.dataCollectionStatus}\` audit=\`${entry.auditabilityStatus}\` failureVisibility=\`${entry.failureVisibilityStatus}\` learning=\`${entry.learningStatus}\` authority=\`${entry.authorityStatus}\` ready=\`${entry.launchReady}\` preprodBlockers=${blockers} productionBlockers=${productionBlockers}${gapSummary}`;
    })
    .join("\n");
}

function renderCoverageSummary(report: RegistryCoverageReport, snapshot: SystemTopologySnapshot): string {
  return [
    `- Registry subsystems tracked: \`${snapshot.counts.registrySubsystems}\``,
    `- Route coverage: \`${report.coveredCounts.routes}/${snapshot.counts.routes}\``,
    `- Scheduler coverage: \`${report.coveredCounts.schedulerJobs}/${snapshot.counts.schedulerJobs}\``,
    `- Engine coverage: \`${report.coveredCounts.engineSubsystems}/${snapshot.counts.engineSubsystems}\``,
    `- Database coverage: \`${report.coveredCounts.databaseTables}/${snapshot.counts.databaseTables}\``,
    `- Autonomous subsystems with audit coverage: \`${report.autonomousSubsystems - report.subsystemsMissingAudit.length}/${report.autonomousSubsystems}\``,
    `- Autonomous subsystems with audit actions: \`${report.autonomousSubsystems - report.subsystemsMissingAuditActions.length}/${report.autonomousSubsystems}\``,
    `- Autonomous subsystems with telemetry evidence: \`${report.autonomousSubsystems - report.subsystemsMissingTelemetrySources.length}/${report.autonomousSubsystems}\``,
    `- Active-runtime subsystems with freshness signals: \`${report.registryEntries - report.subsystemsMissingFreshnessSignals.length}/${report.registryEntries}\``,
    `- Runtime/experimental subsystems with evidence queries: \`${report.registryEntries - report.subsystemsMissingEvidenceQueries.length}/${report.registryEntries}\``,
    `- Self-evolving subsystems with learning inputs: \`${report.selfEvolvingSubsystems - report.subsystemsMissingLearning.length}/${report.selfEvolvingSubsystems}\``,
    `- Self-evolving subsystems with learning persistence: \`${report.selfEvolvingSubsystems - report.subsystemsMissingLearningPersistence.length}/${report.selfEvolvingSubsystems}\``,
    `- Failure visibility complete: \`${report.preprodIntegrity.failureVisibilityComplete}/${report.registryEntries}\``,
  ].join("\n");
}

function renderProofStatusSummary(report: RegistryCoverageReport): string {
  return [
    `- \`runtime-proven\`: \`${report.proofStatusCounts["runtime-proven"]}\``,
    `- \`partially-proven\`: \`${report.proofStatusCounts["partially-proven"]}\``,
    `- \`offline-by-design\`: \`${report.proofStatusCounts["offline-by-design"]}\``,
    `- \`experimental\`: \`${report.proofStatusCounts.experimental}\``,
    `- \`drifted\`: \`${report.proofStatusCounts.drifted}\``,
  ].join("\n");
}

function renderPreprodIntegritySummary(report: RegistryCoverageReport): string {
  return [
    `- Integrity status: \`${report.preprodIntegrity.status}\``,
    `- Automation complete: \`${report.preprodIntegrity.automationComplete}/${report.registryEntries}\``,
    `- Data collection complete: \`${report.preprodIntegrity.dataCollectionComplete}/${report.registryEntries}\``,
    `- Auditability complete: \`${report.preprodIntegrity.auditabilityComplete}/${report.registryEntries}\``,
    `- Failure visibility complete: \`${report.preprodIntegrity.failureVisibilityComplete}/${report.registryEntries}\``,
    `- Authority correct: \`${report.preprodIntegrity.authorityCorrect}/${report.registryEntries}\``,
    `- Learning active: \`${report.preprodIntegrity.learningActive}/${report.selfEvolvingSubsystems}\``,
    `- Incomplete subsystems: \`${report.preprodIntegrity.incompleteSubsystems.length}\``,
  ].join("\n");
}

function renderProductionConvergenceSummary(report: RegistryCoverageReport): string {
  return [
    `- Convergence status: \`${report.productionConvergence.status}\``,
    `- Ready subsystem targets: \`${report.productionConvergence.readySubsystems.length}\``,
    `- Blocked subsystem targets: \`${report.productionConvergence.blockedSubsystems.length}\``,
    `- Experimental subsystem targets: \`${report.productionConvergence.experimentalSubsystems.length}\``,
    `- Shadow workflow candidates: \`${report.productionConvergence.shadowWorkflowCandidates.length}\``,
    `- Inactive workflow candidates: \`${report.productionConvergence.inactiveWorkflowCandidates.length}\``,
    `- Broken workflow blockers: \`${report.productionConvergence.brokenWorkflowBlockers.length}\``,
    `- Failing workflow blockers: \`${report.productionConvergence.failingWorkflowBlockers.length}\``,
    `- Source-missing workflow blockers: \`${report.productionConvergence.sourceMissingWorkflowBlockers.length}\``,
    `- Awaiting redeploy workflow blockers: \`${report.productionConvergence.redeployWorkflowBlockers.length}\``,
    `- Stale workflow blockers: \`${report.productionConvergence.staleWorkflowBlockers.length}\``,
    `- Runtime control blockers: \`${report.productionConvergence.runtimeControlBlockers.length}\``,
  ].join("\n");
}

function renderEngineSubsystemSummaries(subsystems: EngineSubsystemSummary[]): string {
  if (subsystems.length === 0) return "- None";
  return subsystems
    .map((entry) => {
      const owner = entry.ownerSubsystemId ?? "unmapped";
      const gaps = entry.coverageGaps.length > 0 ? entry.coverageGaps.join(",") : "none";
      return `- \`${entry.id}\` owner=\`${owner}\` status=\`${entry.proofStatus}\` state=\`${entry.runtimeState}\` gaps=${gaps}`;
    })
    .join("\n");
}

function renderReadinessSummary(report: RegistryCoverageReport): string {
  return [
    `- Launch ready: \`${report.readiness.launchReady}\``,
    `- Only TradingView manual at launch: \`${report.readiness.onlyTradingViewManualAtLaunch}\``,
    `- Launch-blocked subsystems: \`${report.readiness.launchBlockedSubsystems.length}\``,
    `- Inactive by design: \`${report.readiness.inactiveByDesignSubsystems.length}\``,
    `- Collecting only: \`${report.readiness.collectingOnlySubsystems.length}\``,
    `- Learning blocked: \`${report.readiness.learningBlockedSubsystems.length}\``,
    `- Runtime control blockers: \`${report.readiness.runtimeControlBlockers.length}\``,
  ].join("\n");
}

export function renderGeneratedTopologySection(snapshot: SystemTopologySnapshot): string {
  return [
    GENERATED_START,
    "## Current Enforced Pre-Production State",
    "",
    `Updated automatically from the repo on \`${snapshot.generatedAt}\`.`,
    "",
    "- Platform lifecycle stage: `pre-production`",
    "- Runtime-proven means `proven in pre-production`, not production released.",
    `- Production runtime controls: \`${snapshot.runtimeControls.status}\` (${snapshot.runtimeControls.mode})`,
    "",
    `- TradingView deployment gate: \`${snapshot.manualTradingViewDeployOnly ? "manual-only" : "drift-detected"}\``,
    `- Manual gates declared: \`${snapshot.manualGates.join(", ") || "none"}\``,
    `- API routes tracked: \`${snapshot.counts.routes}\``,
    `- Scheduler jobs tracked: \`${snapshot.counts.schedulerJobs}\``,
    `- Current live Trading Forge n8n workflows tracked: \`${snapshot.counts.workflowFiles}\``,
    `- Canonical workflows tracked: \`${snapshot.counts.canonicalWorkflows}\``,
    `- Duplicate workflow variants collapsed: \`${snapshot.workflowSummary.duplicateVariantsCollapsed}\``,
    `- Engine subsystems tracked: \`${snapshot.counts.engineSubsystems}\``,
    `- Database tables tracked: \`${snapshot.counts.databaseTables}\``,
    "",
    "### Subsystem Runtime States",
    renderRuntimeStateSummary(snapshot.registryCoverage),
    "",
    "### Current Pre-Production States",
    renderCurrentStateSummary(snapshot.registryCoverage),
    "",
    "### Launch Target States",
    renderLaunchTargetSummary(snapshot.registryCoverage),
    "",
    "### Production Target States",
    renderProductionTargetSummary(snapshot.registryCoverage),
    "",
    "### Subsystem Operating Classes",
    renderOperatingClassSummary(snapshot.registryCoverage),
    "",
    "### Learning Modes",
    renderLearningModeSummary(snapshot.registryCoverage),
    "",
    "### Registry Coverage",
    renderCoverageSummary(snapshot.registryCoverage, snapshot),
    "",
    "### Proof Status",
    renderProofStatusSummary(snapshot.registryCoverage),
    "",
    "### Pre-Production Integrity",
    renderPreprodIntegritySummary(snapshot.registryCoverage),
    "",
    "### Production Convergence",
    renderProductionConvergenceSummary(snapshot.registryCoverage),
    "",
    "### Readiness Summary",
    renderReadinessSummary(snapshot.registryCoverage),
    "",
    "### Closed-Loop Status",
    renderClosedLoopSummary(snapshot.registryCoverage),
    "",
    "### Workflow States",
    renderWorkflowStateSummary(snapshot.workflowSummary),
    "",
    "### Subsystem Coverage Gaps",
    renderSubsystemSummaries(snapshot.subsystemSummaries),
    "",
    "### Engine Subsystem Deep Scan",
    renderEngineSubsystemSummaries(snapshot.engineSubsystemSummaries),
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

function upsertGeneratedSection(documentText: string, generatedSection: string): string {
  if (documentText.includes(GENERATED_START) && documentText.includes(GENERATED_END)) {
    const pattern = new RegExp(`${GENERATED_START}[\\s\\S]*?${GENERATED_END}`, "m");
    return documentText.replace(pattern, generatedSection);
  }

  const trimmed = documentText.trimEnd();
  return `${trimmed}\n\n${generatedSection}\n`;
}

function extractExistingGeneratedSection(documentText: string): string | null {
  if (!documentText.includes(GENERATED_START) || !documentText.includes(GENERATED_END)) {
    return null;
  }

  const pattern = new RegExp(`${GENERATED_START}[\\s\\S]*?${GENERATED_END}`, "m");
  const match = documentText.match(pattern);
  return match?.[0] ?? null;
}

function normalizeSection(section: string): string {
  return section
    .replace(/\r\n/g, "\n")
    .replace(/^Updated automatically from the repo on `[^`]+`\.\n?/m, "Updated automatically from the repo on `<normalized>`.\n")
    .trim();
}

function buildDriftItems(snapshot: SystemTopologySnapshot, existingSection: string | null, generatedSection: string): string[] {
  const driftItems: string[] = [];

  if (!existingSection) {
    driftItems.push("System map is missing the generated topology section");
  } else if (normalizeSection(existingSection) !== normalizeSection(generatedSection)) {
    driftItems.push("Generated topology section is stale relative to the current repo state");
  }

  if (!snapshot.manualTradingViewDeployOnly) {
    driftItems.push("TradingView deployment gate is no longer manual-only in implementation");
  }

  if (snapshot.registryCoverage.missingRoutes.length > 0) {
    driftItems.push(`Registry is missing ${snapshot.registryCoverage.missingRoutes.length} API route mappings`);
  }
  if (snapshot.registryCoverage.missingSchedulerJobs.length > 0) {
    driftItems.push(`Registry is missing ${snapshot.registryCoverage.missingSchedulerJobs.length} scheduler job mappings`);
  }
  if (snapshot.registryCoverage.missingEngineSubsystems.length > 0) {
    driftItems.push(`Registry is missing ${snapshot.registryCoverage.missingEngineSubsystems.length} engine subsystem mappings`);
  }
  if (snapshot.registryCoverage.missingDatabaseTables.length > 0) {
    driftItems.push(`Registry is missing ${snapshot.registryCoverage.missingDatabaseTables.length} database table mappings`);
  }
  if (snapshot.registryCoverage.subsystemsMissingAudit.length > 0) {
    driftItems.push(`Autonomous subsystem registry entries missing audit surfaces: ${snapshot.registryCoverage.subsystemsMissingAudit.join(", ")}`);
  }
  if (snapshot.registryCoverage.subsystemsMissingAuditActions.length > 0) {
    driftItems.push(`Autonomous subsystem registry entries missing audit actions: ${snapshot.registryCoverage.subsystemsMissingAuditActions.join(", ")}`);
  }
  if (snapshot.registryCoverage.subsystemsMissingMetrics.length > 0) {
    driftItems.push(`Autonomous subsystem registry entries missing metrics surfaces: ${snapshot.registryCoverage.subsystemsMissingMetrics.join(", ")}`);
  }
  if (snapshot.registryCoverage.subsystemsMissingTelemetrySources.length > 0) {
    driftItems.push(`Autonomous subsystem registry entries missing telemetry sources: ${snapshot.registryCoverage.subsystemsMissingTelemetrySources.join(", ")}`);
  }
  if (snapshot.registryCoverage.subsystemsMissingLearning.length > 0) {
    driftItems.push(`Self-evolving subsystem registry entries missing learning hooks: ${snapshot.registryCoverage.subsystemsMissingLearning.join(", ")}`);
  }
  if (snapshot.registryCoverage.subsystemsMissingLearningPersistence.length > 0) {
    driftItems.push(`Self-evolving subsystem registry entries missing learning persistence: ${snapshot.registryCoverage.subsystemsMissingLearningPersistence.join(", ")}`);
  }
  if (snapshot.registryCoverage.subsystemsMissingDecisionAuthority.length > 0) {
    driftItems.push(`Subsystem registry entries missing decision authority: ${snapshot.registryCoverage.subsystemsMissingDecisionAuthority.join(", ")}`);
  }
  if (snapshot.registryCoverage.subsystemsMissingFailureVisibility.length > 0) {
    driftItems.push(`Subsystem registry entries missing failure visibility: ${snapshot.registryCoverage.subsystemsMissingFailureVisibility.join(", ")}`);
  }
  if (snapshot.registryCoverage.subsystemsMissingRecoveryMode.length > 0) {
    driftItems.push(`Subsystem registry entries missing recovery mode: ${snapshot.registryCoverage.subsystemsMissingRecoveryMode.join(", ")}`);
  }
  if (snapshot.registryCoverage.subsystemsMissingProofMode.length > 0) {
    driftItems.push(`Subsystem registry entries missing proof mode: ${snapshot.registryCoverage.subsystemsMissingProofMode.join(", ")}`);
  }
  if (snapshot.registryCoverage.subsystemsMissingFreshnessSignals.length > 0) {
    driftItems.push(`Active-runtime subsystem registry entries missing freshness signals: ${snapshot.registryCoverage.subsystemsMissingFreshnessSignals.join(", ")}`);
  }
  if (snapshot.registryCoverage.subsystemsMissingEvidenceQueries.length > 0) {
    driftItems.push(`Runtime subsystem registry entries missing evidence queries: ${snapshot.registryCoverage.subsystemsMissingEvidenceQueries.join(", ")}`);
  }
  if (snapshot.registryCoverage.subsystemsMissingOwnershipBoundary.length > 0) {
    driftItems.push(`Subsystem registry entries missing ownership boundary: ${snapshot.registryCoverage.subsystemsMissingOwnershipBoundary.join(", ")}`);
  }
  if (snapshot.registryCoverage.subsystemsMissingLearningBoundary.length > 0) {
    driftItems.push(`Self-evolving subsystem registry entries missing valid learning boundary: ${snapshot.registryCoverage.subsystemsMissingLearningBoundary.join(", ")}`);
  }
  if (snapshot.registryCoverage.subsystemsMissingDeploymentAuthority.length > 0) {
    driftItems.push(`Subsystem registry entries missing deployment authority: ${snapshot.registryCoverage.subsystemsMissingDeploymentAuthority.join(", ")}`);
  }
  if (snapshot.registryCoverage.subsystemsMissingCriticality.length > 0) {
    driftItems.push(`Subsystem registry entries missing criticality: ${snapshot.registryCoverage.subsystemsMissingCriticality.join(", ")}`);
  }
  if (snapshot.registryCoverage.manualGateViolations.length > 0) {
    driftItems.push(`Subsystem registry entries violate manual gate rules: ${snapshot.registryCoverage.manualGateViolations.join(", ")}`);
  }
  return driftItems;
}

export async function syncSystemMapArtifacts(rootDir = getProjectRoot()): Promise<SystemMapCheckResult> {
  const mapPath = path.join(rootDir, "Trading Forge System Map v2.md");
  const topologyPath = path.join(rootDir, "docs", "system-topology.generated.json");
  const readinessPath = path.join(rootDir, "docs", "system-readiness.generated.json");
  const snapshot = await collectSystemTopology(rootDir);
  const readinessReport = buildStaticReadinessReport(snapshot);
  const generatedSection = renderGeneratedTopologySection(snapshot);
  const existingDocument = await readFile(mapPath, "utf8");
  const nextDocument = upsertGeneratedSection(existingDocument, generatedSection);
  const driftItems = buildDriftItems(snapshot, generatedSection, generatedSection);

  await writeFile(mapPath, nextDocument, "utf8");
  await writeFile(topologyPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await writeFile(readinessPath, `${JSON.stringify(readinessReport, null, 2)}\n`, "utf8");

  return {
    status: driftItems.length === 0 ? "ok" : "drift",
    checkedAt: new Date().toISOString(),
    mapPath: toPosix(path.relative(rootDir, mapPath)),
    generatedSectionPresent: true,
    manualTradingViewDeployOnly: snapshot.manualTradingViewDeployOnly,
    driftItems,
    snapshot,
    registryCoverage: snapshot.registryCoverage,
    workflowSummary: snapshot.workflowSummary,
  };
}

export async function checkSystemMapDrift(rootDir = getProjectRoot()): Promise<SystemMapCheckResult> {
  const mapPath = path.join(rootDir, "Trading Forge System Map v2.md");

  try {
    const snapshot = await collectSystemTopology(rootDir);
    const generatedSection = renderGeneratedTopologySection(snapshot);
    const existingDocument = await readFile(mapPath, "utf8");
    const existingSection = extractExistingGeneratedSection(existingDocument);
    const driftItems = buildDriftItems(snapshot, existingSection, generatedSection);

    return {
      status: driftItems.length === 0 ? "ok" : "drift",
      checkedAt: new Date().toISOString(),
      mapPath: toPosix(path.relative(rootDir, mapPath)),
      generatedSectionPresent: Boolean(existingSection),
      manualTradingViewDeployOnly: snapshot.manualTradingViewDeployOnly,
      driftItems,
      snapshot,
      registryCoverage: snapshot.registryCoverage,
      workflowSummary: snapshot.workflowSummary,
    };
  } catch (error) {
    return {
      status: "error",
      checkedAt: new Date().toISOString(),
      mapPath: toPosix(path.relative(rootDir, mapPath)),
      generatedSectionPresent: false,
      manualTradingViewDeployOnly: false,
      driftItems: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

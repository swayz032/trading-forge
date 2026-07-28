import { MODEL_CONFIGS, type ModelRole } from "../../services/model-router.js";

export interface EvidenceVaultWorker {
  id: ModelRole;
  name: string;
  provider: "openai" | "ollama";
  model: string;
  fallbackProvider: "openai" | "ollama" | null;
  fallbackModel: string | null;
  job: string;
  lane: "research" | "extraction" | "validation" | "review" | "utility";
}

const JOBS: Record<ModelRole, { job: string; lane: EvidenceVaultWorker["lane"] }> = {
  critic_evaluator: { job: "Challenges strategy quality and returns a structured verdict.", lane: "validation" },
  strategy_proposer: { job: "Turns durable research evidence into testable strategy proposals.", lane: "research" },
  nightly_review: { job: "Reviews the day's system evidence and identifies hardening work.", lane: "review" },
  scout_auditor: { job: "Rejects weak or unsupported ideas before they enter the candidate queue.", lane: "validation" },
  dsl_quality_critic: { job: "Checks compiled strategy logic for incomplete or unsafe DSL.", lane: "validation" },
  transcript_extractor: { job: "Reads full source transcripts and extracts structured trading logic.", lane: "extraction" },
  tournament_prosecutor: { job: "Builds the adversarial case against a proposed strategy.", lane: "validation" },
  tournament_promoter: { job: "Applies the promotion matrix after the adversarial review.", lane: "validation" },
  bias_engine_evaluator: { job: "Judges whether the shadow bias engine should graduate, wait, or stop.", lane: "validation" },
  cross_source_validator: { job: "Tests whether independent sources truly describe the same edge.", lane: "validation" },
  strategy_name_discoverer: { job: "Finds named strategy concepts for the research intake queue.", lane: "research" },
  fast_critique: { job: "Runs high-volume local first-pass critique.", lane: "review" },
  dsl_writer: { job: "Drafts machine-readable strategy logic from approved evidence.", lane: "extraction" },
  quick_classifier: { job: "Handles fast binary and categorical routing decisions.", lane: "utility" },
  trade_critique: { job: "Performs the institutional post-trade autopsy.", lane: "review" },
  pattern_aggregator: { job: "Rolls repeated trade findings into durable improvement patterns.", lane: "review" },
  embedder: { job: "Produces local semantic representations for retrieval and matching.", lane: "utility" },
};

function titleCase(role: string): string {
  return role.split("_").map((word) => word === "dsl"
    ? "DSL"
    : word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

/**
 * Read-only projection of the model router's canonical role registry. This is
 * deliberately derived from MODEL_CONFIGS so the Office never invents workers,
 * models, or fallbacks that the running application has not configured.
 */
export function getEvidenceVaultWorkers(): EvidenceVaultWorker[] {
  return (Object.entries(MODEL_CONFIGS) as Array<[ModelRole, (typeof MODEL_CONFIGS)[ModelRole]]>)
    .map(([id, config]) => ({
      id,
      name: titleCase(id),
      provider: config.provider,
      model: config.model,
      fallbackProvider: config.fallback?.provider ?? null,
      fallbackModel: config.fallback?.model ?? null,
      job: JOBS[id].job,
      lane: JOBS[id].lane,
    }))
    .sort((a, b) => a.lane.localeCompare(b.lane) || a.name.localeCompare(b.name));
}

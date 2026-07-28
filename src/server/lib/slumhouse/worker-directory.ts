export interface EvidenceVaultWorker {
  id: string;
  name: string;
  provider: "anthropic" | "openai" | "ollama";
  model: string;
  status: "active" | "evaluation" | "successor-certification";
  job: string;
  lane: "extraction" | "validation" | "utility";
  source: string;
}

/**
 * The Vault explains the extraction crew, not every role in the application
 * model router. These entries mirror the extraction campaign's governed
 * instruments and deliberately exclude legacy router fallbacks.
 */
export function getEvidenceVaultWorkers(): EvidenceVaultWorker[] {
  return [
    {
      id: "headless-transcript-reader",
      name: "Claude Code Headless",
      provider: "anthropic",
      model: "claude-opus-5",
      status: "successor-certification",
      job: "Reads complete transcripts as the Opus 5.0 successor reader. Its output cannot enter a certified count until the successor ladder clears.",
      lane: "extraction",
      source: "Extraction campaign rulings R-292 and R-294",
    },
    {
      id: "frontier-mini-reader",
      name: "GPT-5.4 Mini",
      provider: "openai",
      model: "gpt-5.4-mini",
      status: "evaluation",
      job: "Runs the low-cost frontier extraction and vocabulary evaluation lane; it is not presented as the certified transcript reader.",
      lane: "extraction",
      source: "Frontier birth-gate and mini Phase-B records",
    },
    {
      id: "certification-panel",
      name: "GPT-5.4 Panel",
      provider: "openai",
      model: "gpt-5.4",
      status: "active",
      job: "Acts as the fail-closed extraction certification panel and challenges completeness, conflation, and enumeration consistency.",
      lane: "validation",
      source: "Certified-reader params and panel records",
    },
    {
      id: "local-atomizer",
      name: "Gemma Local Atomizer",
      provider: "ollama",
      model: process.env.TRANSCRIPT_EXTRACTOR_LOCAL_MODEL ?? "gemma4:e4b-it-qat",
      status: "active",
      job: "Runs local transcript decision-atom classification and intake support on the tower without claiming frontier-reader authority.",
      lane: "utility",
      source: "atomize-transcript and tower model configuration",
    },
  ];
}

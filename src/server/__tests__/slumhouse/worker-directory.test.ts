import { describe, expect, it, vi } from "vitest";

vi.mock("../../db/index.js", () => ({ db: {} }));

import { MODEL_CONFIGS } from "../../services/model-router.js";
import { getEvidenceVaultWorkers } from "../../lib/slumhouse/worker-directory.js";

describe("Evidence Vault worker directory", () => {
  it("is a complete projection of the canonical model router without invented roles", () => {
    const workers = getEvidenceVaultWorkers();
    expect(workers.map((worker) => worker.id).sort()).toEqual(Object.keys(MODEL_CONFIGS).sort());
    expect(workers.every((worker) => worker.model.length > 0 && worker.job.length > 20)).toBe(true);
    expect(workers.some((worker) => worker.provider === "openai")).toBe(true);
    expect(workers.some((worker) => worker.provider === "ollama")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import { getEvidenceVaultWorkers } from "../../lib/slumhouse/worker-directory.js";

describe("Evidence Vault extraction crew", () => {
  it("shows the governed extraction workers instead of the legacy application router", () => {
    const workers = getEvidenceVaultWorkers();
    expect(workers).toHaveLength(4);
    expect(workers).toEqual(expect.arrayContaining([
      expect.objectContaining({ model: "claude-opus-5", status: "successor-certification" }),
      expect.objectContaining({ model: "gpt-5.4-mini", status: "evaluation" }),
      expect.objectContaining({ model: "gpt-5.4", status: "active" }),
      expect.objectContaining({ provider: "ollama", model: "gemma4:e4b-it-qat" }),
    ]));
  });

  it("cannot regress to the retired generic-router model labels", () => {
    const labels = JSON.stringify(getEvidenceVaultWorkers());
    expect(labels).not.toContain('"gpt-5-mini"');
    expect(labels).not.toContain("claude-opus-4-8");
  });
});

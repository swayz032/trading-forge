import { describe, expect, it } from "vitest";

describe("production convergence hardening", () => {
  it("archetype read routes are backed by day_archetypes queries instead of placeholder responses", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(
      resolve(import.meta.dirname ?? ".", "../../server/routes/archetypes.ts"),
      "utf8",
    );

    expect(src).toMatch(/from "\.\.\/db\/schema\.js"/);
    expect(src).toMatch(/dayArchetypes/);
    expect(src).toMatch(/db\s*\.\s*select/s);
    expect(src).toMatch(/groupBy\(dayArchetypes\.archetype\)/);
    expect(src).toMatch(/predictionCorrect/);
    expect(src).not.toMatch(/Historical archetypes will be populated/);
    expect(src).not.toMatch(/Distribution available after historical labeling/);
    expect(src).not.toMatch(/Accuracy stats available after predictions are stored/);
  });

  it("compiler routes treat audit persistence as a strict requirement", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(
      resolve(import.meta.dirname ?? ".", "../../server/routes/compiler.ts"),
      "utf8",
    );

    expect(src).toMatch(/persistCompilerAuditOrThrow/);
    expect(src).toMatch(/Compiler audit persistence failed/);
    expect(src).not.toMatch(/Failed to persist compiler validate audit \(non-blocking\)/);
    expect(src).not.toMatch(/Failed to persist compiler compile audit \(non-blocking\)/);
  });

  it("skip routes use schema-compatible stable selects for live database reads", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(
      resolve(import.meta.dirname ?? ".", "../../server/routes/skip.ts"),
      "utf8",
    );

    expect(src).toMatch(/stableSkipDecisionSelect/);
    expect(src).toMatch(/select\(stableSkipDecisionSelect\)/);
    expect(src).not.toMatch(/select\(\)\s*\.from\(skipDecisions\)\s*\.where/s);
  });

  it("compliance routes avoid selecting invalidation columns that are absent in the live database", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(
      resolve(import.meta.dirname ?? ".", "../../server/routes/compliance.ts"),
      "utf8",
    );

    expect(src).toMatch(/stableComplianceReviewSelect/);
    expect(src).toMatch(/select\(stableComplianceReviewSelect\)/);
    expect(src).toMatch(/select\(stableComplianceRulesetSelect\)/);
  });

  it("anti-setup mining supports strategy_id workflow calls instead of only raw trade arrays", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(
      resolve(import.meta.dirname ?? ".", "../../server/routes/anti-setups.ts"),
      "utf8",
    );

    expect(src).toMatch(/strategy_id/);
    expect(src).toMatch(/lookback_days/);
    expect(src).toMatch(/No completed trades available for mining/);
    expect(src).toMatch(/innerJoin\(backtests/);
  });

  it("0A health monitor waits for all probes and persists alerts through the API", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(
      resolve(import.meta.dirname ?? ".", "../../../workflows/n8n/0A-health-monitor_66HEjQavpvirY6g5.json"),
      "utf8",
    );

    expect(src).toMatch(/Merge All Health Checks/);
    expect(src).toMatch(/Create Health Alert/);
    expect(src).toMatch(/http:\/\/host\.docker\.internal:4000\/api\/alerts/);
    expect(src).not.toMatch(/host\.docker\.internal:4100\/alert\/alerts/);
  });

  it("5H reddit scout keeps the scout-ideas contract and dedupes against journal fingerprints", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(
      resolve(import.meta.dirname ?? ".", "../../../workflows/n8n/5H-reddit-scout_ZMgHYjcTq4YTRQXh.json"),
      "utf8",
    );

    expect(src).toMatch(/Fetch Scout Fingerprints/);
    expect(src).toMatch(/Merge Scout Context/);
    expect(src).toMatch(/JSON\.stringify\(\{ ideas: \$json\.ideas \}\)/);
    expect(src).toMatch(/Create Scout Warning Alert/);
    expect(src).not.toMatch(/"url":\s*""/);
  });

  it("8B source quality review uses the stable source-stats endpoint and valid code syntax", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(
      resolve(import.meta.dirname ?? ".", "../../../workflows/n8n/8B-source-quality-review_LQtqeWAcNOlkqROH.json"),
      "utf8",
    );

    expect(src).toMatch(/\/api\/journal\/source-stats\?days=90/);
    expect(src).toMatch(/Weekly source quality review \(90d\)/);
    expect(src).toMatch(/Create Source Quality Alert/);
    expect(src).not.toMatch(/lines\.join\('\n'/);
  });

  it("all n8n HTTP request nodes enforce baseline resilience controls", async () => {
    const { readdirSync, readFileSync } = await import("fs");
    const { resolve } = await import("path");

    const workflowsDir = resolve(import.meta.dirname ?? ".", "../../../workflows/n8n");
    const files = readdirSync(workflowsDir).filter((name) => name.endsWith(".json"));
    const violations: string[] = [];

    function validateNode(fileName: string, node: any): void {
      if (!node || node.type !== "n8n-nodes-base.httpRequest") return;
      const nodeName = node.name ?? "unnamed-http-node";
      const timeout = node?.parameters?.options?.timeout;
      if (node.retryOnFail !== true) violations.push(`${fileName}:${nodeName}:retryOnFail`);
      if (typeof node.maxTries !== "number" || node.maxTries < 2) violations.push(`${fileName}:${nodeName}:maxTries`);
      if (node.onError !== "continueRegularOutput") violations.push(`${fileName}:${nodeName}:onError`);
      if (node.continueOnFail !== true) violations.push(`${fileName}:${nodeName}:continueOnFail`);
      if (typeof timeout !== "number" || timeout <= 0) violations.push(`${fileName}:${nodeName}:timeout`);
    }

    for (const fileName of files) {
      const source = readFileSync(resolve(workflowsDir, fileName), "utf8");
      const parsed = JSON.parse(source);
      const nodeSets = [
        Array.isArray(parsed.nodes) ? parsed.nodes : [],
        Array.isArray(parsed?.activeVersion?.nodes) ? parsed.activeVersion.nodes : [],
      ];
      for (const nodes of nodeSets) {
        for (const node of nodes) validateNode(fileName, node);
      }
    }

    expect(violations).toEqual([]);
  });
});

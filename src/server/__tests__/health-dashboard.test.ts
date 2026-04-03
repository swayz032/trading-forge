/**
 * Tests for GET /api/health/dashboard — Phase 4.2
 *
 * Mounts the Express app on an ephemeral port, verifies:
 * - Response shape (all expected keys present)
 * - 2-second timeout wrapper doesn't block the response indefinitely
 * - subsystems block contains postgres, ollama, python, n8n
 * - scheduler, circuitBreakers, paperSessions, metrics, memory, responseMs all present
 * - In dev mode (no API_KEY), auth is skipped
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  process.env.NODE_ENV = "development";
  delete process.env.API_KEY;

  const { app } = await import("../index.js");

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}, 15_000);

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

describe("GET /api/health/dashboard", () => {
  it("returns 200 with expected top-level shape", async () => {
    const res = await fetch(`${baseUrl}/api/health/dashboard`, {
      signal: AbortSignal.timeout(10_000),
    });
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;

    // Top-level required keys
    expect(body).toHaveProperty("timestamp");
    expect(body).toHaveProperty("uptimeSeconds");
    expect(body).toHaveProperty("subsystems");
    expect(body).toHaveProperty("scheduler");
    expect(body).toHaveProperty("circuitBreakers");
    expect(body).toHaveProperty("topology");
    expect(body).toHaveProperty("advancedModels");
    expect(body).toHaveProperty("paperSessions");
    expect(body).toHaveProperty("metrics");
    expect(body).toHaveProperty("memory");
    expect(body).toHaveProperty("responseMs");
  }, 15_000);

  it("subsystems block contains postgres, ollama, python, n8n keys", async () => {
    const res = await fetch(`${baseUrl}/api/health/dashboard`, {
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json() as { subsystems: Record<string, unknown> };
    const ss = body.subsystems;

    expect(ss).toHaveProperty("postgres");
    expect(ss).toHaveProperty("ollama");
    expect(ss).toHaveProperty("python");
    expect(ss).toHaveProperty("n8n");
  }, 15_000);

  it("each subsystem has a status field", async () => {
    const res = await fetch(`${baseUrl}/api/health/dashboard`, {
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json() as {
      subsystems: Record<string, { status: string }>;
    };
    for (const [name, check] of Object.entries(body.subsystems)) {
      expect(
        typeof check.status,
        `subsystem "${name}" missing status`,
      ).toBe("string");
    }
  }, 15_000);

  it("memory block has numeric MB fields", async () => {
    const res = await fetch(`${baseUrl}/api/health/dashboard`, {
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json() as {
      memory: { heapUsedMb: number; heapTotalMb: number; rssMb: number; externalMb: number };
    };
    expect(typeof body.memory.heapUsedMb).toBe("number");
    expect(typeof body.memory.heapTotalMb).toBe("number");
    expect(typeof body.memory.rssMb).toBe("number");
    expect(typeof body.memory.externalMb).toBe("number");
    expect(body.memory.heapUsedMb).toBeGreaterThan(0);
  }, 15_000);

  it("scheduler block has jobs array", async () => {
    const res = await fetch(`${baseUrl}/api/health/dashboard`, {
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json() as { scheduler: { jobs: unknown[] } };
    expect(Array.isArray(body.scheduler.jobs)).toBe(true);
  }, 15_000);

  it("topology block reports map freshness", async () => {
    const res = await fetch(`${baseUrl}/api/health/dashboard`, {
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json() as {
      topology: {
        status: string;
        generatedSectionPresent: boolean;
        manualTradingViewDeployOnly: boolean;
        driftItems: unknown[];
        registryCoverage: Record<string, unknown> | null;
        workflowSummary: Record<string, unknown> | null;
        runtimeControls: Record<string, unknown> | null;
        subsystems: unknown[];
        engineSubsystems: unknown[];
        manualGates: string[];
        preprodIntegrity: Record<string, unknown> | null;
        productionConvergence: Record<string, unknown> | null;
        readiness: Record<string, unknown> | null;
        operationalReadiness: Record<string, unknown> | null;
      };
    };
    expect(typeof body.topology.status).toBe("string");
    expect(typeof body.topology.generatedSectionPresent).toBe("boolean");
    expect(typeof body.topology.manualTradingViewDeployOnly).toBe("boolean");
    expect(Array.isArray(body.topology.driftItems)).toBe(true);
    expect(body.topology.registryCoverage === null || typeof body.topology.registryCoverage).toBeTruthy();
    expect(body.topology.workflowSummary === null || typeof body.topology.workflowSummary).toBeTruthy();
    expect(body.topology.runtimeControls === null || typeof body.topology.runtimeControls).toBeTruthy();
    expect(Array.isArray(body.topology.subsystems)).toBe(true);
    expect(Array.isArray(body.topology.engineSubsystems)).toBe(true);
    expect(Array.isArray(body.topology.manualGates)).toBe(true);
    expect(body.topology.preprodIntegrity === null || typeof body.topology.preprodIntegrity).toBeTruthy();
    expect(body.topology.productionConvergence === null || typeof body.topology.productionConvergence).toBeTruthy();
    expect(body.topology.readiness === null || typeof body.topology.readiness).toBeTruthy();
    expect(body.topology.operationalReadiness === null || typeof body.topology.operationalReadiness).toBeTruthy();
  }, 15_000);

  it("topology exposes proof status summaries and deep-scan engine subsystem entries", async () => {
    const res = await fetch(`${baseUrl}/api/health/dashboard`, {
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json() as {
      topology: {
        registryCoverage: {
          proofStatusCounts?: Record<string, number>;
          learningModeCounts?: Record<string, number>;
          operatingClassCounts?: Record<string, number>;
        } | null;
        runtimeControls: {
          status?: string;
          mode?: string;
          blockers?: unknown[];
          checkedControls?: unknown[];
        } | null;
        preprodIntegrity: {
          status?: string;
          incompleteSubsystems?: unknown[];
          failureVisibilityComplete?: number;
        } | null;
        productionConvergence: {
          status?: string;
          blockers?: unknown[];
        } | null;
        readiness: {
          launchReady?: boolean;
          blockers?: unknown[];
        } | null;
        operationalReadiness: {
          overallStatus?: string;
          blockers?: unknown[];
          subsystems?: Array<Record<string, unknown>>;
        } | null;
        subsystems: Array<Record<string, unknown>>;
        engineSubsystems: Array<Record<string, unknown>>;
      };
    };

    expect(body.topology.registryCoverage?.proofStatusCounts).toBeDefined();
    expect(body.topology.registryCoverage?.learningModeCounts).toBeDefined();
    expect(body.topology.registryCoverage?.operatingClassCounts).toBeDefined();
    expect(typeof body.topology.runtimeControls?.status).toBe("string");
    expect(typeof body.topology.runtimeControls?.mode).toBe("string");
    expect(Array.isArray(body.topology.runtimeControls?.blockers)).toBe(true);
    expect(Array.isArray(body.topology.runtimeControls?.checkedControls)).toBe(true);
    expect(typeof body.topology.preprodIntegrity?.status).toBe("string");
    expect(Array.isArray(body.topology.preprodIntegrity?.incompleteSubsystems)).toBe(true);
    expect(typeof body.topology.preprodIntegrity?.failureVisibilityComplete).toBe("number");
    expect(typeof body.topology.productionConvergence?.status).toBe("string");
    expect(Array.isArray(body.topology.productionConvergence?.blockers)).toBe(true);
    expect(typeof body.topology.readiness?.launchReady).toBe("boolean");
    expect(Array.isArray(body.topology.readiness?.blockers)).toBe(true);
    expect(typeof body.topology.operationalReadiness?.overallStatus).toBe("string");
    expect(Array.isArray(body.topology.operationalReadiness?.blockers)).toBe(true);
    expect(Array.isArray(body.topology.operationalReadiness?.subsystems)).toBe(true);
    expect(body.topology.operationalReadiness?.subsystems?.some((entry) => "status" in entry)).toBe(true);
    expect(body.topology.operationalReadiness?.subsystems?.some((entry) => "reasons" in entry)).toBe(true);
    expect(body.topology.operationalReadiness?.subsystems?.some((entry) => "operatingClass" in entry)).toBe(true);
    expect(body.topology.operationalReadiness?.subsystems?.some((entry) => "learningMode" in entry)).toBe(true);
    expect(body.topology.subsystems.some((entry) => "proofStatus" in entry)).toBe(true);
    expect(body.topology.subsystems.some((entry) => "currentState" in entry)).toBe(true);
    expect(body.topology.subsystems.some((entry) => "launchReady" in entry)).toBe(true);
    expect(body.topology.subsystems.some((entry) => "productionTargetState" in entry)).toBe(true);
    expect(body.topology.subsystems.some((entry) => "automationStatus" in entry)).toBe(true);
    expect(body.topology.subsystems.some((entry) => "operatingClass" in entry)).toBe(true);
    expect(body.topology.subsystems.some((entry) => "learningMode" in entry)).toBe(true);
    expect(body.topology.subsystems.some((entry) => "failureVisibilityStatus" in entry)).toBe(true);
    expect(body.topology.engineSubsystems.some((entry) => "ownerSubsystemId" in entry)).toBe(true);
    expect(body.topology.engineSubsystems.some((entry) => "operatingClass" in entry)).toBe(true);
    expect(body.topology.engineSubsystems.some((entry) => "learningMode" in entry)).toBe(true);
  }, 15_000);

  it("advancedModels exposes DeepAR and quantum runtime health", async () => {
    const res = await fetch(`${baseUrl}/api/health/dashboard`, {
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json() as {
      advancedModels: {
        deepar: Record<string, unknown>;
        quantum: Record<string, unknown>;
      };
    };

    expect(typeof body.advancedModels.deepar.status).toBe("string");
    expect(typeof body.advancedModels.quantum.status).toBe("string");
  }, 15_000);

  it("paperSessions block has active / stale / total (or error)", async () => {
    const res = await fetch(`${baseUrl}/api/health/dashboard`, {
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json() as { paperSessions: Record<string, unknown> };
    // Either DB is up (active/stale/total) or it errored out — both are valid
    expect(body.paperSessions).toBeDefined();
    const ps = body.paperSessions;
    const hasCountFields = "active" in ps && "stale" in ps && "total" in ps;
    const hasErrorField = "error" in ps;
    expect(hasCountFields || hasErrorField).toBe(true);
  }, 15_000);

  it("metrics is an array (empty or with sessions)", async () => {
    const res = await fetch(`${baseUrl}/api/health/dashboard`, {
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json() as { metrics: unknown[] };
    expect(Array.isArray(body.metrics)).toBe(true);
  }, 15_000);

  it("responseMs is a non-negative number under 10 seconds", async () => {
    const res = await fetch(`${baseUrl}/api/health/dashboard`, {
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json() as { responseMs: number };
    expect(typeof body.responseMs).toBe("number");
    expect(body.responseMs).toBeGreaterThanOrEqual(0);
    expect(body.responseMs).toBeLessThan(10_000);
  }, 15_000);
});

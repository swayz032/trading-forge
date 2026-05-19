import { db } from "../db/index.js";
import { subsystemMetrics, auditLog } from "../db/schema.js";
import { sql, gte } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { execSync } from "child_process";

async function recordBatch(metrics: Array<{ subsystem: string; metricName: string; metricValue: number }>) {
  if (metrics.length === 0) return;
  const now = new Date();
  await db.insert(subsystemMetrics).values(
    metrics.map(m => ({
      subsystem: m.subsystem,
      metricName: m.metricName,
      metricValue: String(m.metricValue),
      tags: null,
      measuredAt: now,
    })),
  );
}

function getGpuMetrics(): { gpuUtilPercent: number; gpuMemUsedMb: number; gpuMemTotalMb: number } | null {
  try {
    const output = execSync("nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits", {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    const [util, memUsed, memTotal] = output.split(",").map(s => parseFloat(s.trim()));
    return { gpuUtilPercent: util, gpuMemUsedMb: memUsed, gpuMemTotalMb: memTotal };
  } catch {
    return null; // No GPU or nvidia-smi not available
  }
}

async function getPythonSubprocessMetrics(): Promise<{ avgDurationMs: number; count: number }> {
  const since = new Date(Date.now() - 60 * 60 * 1000); // Last hour
  const [stats] = await db.select({
    avgDuration: sql<number>`coalesce(avg(duration_ms) filter (where action like 'backtest%' or action like 'monte_carlo%' or action like 'walk_forward%'), 0)::int`,
    count: sql<number>`count(*) filter (where action like 'backtest%' or action like 'monte_carlo%' or action like 'walk_forward%')::int`,
  }).from(auditLog).where(gte(auditLog.createdAt, since));
  return { avgDurationMs: stats?.avgDuration ?? 0, count: stats?.count ?? 0 };
}

export async function collectResourceMetrics(): Promise<void> {
  const metrics: Array<{ subsystem: string; metricName: string; metricValue: number }> = [];

  // Node.js memory
  const mem = process.memoryUsage();
  metrics.push(
    { subsystem: "resources", metricName: "node_heap_used_mb", metricValue: Math.round(mem.heapUsed / 1024 / 1024) },
    { subsystem: "resources", metricName: "node_heap_total_mb", metricValue: Math.round(mem.heapTotal / 1024 / 1024) },
    { subsystem: "resources", metricName: "node_rss_mb", metricValue: Math.round(mem.rss / 1024 / 1024) },
  );

  // GPU (if available)
  const gpu = getGpuMetrics();
  if (gpu) {
    metrics.push(
      { subsystem: "resources", metricName: "gpu_util_percent", metricValue: gpu.gpuUtilPercent },
      { subsystem: "resources", metricName: "gpu_mem_used_mb", metricValue: gpu.gpuMemUsedMb },
      { subsystem: "resources", metricName: "gpu_mem_total_mb", metricValue: gpu.gpuMemTotalMb },
    );
  }

  // Python subprocess durations
  const pyStats = await getPythonSubprocessMetrics();
  metrics.push(
    { subsystem: "resources", metricName: "python_avg_duration_ms", metricValue: pyStats.avgDurationMs },
    { subsystem: "resources", metricName: "python_runs_per_hour", metricValue: pyStats.count },
  );

  await recordBatch(metrics);
  logger.debug({ metricCount: metrics.length }, "Resource metrics collected");
}

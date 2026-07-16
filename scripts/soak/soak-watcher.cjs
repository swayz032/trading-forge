// scripts/soak/soak-watcher.cjs — standalone nightly watcher. Entry point (schtasks 3AM).
// STANDALONE: direct postgres client, NO import from src/server/** (doer≠grader + no heavy deps).
"use strict";
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

// Resolve .env from a candidate list so this runs from an isolated worktree tonight
// (finds the sibling main checkout's .env) AND from the main checkout after landing.
(function loadEnv() {
  const candidates = [
    process.env.SOAK_ENV_PATH,
    path.join(process.cwd(), ".env"),
    path.join(__dirname, "..", "..", ".env"),                              // worktree root
    path.join(__dirname, "..", "..", "..", "trading-forge", ".env"),       // sibling main checkout
  ].filter(Boolean);
  for (const p of candidates) {
    try { if (fs.existsSync(p)) { dotenv.config({ path: p }); if (process.env.DATABASE_URL) return; } } catch { /* keep trying */ }
  }
})();

const postgres = require("postgres");
const { takeSample, readHealthResilient } = require("./soak-sensors.cjs");
const { decide } = require("./soak-guard.cjs");
const V = require("./soak-verdict.cjs");

const CFG = {
  // 127.0.0.1 not localhost: undici resolves "localhost" dual-stack (~2.3s overhead measured) and can
  // race the 8s timeout under 3AM maintenance load; the loopback IPv4 is deterministic + fast.
  healthUrl: process.env.SOAK_HEALTH_URL || "http://127.0.0.1:4000/api/health",
  port: Number(process.env.SOAK_BACKEND_PORT || 4000),
  // Startup/abort health-probe patience — rides through the 03:00 Windows-maintenance event-loop stall.
  healthAttempts: Number(process.env.SOAK_HEALTH_ATTEMPTS || 6),
  healthGapMs: Number(process.env.SOAK_HEALTH_GAP_SEC || 15) * 1000,
  healthTimeoutMs: Number(process.env.SOAK_HEALTH_TIMEOUT_MS || 10000),
  gpuBusyPct: Number(process.env.SOAK_GPU_BUSY_PCT || 25),
  windowMin: Number(process.env.SOAK_WINDOW_MIN || 360),
  sampleSec: Number(process.env.SOAK_SAMPLE_SEC || 30),
  recheckSec: Number(process.env.SOAK_RECHECK_SEC || 300),
  memNoiseFloorMbH: Number(process.env.SOAK_MEM_NOISE_FLOOR_MBH || 8), // provisional; re-baselined post-calibration
  dataDir: process.env.SOAK_DATA_DIR || path.join(process.cwd(), "data", "soak"),
  buildSha: process.env.SOAK_BUILD_SHA || null,
  dryRun: process.argv.includes("--dry-run"),
  forceRun: process.argv.includes("--force-run"), // bypass guard to exercise the RUN path
};
// Test runs (dry/force) write a SEPARATE action so they never pollute the real ledger or calibration count.
const AUDIT_ACTION = (CFG.dryRun || CFG.forceRun) ? "soak.night_completed_test" : "soak.night_completed";

if (!process.env.DATABASE_URL) { console.error("soak-watcher: DATABASE_URL not resolved from any .env candidate"); process.exit(2); }
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

// switch: system_parameters.current_value is NUMERIC. 0=off, else armed. Row absent → armed
// (default-on). A failed QUERY → mode null → guard fail-closed SKIP.
async function readSwitch() {
  try {
    const rows = await sql`SELECT param_name, current_value FROM system_parameters WHERE param_name IN ('soak_mode','soak_skip_until')`;
    const m = {}; for (const r of rows) m[r.param_name] = r.current_value;
    let mode = "armed";
    if (m.soak_mode !== undefined && Number(m.soak_mode) === 0) mode = "off";
    const skip = m.soak_skip_until !== undefined ? Number(m.soak_skip_until) : null;
    return { mode, skipUntilMs: Number.isFinite(skip) ? skip : null };
  } catch { return { mode: null, skipUntilMs: null }; }
}

async function nightIndex() {
  // Calibration counts ONLY genuinely-measured nights. SKIP/INVALID rows must not advance it,
  // or 14 nightly SKIPs (e.g. during a campaign) would "complete calibration" having observed nothing.
  try { const [r] = await sql`SELECT count(*)::int AS n FROM audit_log WHERE action='soak.night_completed' AND result->>'outcome'='RAN'`; return r?.n ?? 0; }
  catch { return 0; }
}

async function writeAudit(payload) {
  // audit_log: append-only (0058 trigger). status NOT NULL (success|failure|pending);
  // decision_authority='scheduler' so nightly rows NEVER reset the vacation operator-absence detector.
  await sql`INSERT INTO audit_log (action, status, decision_authority, result)
            VALUES (${AUDIT_ACTION}, 'success', 'scheduler', ${sql.json(payload)})`;
}

async function discord(msg) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;
  try { await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: msg }), signal: AbortSignal.timeout(8000) }); } catch { /* best-effort */ }
}

const appendJsonl = (file, obj) => fs.appendFileSync(file, JSON.stringify(obj) + "\n");
const sample = () => takeSample({ healthUrl: CFG.healthUrl, port: CFG.port });

async function main() {
  fs.mkdirSync(CFG.dataDir, { recursive: true });
  const startMs = Date.now();
  const stamp = new Date(startMs).toISOString().slice(0, 10).replace(/-/g, "");
  const jsonl = path.join(CFG.dataDir, `soak-${stamp}.jsonl`);
  const idx = await nightIndex();

  const first = await sample();
  // A single-shot startup probe times out under the 03:00 maintenance pileup even though the backend
  // is up → every scheduled night SKIPPED backend_unreachable. Retry patiently before condemning it.
  if (first.health.reachable === false) {
    first.health = await readHealthResilient({ healthUrl: CFG.healthUrl, attempts: CFG.healthAttempts, gapMs: CFG.healthGapMs, timeoutMs: CFG.healthTimeoutMs });
  }
  const sw0 = await readSwitch();
  const g0 = CFG.forceRun ? { action: "RUN", reason: "forced" } : decide({ sample: first, sw: sw0, gpuBusyPct: CFG.gpuBusyPct, nowMs: Date.now(), phase: "startup" });
  if (g0.action !== "RUN") {
    appendJsonl(jsonl, { type: "skip", reason: g0.reason, tMs: startMs, nightIndex: idx, health: first.health });
    await writeAudit({ outcome: "SKIPPED", verdict: "SKIPPED", reason: g0.reason, healthErr: first.health?.errCode ?? null, healthAttempts: first.health?.attempts ?? null, nightIndex: idx, thresholds: V.THRESHOLDS_V1.version, buildSha: CFG.buildSha });
    await discord(`⚪ Tower Soak SKIPPED — ${g0.reason}${g0.reason === "backend_unreachable" && first.health?.errCode ? ` (${first.health.errCode})` : ""} (night ${idx})`);
    await sql.end(); return;
  }
  appendJsonl(jsonl, { type: "start", tMs: startMs, nightIndex: idx, sample: first });

  const samples = [first];
  const stepMs = (CFG.dryRun ? 2 : CFG.sampleSec) * 1000;
  const windowMs = CFG.dryRun ? Number(process.env.SOAK_DRY_WINDOW_MS || 180000) : CFG.windowMin * 60000; // dry default 3-min
  let lastRecheck = startMs, aborted = null;

  while (Date.now() - startMs < windowMs) {
    await new Promise(r => setTimeout(r, stepMs));
    const s = await sample();
    samples.push(s);
    appendJsonl(jsonl, { type: "sample", tMs: s.tMs, sample: s });
    if (!CFG.forceRun && (CFG.dryRun || Date.now() - lastRecheck >= CFG.recheckSec * 1000)) {
      lastRecheck = Date.now();
      const g = decide({ sample: s, sw: await readSwitch(), gpuBusyPct: CFG.gpuBusyPct, nowMs: Date.now(), phase: "midrun" });
      if (g.action === "ABORT") {
        // A transient maintenance-spike health miss must not abort a running soak — confirm the backend
        // is really gone before believing it. Real contention aborts (backtests/python/gpu) stand as-is.
        if (g.reason === "backend_unreachable") {
          const rh = await readHealthResilient({ healthUrl: CFG.healthUrl, attempts: CFG.healthAttempts, gapMs: CFG.healthGapMs, timeoutMs: CFG.healthTimeoutMs });
          if (rh.reachable) continue; // false alarm — backend answered on retry
        }
        aborted = g.reason; break;
      }
    }
  }

  const memSeries = samples.filter(s => s.backend?.rssMb != null).map(s => ({ tMs: s.tMs - startMs, valueMb: s.backend.rssMb }));
  const slope = V.linearSlopePerHour(memSeries);
  const vramFloor = samples.map(s => s.vramUsedMb).filter(v => v != null);
  const pidSeries = samples.filter(s => s.backend?.pid != null).map(s => ({ pid: s.backend.pid, startMs: s.backend.startMs }));
  const hbSeries = samples.map(s => ({ tMs: s.tMs - startMs, ok: !!s.health.ok }));
  const dStart = samples[0].diskFreeBytes, dEnd = samples[samples.length - 1].diskFreeBytes;
  const windowHours = (samples[samples.length - 1].tMs - samples[0].tMs) / 3600000;

  const minSamples = CFG.dryRun ? 3 : 0.8 * (windowMs / stepMs);
  const invalidating = !!aborted || samples.length < minSamples;
  const metricGrades = {
    memory: V.gradeMemory({ slopeMbPerHr: slope.slopeMbPerHr, ciHalfWidth: slope.ciHalfWidth, noiseFloorMbPerHr: CFG.memNoiseFloorMbH }),
    vram: V.gradeVram(vramFloor),
    disk: (dStart != null && dEnd != null && windowHours > 0) ? V.gradeDisk({ freeBytesStart: dStart, freeBytesEnd: dEnd, windowHours }).verdict : "UNAVAILABLE",
    restarts: V.gradeRestarts(pidSeries),
    heartbeat: V.gradeHeartbeat(hbSeries),
  };
  const verdict = V.computeNightVerdict({ metricGrades, nightIndex: idx, invalidating });

  const payload = {
    outcome: invalidating ? "INVALID" : "RAN", verdict, nightIndex: idx, aborted,
    thresholds: V.THRESHOLDS_V1.version, buildSha: CFG.buildSha,
    memSlopeMbPerHr: Number.isFinite(slope.slopeMbPerHr) ? Number(slope.slopeMbPerHr.toFixed(2)) : null,
    memCiHalfWidth: Number.isFinite(slope.ciHalfWidth) ? Number(slope.ciHalfWidth.toFixed(2)) : null,
    proj30dMb: Number.isFinite(slope.slopeMbPerHr) ? Number(V.projectGrowthMb(slope.slopeMbPerHr, 720).toFixed(0)) : null,
    vramFloorMb: vramFloor.length ? vramFloor[vramFloor.length - 1] : null,
    diskDaysToFull: (dStart != null && dEnd != null && windowHours > 0) ? Math.round(V.gradeDisk({ freeBytesStart: dStart, freeBytesEnd: dEnd, windowHours }).daysToFull) : null,
    metricGrades, sampleCount: samples.length, windowHours: Number(windowHours.toFixed(2)),
  };
  appendJsonl(jsonl, { type: "verdict", tMs: Date.now(), ...payload });
  await writeAudit(payload);
  const pill = { GREEN: "🟢", RED: "🔴", INVALID: "🟠", CALIBRATING: "⚪", SKIPPED: "⚪" }[verdict] || "⚪";
  await discord(`${pill} Tower Soak ${verdict} (night ${idx}) — mem ${payload.memSlopeMbPerHr}MB/h→${payload.proj30dMb}MB/30d · disk ${metricGrades.disk} · restarts ${metricGrades.restarts} · vram ${metricGrades.vram} · n=${payload.sampleCount}`);
  await sql.end();
}

main().catch(async (e) => {
  try { await discord(`🔴 Tower Soak watcher crashed: ${String(e && e.message || e).slice(0, 180)}`); } catch { /* ignore */ }
  try { await sql.end(); } catch { /* ignore */ }
  process.exitCode = 1;
});

// scripts/soak/soak-sensors.cjs — ALL I/O lives here. Every probe fails soft to null.
// Identifies the backend by its LISTENING PORT owner (not process name) so ephemeral
// agent `node` processes never masquerade as the patient.
"use strict";
const { execFileSync } = require("child_process");

function safeExec(cmd, args) {
  try { return execFileSync(cmd, args, { encoding: "utf-8", timeout: 8000, windowsHide: true }).trim(); }
  catch { return null; }
}

function readGpu() {
  const out = safeExec("nvidia-smi", ["--query-gpu=utilization.gpu,memory.used", "--format=csv,noheader,nounits"]);
  if (!out) return { vramUsedMb: null, gpuUtil: null };
  const [util, mem] = out.split(",").map(s => parseFloat(s.trim()));
  return { vramUsedMb: Number.isFinite(mem) ? mem : null, gpuUtil: Number.isFinite(util) ? util : null };
}

// One PowerShell call returns: backend proc (by :port owner), ollama proc (by name), disk free.
function readWindows(port) {
  const ps = `
$ErrorActionPreference='SilentlyContinue'
function Info($p){ if(-not $p){return $null}; $sm=$null; try { $sm=[int64](($p.StartTime)-(Get-Date '1970-01-01')).TotalMilliseconds } catch { $sm=$null }; return @{ pid=$p.Id; rssMb=[math]::Round($p.WorkingSet64/1MB); handles=$p.HandleCount; startMs=$sm } }
$o=@{}
$c = Get-NetTCPConnection -LocalPort ${port} -State Listen | Select-Object -First 1
if($c){ $o.backend = Info (Get-Process -Id $c.OwningProcess) }
$o.ollama = Info (Get-Process -Name ollama | Select-Object -First 1)
$o.pythonCount = @(Get-Process -Name python,python3,pythonw).Count
$o.diskFreeBytes = [int64]((Get-PSDrive C).Free)
$o | ConvertTo-Json -Compress -Depth 4
`.trim();
  const out = safeExec("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps]);
  const nullProc = { pid: null, rssMb: null, handles: null, startMs: null };
  // Backend runs as an NSSM service → StartTime is often inaccessible and PS returns
  // DateTime.MinValue (≈ -6.2e13 ms). Treat any pre-2000 / non-finite epoch as null so
  // gradeRestarts leans on PID (which DOES change on a real NSSM respawn).
  const saneMs = v => (Number.isFinite(v) && v > 946684800000) ? v : null;
  const proc = p => p ? { pid: p.pid ?? null, rssMb: p.rssMb ?? null, handles: p.handles ?? null, startMs: saneMs(p.startMs) } : { ...nullProc };
  if (!out) return { backend: { ...nullProc }, ollama: { ...nullProc }, pythonCount: null, diskFreeBytes: null };
  let j; try { j = JSON.parse(out); } catch { return { backend: { ...nullProc }, ollama: { ...nullProc }, pythonCount: null, diskFreeBytes: null }; }
  return {
    backend: proc(j.backend),
    ollama: proc(j.ollama),
    pythonCount: Number.isFinite(j.pythonCount) ? j.pythonCount : null,
    diskFreeBytes: Number.isFinite(j.diskFreeBytes) ? j.diskFreeBytes : null,
  };
}

async function readHealth(healthUrl, timeoutMs = 8000) {
  const started = Date.now();
  try {
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(timeoutMs) });
    const latencyMs = Date.now() - started;
    // reachable = the backend answered at ALL (any HTTP status). A non-200 (auth-gated 401/503, or
    // slow) means the backend is UP, just not returning health JSON — NOT "unreachable". Only a thrown
    // fetch (connection refused / HTTP 000) is truly down. This distinction stops the false-positive
    // backend_unreachable the soak logged on 2026-07-11 (backend was actually alive that day).
    if (!res.ok) return { reachable: true, ok: false, status: res.status, latencyMs, backtestsActive: null, errCode: null };
    const body = await res.json();
    const active = body?.backtestConcurrency?.active;
    return { reachable: true, ok: true, status: res.status, latencyMs, backtestsActive: Number.isFinite(active) ? active : null, errCode: null };
  } catch (err) {
    // Capture WHY it threw (ECONNREFUSED / TimeoutError / …). The old bare catch left every nightly
    // backend_unreachable undiagnosable — a swallowed 3AM timeout looked identical to a dead backend.
    const errCode = (err && err.cause && err.cause.code) || (err && err.name) || "fetch_error";
    return { reachable: false, ok: false, status: null, latencyMs: Date.now() - started, backtestsActive: null, errCode };
  }
}

// Patient probe for the STARTUP gate (and mid-run abort confirmation). At 03:00:00 Windows Automatic
// Maintenance + OneDrive/Pca/Device/Monitoring tasks all fire and stall the backend event loop, so a
// single 8s fetch times out even though the backend is up — that condemned every scheduled night to
// backend_unreachable. Retry until the backend answers or attempts are exhausted; a truly-down backend
// still exhausts the retries and SKIPs (correct). `probe` is injectable for tests.
async function readHealthResilient({ healthUrl, attempts = 1, gapMs = 0, timeoutMs = 8000, probe = readHealth }) {
  const n = Math.max(1, attempts);
  let last = null;
  for (let i = 0; i < n; i++) {
    last = await probe(healthUrl, timeoutMs);
    if (last && last.reachable) return { ...last, attempts: i + 1 };
    if (i < n - 1 && gapMs > 0) await new Promise(r => setTimeout(r, gapMs));
  }
  return { ...(last || { reachable: false, ok: false, status: null, latencyMs: null, backtestsActive: null, errCode: "no_probe" }), attempts: n };
}

async function takeSample({ healthUrl, port = 4000, nowMs }) {
  const gpu = readGpu();
  const win = readWindows(port);
  return {
    tMs: nowMs ?? Date.now(),
    backend: win.backend,
    ollama: win.ollama,
    pythonCount: win.pythonCount,
    diskFreeBytes: win.diskFreeBytes,
    vramUsedMb: gpu.vramUsedMb,
    gpuUtil: gpu.gpuUtil,
    health: await readHealth(healthUrl),
  };
}

module.exports = { takeSample, readGpu, readWindows, readHealth, readHealthResilient };

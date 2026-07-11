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

async function readHealth(healthUrl) {
  const started = Date.now();
  try {
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(8000) });
    const latencyMs = Date.now() - started;
    if (!res.ok) return { ok: false, latencyMs, backtestsActive: null };
    const body = await res.json();
    const active = body?.backtestConcurrency?.active;
    return { ok: true, latencyMs, backtestsActive: Number.isFinite(active) ? active : null };
  } catch { return { ok: false, latencyMs: null, backtestsActive: null }; }
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

module.exports = { takeSample, readGpu, readWindows, readHealth };

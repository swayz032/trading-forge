# Wave 19 verification — confirm all 4 NSSM services healthy + API responsive
# Run from any PowerShell (no admin required for read-only checks)

$Services = @("TradingForgeAPI", "TradingForgeDiscordBot", "OpenclawGateway", "TowerRelayClient")

Write-Host "`nNSSM Service Status:" -ForegroundColor Cyan
foreach ($name in $Services) {
    $s = Get-Service -Name $name -ErrorAction SilentlyContinue
    if ($s) {
        $color = if ($s.Status -eq "Running") { "Green" } else { "Red" }
        Write-Host ("  {0,-32} {1,-12} (StartType: {2})" -f $name, $s.Status, $s.StartType) -ForegroundColor $color
    } else {
        Write-Host ("  {0,-32} NOT INSTALLED" -f $name) -ForegroundColor Red
    }
}

Write-Host "`nAPI Health:" -ForegroundColor Cyan
try {
    $r = Invoke-WebRequest -Uri "http://localhost:4000/api/health" -UseBasicParsing -TimeoutSec 5
    $j = $r.Content | ConvertFrom-Json
    Write-Host "  ✓ status=$($j.status) uptime=$([int]$j.uptime)s db=$($j.database.status) ollama=$($j.ollama.status)" -ForegroundColor Green
} catch {
    Write-Host "  ✗ DOWN: $_" -ForegroundColor Red
}

Write-Host "`npm2 daemon status (should be NOT running):" -ForegroundColor Cyan
$pm2pid = Get-Content "$env:USERPROFILE\.pm2\pm2.pid" -ErrorAction SilentlyContinue
if ($pm2pid -and (Get-Process -Id $pm2pid -ErrorAction SilentlyContinue)) {
    Write-Host "  ⚠ pm2 god daemon still alive at PID $pm2pid — run 'pm2 kill' to fully decommission" -ForegroundColor Yellow
} else {
    Write-Host "  ✓ pm2 god daemon stopped (Wave 19 NSSM replaces it)" -ForegroundColor Green
}

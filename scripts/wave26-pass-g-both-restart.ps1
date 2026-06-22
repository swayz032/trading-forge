# Restart TradingForgeAPI (picks up TRANSCRIPT_EXTRACTOR_LOCAL_MODEL=gemma4:latest)
# and TradingForgeDiscordBot (picks up messageCreate handler + slumdawg voice).

#Requires -RunAsAdministrator
$ErrorActionPreference = "Continue"
$LOG = "C:\Users\tonio\bin\tf-logs\both-restart.log"
$null = New-Item -ItemType Directory -Path (Split-Path $LOG) -Force -ErrorAction SilentlyContinue
function L($m) { "[{0}] {1}" -f (Get-Date -Format o), $m | Tee-Object -FilePath $LOG -Append | Write-Host }

foreach ($svc in @("TradingForgeAPI","TradingForgeDiscordBot")) {
  L "stopping $svc..."
  sc.exe stop $svc 2>&1 | ForEach-Object { L $_ }
}
Start-Sleep -Seconds 5

foreach ($svc in @("TradingForgeAPI","TradingForgeDiscordBot")) {
  L "starting $svc..."
  sc.exe start $svc 2>&1 | ForEach-Object { L $_ }
}
Start-Sleep -Seconds 10

foreach ($svc in @("TradingForgeAPI","TradingForgeDiscordBot")) {
  $s = Get-Service $svc -ErrorAction SilentlyContinue
  L "final $svc = $($s.Status)"
}

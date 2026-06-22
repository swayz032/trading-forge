# Restart TradingForgeDiscordBot NSSM service to pick up the new
# messageCreate handler + MessageContent intent (Wave 26 Pass G).

#Requires -RunAsAdministrator
$ErrorActionPreference = "Continue"
$LOG = "C:\Users\tonio\bin\tf-logs\discord-bot-restart.log"
$null = New-Item -ItemType Directory -Path (Split-Path $LOG) -Force -ErrorAction SilentlyContinue
function L($m) { "[{0}] {1}" -f (Get-Date -Format o), $m | Tee-Object -FilePath $LOG -Append | Write-Host }

L "stopping TradingForgeDiscordBot..."
sc.exe stop TradingForgeDiscordBot 2>&1 | ForEach-Object { L $_ }
Start-Sleep -Seconds 5

L "starting TradingForgeDiscordBot..."
sc.exe start TradingForgeDiscordBot 2>&1 | ForEach-Object { L $_ }
Start-Sleep -Seconds 6

$svc = Get-Service TradingForgeDiscordBot -ErrorAction SilentlyContinue
L "final: $($svc.Status)"

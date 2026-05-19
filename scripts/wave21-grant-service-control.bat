@echo off
REM Wave 21 - Grant non-admin service control via SDDL
REM Run from ADMIN cmd.exe or admin PowerShell:
REM   C:\Users\tonio\Projects\trading-forge\trading-forge\scripts\wave21-grant-service-control.bat

setlocal
set "SDDL=D:(A;;CCLCSWRPWPDTLOCRRC;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWLOCRRC;;;IU)(A;;CCLCSWLOCRRC;;;SU)(A;;RPWPCR;;;BU)"

echo Applying SDDL to 4 services...
echo.

echo [1/4] TradingForgeAPI
sc sdset TradingForgeAPI "%SDDL%"
echo.

echo [2/4] TradingForgeDiscordBot
sc sdset TradingForgeDiscordBot "%SDDL%"
echo.

echo [3/4] OpenclawGateway
sc sdset OpenclawGateway "%SDDL%"
echo.

echo [4/4] TowerRelayClient
sc sdset TowerRelayClient "%SDDL%"
echo.

echo Done.
echo Test from non-admin shell: Restart-Service TradingForgeAPI
pause

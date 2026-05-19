@echo off
REM Creates TradingForgeAPI Task Scheduler task replacing NSSM service
schtasks /Create /TN TradingForgeAPI /SC ONSTART /RU SYSTEM /RL HIGHEST /F /TR "\"C:\PROGRA~1\nodejs\node.exe\" node_modules\tsx\dist\cli.mjs src\server\index.ts"
echo.
echo === Task created. Now patching working directory ===
schtasks /Query /TN TradingForgeAPI /XML > "%TEMP%\tfapi.xml"
powershell -Command "(Get-Content '%TEMP%\tfapi.xml') -replace '<Exec>', '<Exec><WorkingDirectory>C:\Users\tonio\Projects\trading-forge\trading-forge</WorkingDirectory>' | Set-Content '%TEMP%\tfapi.xml'"
schtasks /Create /TN TradingForgeAPI /XML "%TEMP%\tfapi.xml" /F
echo.
echo === Starting task ===
schtasks /Run /TN TradingForgeAPI
timeout /T 12 /NOBREAK > nul
echo.
echo === Task status ===
schtasks /Query /TN TradingForgeAPI /V /FO LIST | findstr /C:"Status" /C:"Last Run" /C:"Last Result"
echo.
echo === API health ===
curl -s --max-time 10 http://localhost:4000/api/health
echo.

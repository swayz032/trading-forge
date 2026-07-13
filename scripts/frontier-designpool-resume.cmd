@echo off
set WT=C:\Users\tonio\Projects\wt-h1-wave4-20260712
set LOCK=%WT%\docs\replay-results\h1-scripts\.designpool-resume.lock
if exist "%LOCK%" ( echo [resume] locked, another run active — skipping & exit /b 0 )
echo locked > "%LOCK%"
cd /d "%WT%"
call npx tsx scripts/h1-frontier-designpool.ts >> "%WT%\docs\replay-results\h1-scripts\frontier-designpool\resume.log" 2>&1
del "%LOCK%"

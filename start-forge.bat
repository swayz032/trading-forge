@echo off
REM ╔══════════════════════════════════════════════════════════════╗
REM ║  Trading Forge — Master Startup Script                       ║
REM ║  Backup one-click boot: Docker → Ollama → PM2 → Verify      ║
REM ╚══════════════════════════════════════════════════════════════╝

echo [FORGE] Starting Trading Forge infrastructure...
echo.

REM ─── Step 1: Ensure Docker containers are running ──────────────
echo [1/4] Starting Docker containers...
docker start docker-n8n-1 docker-n8n-db-1 forge-pgvector docker-grafana-1 2>nul
REM Ensure forge-pgvector is on n8n's network (for vector store access)
docker network connect docker_default forge-pgvector 2>nul
timeout /t 5 /nobreak >nul
echo       Docker containers started.
echo.

REM ─── Step 2: Warm Ollama models ────────────────────────────────
echo [2/4] Warming Ollama models...
curl -s -X POST http://localhost:11434/api/generate -d "{\"model\":\"trading-quant\",\"prompt\":\"ping\",\"stream\":false}" >nul 2>&1
curl -s -X POST http://localhost:11434/api/generate -d "{\"model\":\"llama3.1:8b\",\"prompt\":\"ping\",\"stream\":false}" >nul 2>&1
echo       Ollama models warmed.
echo.

REM ─── Step 3: Resurrect PM2 services ───────────────────────────
echo [3/4] Starting PM2 services...
cd /d C:\Users\tonio\Projects\trading-forge\trading-forge
pm2 resurrect 2>nul || pm2 start ecosystem.config.cjs
timeout /t 8 /nobreak >nul
echo       PM2 services started.
echo.

REM ─── Step 4: Verify all endpoints ─────────────────────────────
echo [4/4] Verifying services...
echo.

REM Trading Forge API
curl -s -o nul -w "       Trading Forge API (4000):   %%{http_code}" http://localhost:4000/api/health
echo.

REM OpenClaw Gateway
curl -s -o nul -w "       OpenClaw Gateway (18789):   %%{http_code}" http://localhost:18789/health
echo.

REM Ollama
curl -s -o nul -w "       Ollama (11434):             %%{http_code}" http://localhost:11434/api/tags
echo.

REM Discord Bot
curl -s -o nul -w "       Discord Bot (4100):         %%{http_code}" http://localhost:4100/health
echo.

REM n8n
curl -s -o nul -w "       n8n (5678):                 %%{http_code}" http://localhost:5678/healthz
echo.

echo.
echo [FORGE] Startup complete. Check status with: pm2 list
echo.
pause

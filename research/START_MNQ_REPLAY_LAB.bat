@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>&1
if %errorlevel%==0 goto use_py

where python >nul 2>&1
if %errorlevel%==0 goto use_python

echo.
echo Python was not found on PATH.
echo Open review_v3.html directly, or install Python and run this launcher again.
echo.
pause
exit /b 1

:use_py
py -3 serve_replay_lab.py
goto end

:use_python
python serve_replay_lab.py

goto end

:end
endlocal

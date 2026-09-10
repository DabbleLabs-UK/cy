@echo off
setlocal
cd /d "%~dp0.."

:loop
echo [%date% %time%] starting cy runner >> "runner\state\run.out.log"
node runner\run.js >> "runner\state\run.out.log" 2>&1
set "CY_EXIT=%ERRORLEVEL%"
echo [%date% %time%] exited with code %CY_EXIT%, restarting in 15s >> "runner\state\run.out.log"
timeout /t 15 /nobreak > nul
goto loop

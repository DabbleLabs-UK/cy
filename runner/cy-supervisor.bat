@echo off
setlocal
cd /d "%~dp0.."

REM TEMPORARY DIAGNOSTIC (2026-09-19 incident instrumentation): appends to the
REM same runner\state\lifecycle-diagnostic.log that run.js's own process-exit
REM handlers write to, so both sides of the story land in one file. This must
REM make it obvious whether cmd.exe ever observes node returning at all: if
REM node.exe disappears but no "node returned" line ever appears here, this
REM whole supervisor process was killed before it could observe the child -
REM i.e. an external kill of the tree, not a normal/explicit Node exit.
REM Remove once the investigation concludes.

:loop
echo [%date% %time%] starting cy runner >> "runner\state\run.out.log"
echo [%date% %time%] SUPERVISOR: about to start node (goto loop iteration) >> "runner\state\lifecycle-diagnostic.log"
node runner\run.js >> "runner\state\run.out.log" 2>&1
set "CY_EXIT=%ERRORLEVEL%"
echo [%date% %time%] SUPERVISOR: node returned, ERRORLEVEL=%CY_EXIT% >> "runner\state\lifecycle-diagnostic.log"
if "%CY_EXIT%"=="78" (
  echo [%date% %time%] exited with code 78: persistent state requires recovery; supervisor halted >> "runner\state\run.out.log"
  echo [%date% %time%] SUPERVISOR: code 78 - HALTING loop, not restarting >> "runner\state\lifecycle-diagnostic.log"
  exit /b 78
)
echo [%date% %time%] exited with code %CY_EXIT%, restarting in 15s >> "runner\state\run.out.log"
echo [%date% %time%] SUPERVISOR: will restart in 15s, then goto loop >> "runner\state\lifecycle-diagnostic.log"
timeout /t 15 /nobreak > nul
echo [%date% %time%] SUPERVISOR: 15s wait complete, looping now >> "runner\state\lifecycle-diagnostic.log"
goto loop

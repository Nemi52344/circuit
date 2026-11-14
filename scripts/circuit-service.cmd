@echo off
REM Starts Circuit the way the scheduled task does, but in a visible window.
REM
REM Use this to see what the background copy is doing, or to run Circuit by hand after
REM stopping the task. Only one copy can hold port 3210, so stop the task first:
REM
REM     schtasks /end /tn Circuit
REM
REM Run it again with:  schtasks /run /tn Circuit

cd /d "%~dp0.."

if not exist ".next\BUILD_ID" (
  echo No production build found. Building first...
  call npm run build || exit /b 1
)

echo Starting Circuit on http://localhost:3210
node node_modules\next\dist\bin\next start -p 3210

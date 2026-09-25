@echo off
rem Double-click to build (or resume building) the GLaDOS voice model.
rem Extra arguments are passed through, e.g.:  run.bat --redo select
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
set CODE=%ERRORLEVEL%
echo.
if "%CODE%"=="0" (
  echo Finished. Read C:\GLaDOSVoice\README.md
) else if "%CODE%"=="2" (
  echo The pipeline needs something from you - see the BLOCKED message above.
) else (
  echo Stopped with an error. Run run.bat again to resume; details in C:\GLaDOSVoice\logs\pipeline.log
)
pause
exit /b %CODE%

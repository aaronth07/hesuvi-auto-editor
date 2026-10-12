@echo off
cd /d "%~dp0"
where py >nul 2>nul
if not errorlevel 1 (
  py -3 launch.py %*
  goto done
)
where python >nul 2>nul
if not errorlevel 1 (
  python launch.py %*
  goto done
)
echo Python 3 is required for the local launcher. You can also use the GitHub Pages website.
pause
exit /b 1
:done
if errorlevel 1 pause


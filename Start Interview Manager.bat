@echo off
rem Double-click to open the Interview Manager launcher.
cd /d "%~dp0"
py -3 launcher.py
if errorlevel 1 (
  python launcher.py
  if errorlevel 1 (
    echo.
    echo Could not start. Is Python 3 installed and on your PATH?
    pause
  )
)

@echo off
chcp 65001 >nul
title Petka i Chislograd - dev server (port 6244)
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo Python ne nayden. Ustanovite Python 3.11+ s python.org i postavte galochku "Add to PATH".
  echo.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\activate.bat" (
  echo Sozdayu virtualnoe okruzhenie i stavlyu zavisimosti...
  python -m venv .venv
  call ".venv\Scripts\activate.bat"
  python -m pip install --upgrade pip
  python -m pip install -r requirements.txt
) else (
  call ".venv\Scripts\activate.bat"
)

echo.
echo ============================================
echo   Igra: http://127.0.0.1:6244
echo   Ostanovit: Ctrl+C
echo ============================================
echo.

start "" http://127.0.0.1:6244
python -m uvicorn server.app:app --host 127.0.0.1 --port 6244
pause

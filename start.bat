@echo off
cd /d "%~dp0"

title LOD1 Control Evidence Validator

echo Starting LOD1 Control Evidence Validator...
echo.

if exist "venv\Scripts\activate.bat" (
    call venv\Scripts\activate.bat
) else (
    echo [WARNING] Virtual environment not found.
    echo   Run install.bat first to set up dependencies.
    echo.
)

echo Make sure Ollama is running with llama3:8b-instruct-q8_0 pulled.
echo Open http://127.0.0.1:8000 in your browser.
echo.
echo Press Ctrl+C to stop the server.
echo.

python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Failed to start. Make sure Python dependencies are installed:
    echo   pip install -r backend\requirements.txt
    pause
)

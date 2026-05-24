@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

title LOD1 Validator - Installer
color 0B
echo ==============================================
echo   LOD1 Control Evidence Validator - Installer
echo ==============================================
echo.

rem ---- Check: Administrator ----
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if "%errorlevel%" NEQ "0" (
    echo [!] NOT running as Administrator.
    echo     Shortcut creation and Tesseract install will be SKIPPED.
    echo     To enable them, right-click install.bat and select "Run as administrator".
    echo.
) else (
    set ADMIN=1
)

rem ---- Check Python ----
echo [*] Checking Python...
python --version >nul 2>&1
if %errorlevel% NEQ 0 (
    echo [!] Python is NOT installed.
    echo.
    echo     Download Python 3.10+ from: https://www.python.org/downloads/
    echo     During install, check "Add Python to PATH".
    echo.
    pause
    exit /b 1
)
for /f "tokens=2" %%v in ('python --version 2^>^&1') do set PYVER=%%v
echo     Found Python !PYVER!
echo.

rem ---- Check Python version >= 3.10 ----
for /f "tokens=1,2 delims=." %%a in ("!PYVER!") do (
    if %%a LSS 3 (
        echo [!] Python 3.10+ required, found !PYVER!
        pause
        exit /b 1
    )
    if %%a EQU 3 if %%b LSS 10 (
        echo [!] Python 3.10+ required, found !PYVER!
        pause
        exit /b 1
    )
)

rem ---- Create virtual environment ----
echo [*] Setting up virtual environment...
if exist "venv" (
    echo     Virtual environment already exists. Skipping creation.
) else (
    python -m venv venv
    if %errorlevel% NEQ 0 (
        echo [!] Failed to create virtual environment.
        pause
        exit /b 1
    )
    echo     Created virtual environment.
)
echo.

rem ---- Install dependencies ----
echo [*] Installing Python dependencies...
call venv\Scripts\activate.bat
pip install --upgrade pip -q
pip install -r backend\requirements.txt
if %errorlevel% NEQ 0 (
    echo [!] Dependency installation failed.
    pause
    exit /b 1
)
echo     Dependencies installed successfully.
echo.

rem ---- Check Tesseract OCR ----
echo [*] Checking Tesseract OCR...
tesseract --version >nul 2>&1
if %errorlevel% NEQ 0 (
    echo     Tesseract OCR is NOT installed.
    echo     This is needed for image/PDF text extraction.
    echo.
    set /p INSTALL_OCR="  Install Tesseract OCR now? (Y/N): "
    if /i "!INSTALL_OCR!"=="Y" (
        echo.
        echo     Downloading Tesseract OCR installer...
        set TESS_URL=https://github.com/UB-Mannheim/tesseract/releases/download/v5.5.0.20241111/tesseract-ocr-w64-setup-5.5.0.20241111.exe
        set TESS_EXE=%TEMP%\tesseract_installer.exe
        powershell -Command "& {[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object System.Net.WebClient).DownloadFile('%TESS_URL%', '%TESS_EXE%')}" <nul
        if exist "!TESS_EXE!" (
            echo     Running Tesseract installer...
            start /wait "" "!TESS_EXE!" /SILENT
            if %errorlevel% EQU 0 (
                echo     Tesseract installed successfully.
            ) else (
                echo [!] Tesseract installer may have failed.
            )
            del "!TESS_EXE!" 2>nul
        ) else (
            echo [!] Download failed. Install manually from:
            echo     https://github.com/UB-Mannheim/tesseract/releases
        )
    )
) else (
    for /f "tokens=1" %%v in ('tesseract --version 2^>^&1') do set TESS_VER=%%v
    echo     Found !TESS_VER!
)
echo.

rem ---- Initialize database ----
echo [*] Initializing database...
python -c "from backend.database.crud import get_engine; get_engine(); print('Database ready')" 2>nul
if %errorlevel% EQU 0 (
    echo     Database initialized.
) else (
    echo [!] Database initialization failed.
)
echo.

rem ---- Create shortcuts (admin only) ----
if defined ADMIN (
    echo [*] Creating Start Menu shortcut...
    set STARTMENU=%APPDATA%\Microsoft\Windows\Start Menu\Programs\LOD1 Validator
    if not exist "!STARTMENU!" mkdir "!STARTMENU!"
    powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%STARTMENU%\\LOD1 Validator.lnk'); $s.TargetPath = '%~dp0start.bat'; $s.WorkingDirectory = '%~dp0'; $s.Description = 'LOD1 Control Evidence Validator'; $s.Save()" <nul
    echo     Start Menu shortcut created.

    echo [*] Creating Desktop shortcut...
    set DESKTOP=%USERPROFILE%\Desktop
    if exist "!DESKTOP!" (
        powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%DESKTOP%\\LOD1 Validator.lnk'); $s.TargetPath = '%~dp0start.bat'; $s.WorkingDirectory = '%~dp0'; $s.Description = 'LOD1 Control Evidence Validator'; $s.Save()" <nul
        echo     Desktop shortcut created.
    )
    echo.
)

rem ---- Done ----
echo ==============================================
echo   Installation Complete!
echo ==============================================
echo.
echo   To start the application:
echo     1. Make sure Ollama is running
echo        (https://ollama.com) with llama3:8b pulled
echo     2. Run:  start.bat
echo     3. Open: http://127.0.0.1:8000
echo.
echo   To uninstall later, run:  install.bat /uninstall
echo.

pause
goto :eof

rem ============ UNINSTALL ============
:uninstall
echo.
echo [*] Uninstalling LOD1 Validator...
echo.

rem Remove shortcuts
set STARTMENU=%APPDATA%\Microsoft\Windows\Start Menu\Programs\LOD1 Validator
if exist "!STARTMENU!" (
    rmdir /s /q "!STARTMENU!" 2>nul
    echo     Removed Start Menu shortcuts.
)
set DESKTOP=%USERPROFILE%\Desktop
if exist "!DESKTOP!\LOD1 Validator.lnk" (
    del "!DESKTOP!\LOD1 Validator.lnk" 2>nul
    echo     Removed Desktop shortcut.
)

rem Remove virtual environment
if exist "venv" (
    echo     Removing virtual environment...
    rmdir /s /q "venv" 2>nul
    echo     Virtual environment removed.
)

rem Ask about database
if exist "backend\lod_audit.db" (
    echo.
    set /p DEL_DB="  Delete audit database (submissions history)? (Y/N): "
    if /i "!DEL_DB!"=="Y" (
        del "backend\lod_audit.db" 2>nul
        echo     Database deleted.
    )
)

echo.
echo     Uninstall complete.
echo.
pause
exit /b 0

@echo off
echo ========================================
echo Building backend with PyInstaller
echo ========================================
echo.

REM Check for virtual environment
if not exist "venv\" (
    echo ERROR: Virtual environment not found!
    echo Create virtual environment: python -m venv venv
    echo Then activate it: venv\Scripts\activate
    echo And install dependencies: pip install -r requirements.txt
    pause
    exit /b 1
)

REM Activate virtual environment
echo Activating virtual environment...
call venv\Scripts\activate.bat

REM Check PyInstaller installation
echo Checking PyInstaller installation...
python -c "import PyInstaller" 2>nul
if errorlevel 1 (
    echo PyInstaller not installed. Installing...
    pip install pyinstaller==6.3.0
)

REM Clean previous builds
echo Cleaning previous builds...
if exist "build\" rmdir /s /q "build"
if exist "dist\" rmdir /s /q "dist"
if exist "__pycache__\" rmdir /s /q "__pycache__"

REM Build with PyInstaller
echo.
echo Starting build...
echo.
pyinstaller backend.spec --clean

if errorlevel 1 (
    echo.
    echo ERROR during build!
    pause
    exit /b 1
)

REM Copy database if it exists
echo.
echo Copying database...
if exist "timetable.db" (
    copy /Y "timetable.db" "dist\timetable.db" >nul
    echo Database copied to dist\
) else (
    echo Warning: Database timetable.db not found in current directory
    echo A new database will be created on first exe run
)

REM Copy media directory if it exists
if exist "media\" (
    echo Copying media directory...
    xcopy /E /I /Y "media" "dist\media" >nul
    echo Media directory copied to dist\
)

REM -------------------------------------------------------
REM Copy backend.exe into Tauri sidecar binaries directory.
REM Tauri requires sidecar name format: {name}-{target-triple}.exe
REM -------------------------------------------------------
echo.
echo Copying backend.exe to Tauri sidecar binaries...

set TAURI_BINARIES=..\frontend\src-tauri\binaries

if not exist "%TAURI_BINARIES%\" mkdir "%TAURI_BINARIES%"

copy /Y "dist\backend.exe" "%TAURI_BINARIES%\backend-x86_64-pc-windows-msvc.exe" >nul
if errorlevel 1 (
    echo WARNING: Failed to copy backend.exe to Tauri binaries!
) else (
    echo backend.exe copied to %TAURI_BINARIES%\backend-x86_64-pc-windows-msvc.exe
)

REM Copy the seed database so Tauri bundles it as a resource.
REM database.py will copy it to AppData on first launch when no DB exists yet.
if exist "timetable.db" (
    copy /Y "timetable.db" "%TAURI_BINARIES%\timetable.db" >nul
    echo timetable.db (seed) copied to %TAURI_BINARIES%\timetable.db
)

echo.
echo ========================================
echo Build completed successfully!
echo ========================================
echo.
echo Executable file  : dist\backend.exe
echo Tauri sidecar    : %TAURI_BINARIES%\backend-x86_64-pc-windows-msvc.exe
echo Seed database    : %TAURI_BINARIES%\timetable.db
echo.
echo Next step: run "npm run tauri build" inside the frontend\ directory.
echo.
pause
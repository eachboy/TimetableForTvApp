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

echo.
echo ========================================
echo Build completed successfully!
echo ========================================
echo.
echo Executable file is located at: dist\backend.exe
echo Database: dist\timetable.db
echo.
pause

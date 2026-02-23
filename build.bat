@echo off
REM ═══════════════════════════════════════════════════
REM   Río Gestión WEB — Build & Package Script
REM   Compiles frontend + backend into a distributable
REM ═══════════════════════════════════════════════════
setlocal enabledelayedexpansion

set ROOT=%~dp0
set FRONTEND=%ROOT%frontend
set BACKEND=%ROOT%backend
set INSTALLER_DIR=%ROOT%installer
set OUTPUT_EXE=%INSTALLER_DIR%\RGWeb.exe
set PUBLIC_DIR=%INSTALLER_DIR%\public

echo.
echo ══════════════════════════════════════════════════
echo   Rio Gestion WEB — Build ^& Package
echo ══════════════════════════════════════════════════
echo.

REM ── Step 1: Clean previous build ────────────────
echo [1/6] Cleaning previous builds...
if exist "%INSTALLER_DIR%" rmdir /s /q "%INSTALLER_DIR%"
if exist "%BACKEND%\dist" rmdir /s /q "%BACKEND%\dist"
if exist "%FRONTEND%\dist" rmdir /s /q "%FRONTEND%\dist"
mkdir "%INSTALLER_DIR%"
echo       Done.
echo.

REM ── Step 2: Build Frontend ──────────────────────
echo [2/6] Building frontend (Vite)...
cd /d "%FRONTEND%"
call npm run build
if errorlevel 1 (
    echo       ERROR: Frontend build failed!
    pause
    exit /b 1
)
echo       Done.
echo.

REM ── Step 3: Copy frontend dist → installer/public
echo [3/6] Copying frontend to installer/public...
xcopy /s /e /i /q "%FRONTEND%\dist" "%PUBLIC_DIR%" > nul
echo       Done.
echo.

REM ── Step 4: Build Backend (TypeScript → JS) ────
echo [4/6] Compiling backend (TypeScript)...
cd /d "%BACKEND%"
call npm run build
if errorlevel 1 (
    echo       ERROR: Backend build failed!
    pause
    exit /b 1
)
echo       Done.
echo.

REM ── Step 5: Copy utility scripts ────────────────
echo [5/6] Copying utility scripts...
copy /y "%ROOT%enable-tcp-admin.ps1" "%INSTALLER_DIR%\enable-tcp-admin.ps1" > nul
echo       Done.
echo.

REM ── Step 6: Package with pkg ────────────────────
echo [6/6] Packaging into executable (pkg)...
call npx pkg dist/index.js --targets node18-win-x64 --output "%OUTPUT_EXE%" --compress GZip --icon "%ROOT%frontend\src\assets\logos\RioGestionWhite.ico"
if errorlevel 1 (
    echo       ERROR: pkg packaging failed!
    echo       Make sure pkg is installed: npm i -g @yao-pkg/pkg
    pause
    exit /b 1
)
echo       Done.
echo.

REM ── Step 6: Info ────────────────────────────────
echo.
echo ══════════════════════════════════════════════════
echo   BUILD COMPLETE!
echo ══════════════════════════════════════════════════
echo.
echo   Output directory: %INSTALLER_DIR%
echo.
echo   Contents:
echo     RGWeb.exe              — Server executable
echo     public/                — Frontend files
echo     enable-tcp-admin.ps1   — Habilitar TCP en SQL Server
echo.
echo   To deploy, copy the installer/ folder to the
echo   client PC and place appdata.ini next to
echo   RGWeb.exe, then run it. No .env needed.
echo.
echo ══════════════════════════════════════════════════
pause

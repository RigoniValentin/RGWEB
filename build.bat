@echo off
REM ===================================================
REM   Rio Gestion WEB - Build & Package Script
REM   Compiles frontend + backend into a distributable
REM ===================================================
setlocal enabledelayedexpansion
chcp 65001 > nul

set ROOT=%~dp0
set FRONTEND=%ROOT%frontend
set BACKEND=%ROOT%backend
set INSTALLER_DIR=%ROOT%Rio Gestion WEB
set OUTPUT_EXE=%INSTALLER_DIR%\RGWeb.exe
set PUBLIC_DIR=%INSTALLER_DIR%\public

echo.
echo   ====================================================
echo     Rio Gestion WEB - Build ^& Package
echo   ====================================================
echo.

REM -- Step 1: Clean previous build --------------------
echo [1/6] Cleaning previous builds...
if exist "%INSTALLER_DIR%" rmdir /s /q "%INSTALLER_DIR%"
if exist "%BACKEND%\dist" rmdir /s /q "%BACKEND%\dist"
if exist "%FRONTEND%\dist" rmdir /s /q "%FRONTEND%\dist"
mkdir "%INSTALLER_DIR%"
echo       Done.
echo.

REM -- Step 2: Build Frontend --------------------------
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

REM -- Step 3: Copy frontend dist ----------------------
echo [3/6] Copying frontend to public...
xcopy /s /e /i /q "%FRONTEND%\dist" "%PUBLIC_DIR%" > nul
echo       Done.
echo.

REM -- Step 4: Build Backend (TypeScript) --------------
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

REM -- Step 5: Copy utility scripts --------------------
echo [5/6] Copying utility scripts...
copy /y "%ROOT%enable-tcp-admin.ps1" "%INSTALLER_DIR%\enable-tcp-admin.ps1" > nul
copy /y "%BACKEND%\RGWeb-hidden.vbs" "%INSTALLER_DIR%\RGWeb-hidden.vbs" > nul
REM -- Create certs folder for ARCA certificates ------
if not exist "%INSTALLER_DIR%\certs" mkdir "%INSTALLER_DIR%\certs"
if exist "%ROOT%certs\*.crt" xcopy /y /q "%ROOT%certs\*.crt" "%INSTALLER_DIR%\certs\" > nul
if exist "%ROOT%certs\*.key" xcopy /y /q "%ROOT%certs\*.key" "%INSTALLER_DIR%\certs\" > nul
echo       Done.
echo.

REM -- Step 6: Package with pkg ------------------------
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

REM -- Build complete ----------------------------------
echo.
echo   ====================================================
echo     BUILD COMPLETE
echo   ====================================================
echo.
echo   Output: %INSTALLER_DIR%
echo.
echo   Contents:
echo     RGWeb.exe            - Server executable
echo     RGWeb-hidden.vbs     - Launcher sin ventana de consola
echo     public/              - Frontend files
echo     certs/               - Certificados ARCA (.crt/.key)
echo     enable-tcp-admin.ps1 - Habilitar TCP en SQL Server
echo.
echo   Para desplegar, copiar la carpeta "Rio Gestion WEB"
echo   a la PC del cliente, colocar appdata.ini junto a
echo   RGWeb.exe y ejecutarlo.
echo.
echo   ====================================================
pause

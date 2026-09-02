@echo off
setlocal
cd /d "%~dp0"
call npm run build:folder
if errorlevel 1 (
  echo.
  echo UESRPG release-folder build failed.
  exit /b 1
)
echo.
echo Ready release: %~dp0dist\uesrpg-3ev4
endlocal

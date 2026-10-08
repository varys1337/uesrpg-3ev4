@echo off
setlocal
cd /d "%~dp0"

call npm run build:folder
if errorlevel 1 (
  echo.
  echo UESRPG dist build failed. Fix the validation errors above; no release was produced.
  exit /b 1
)

call npm run build:github-source
if errorlevel 1 (
  echo.
  echo UESRPG GitHub source staging failed. Fix the validation errors above; no source handoff was produced.
  exit /b 1
)

set "RELEASE_DIR=%~dp0dist\uesrpg-3ev4"
set "RELEASE_ZIP=%~dp0dist\uesrpg-3ev4.zip"
set "GITHUB_SOURCE_DIR=%~dp0dist\github-source"

where powershell >nul 2>&1
if errorlevel 1 (
  echo.
  echo Release folder is ready:
  echo   %RELEASE_DIR%
  echo GitHub source folder is ready:
  echo   %GITHUB_SOURCE_DIR%
  echo PowerShell was not found, so the ZIP archive was not created.
  exit /b 0
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path '%RELEASE_DIR%\*' -DestinationPath '%RELEASE_ZIP%' -CompressionLevel Optimal -Force"
if errorlevel 1 (
  echo.
  echo Release folder is ready, but ZIP creation failed:
  echo   %RELEASE_DIR%
  exit /b 1
)

call npm run build:release -- --archive "dist\uesrpg-3ev4.zip"
if errorlevel 1 (
  del /q "%RELEASE_ZIP%" >nul 2>&1
  echo.
  echo Release archive validation failed. The invalid ZIP was removed.
  exit /b 1
)

echo.
echo Ready Foundry system folder:
echo   %RELEASE_DIR%
echo Ready release archive:
echo   %RELEASE_ZIP%
echo Ready GitHub source folder:
echo   %GITHUB_SOURCE_DIR%
endlocal

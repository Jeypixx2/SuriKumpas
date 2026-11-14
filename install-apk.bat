@echo off
setlocal

rem ---- Step 1: Ensure Gradle dirs exist ----
if not exist "%USERPROFILE%\.gradle\wrapper\dists" mkdir "%USERPROFILE%\.gradle\wrapper\dists"
if not exist "%USERPROFILE%\.gradle\daemon" mkdir "%USERPROFILE%\.gradle\daemon"
if not exist "%USERPROFILE%\.gradle\caches" mkdir "%USERPROFILE%\.gradle\caches"

rem Delete old APK if present
if exist "%~dp0android\app\build\outputs\apk\release\app-release.apk" del /f /q "%~dp0android\app\build\outputs\apk\release\app-release.apk"

rem ---- Step 2: Build the release APK from inside the android folder ----
set "GRADLE_OPTS=-Dorg.gradle.daemon=false -Djava.net.preferIPv4Stack=true"
cd /d "%~dp0android"
call gradlew.bat assembleRelease --no-daemon
if %ERRORLEVEL% neq 0 (
  echo.
  echo BUILD FAILED with error %ERRORLEVEL%
  exit /b %ERRORLEVEL%
)
cd /d "%~dp0"

rem ---- Step 3: Locate the APK ----
set "APK_PATH=%~dp0android\app\build\outputs\apk\release\app-release.apk"
if not exist "%APK_PATH%" (
  echo APK not found at: %APK_PATH%
  exit /b 1
)
echo APK found: %APK_PATH%

rem ---- Step 4: Install via adb ----
set "ADB_EXE=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"
if not exist "%ADB_EXE%" (
  echo adb not found at: %ADB_EXE%
  echo Make sure the Android SDK is installed correctly.
  exit /b 1
)

"%ADB_EXE%" install -r "%APK_PATH%"
if %ERRORLEVEL% neq 0 (
  echo adb install FAILED.
) else (
  echo.
  echo ---- APK installed successfully! ----
)

endlocal

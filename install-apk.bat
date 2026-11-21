@echo off
setlocal

rem ---- Step 1: Ensure Gradle and Android SDK dirs exist ----
if not exist "%USERPROFILE%\.gradle\wrapper\dists" mkdir "%USERPROFILE%\.gradle\wrapper\dists"
if not exist "%USERPROFILE%\.gradle\daemon" mkdir "%USERPROFILE%\.gradle\daemon"
if not exist "%USERPROFILE%\.gradle\caches" mkdir "%USERPROFILE%\.gradle\caches"
if not exist "%LOCALAPPDATA%\Android\Sdk" mkdir "%LOCALAPPDATA%\Android\Sdk"

if not defined ANDROID_HOME set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
if not defined ANDROID_SDK_ROOT set "ANDROID_SDK_ROOT=%LOCALAPPDATA%\Android\Sdk"

rem Ensure local.properties exists in android folder
if not exist "%~dp0android\local.properties" (
  (echo sdk.dir=%LOCALAPPDATA:\=\\%\\Android\\Sdk)> "%~dp0android\local.properties"
)

rem Delete old APK if present
if exist "%~dp0android\app\build\outputs\apk\release\app-release.apk" del /f /q "%~dp0android\app\build\outputs\apk\release\app-release.apk"

rem ---- Step 2: Auto-detect and configure JAVA_HOME ----
if not defined JAVA_HOME if exist "D:\jdk-17" set "JAVA_HOME=D:\jdk-17"
if not defined JAVA_HOME if exist "C:\Program Files\Java\jdk-17" set "JAVA_HOME=C:\Program Files\Java\jdk-17"
if not defined JAVA_HOME if exist "C:\Program Files\Java\jdk-21" set "JAVA_HOME=C:\Program Files\Java\jdk-21"
if not defined JAVA_HOME if exist "D:\PyCharm 2025.3.3\jbr" set "JAVA_HOME=D:\PyCharm 2025.3.3\jbr"
if not defined JAVA_HOME if exist "C:\Program Files\Android\Android Studio\jbr" set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"

if not defined JAVA_HOME (
  echo [ERROR] JAVA_HOME is not set and no Java installation was found automatically.
  echo Please install JDK 17 or 21 or run D:\Download\jdk-21_windows-x64_bin.exe
  exit /b 1
)

echo [OK] Using JAVA_HOME: %JAVA_HOME%
set "PATH=%JAVA_HOME%\bin;%PATH%"

rem ---- Step 3: Check for Node.js ----
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%"
if exist "%LOCALAPPDATA%\Programs\node\node.exe" set "PATH=%LOCALAPPDATA%\Programs\node;%PATH%"

where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
  echo:
  echo =========================================================================
  echo [ERROR] Node.js was not found in your PATH.
  echo React Native requires Node.js to compile your app's JavaScript bundle.
  echo.
  echo Please download and install Node.js v20 or newer from:
  echo   https://nodejs.org/
  echo.
  echo After installing, reopen your terminal and run install-apk.bat again.
  echo =========================================================================
  exit /b 1
)

echo [OK] Using Node.js:
node --version

rem ---- Step 4: Build release APK ----
echo:
echo Starting Gradle build...
set "GRADLE_OPTS=-Dorg.gradle.daemon=false -Djava.net.preferIPv4Stack=true"
cd /d "%~dp0android"
call gradlew.bat assembleRelease --no-daemon
if %ERRORLEVEL% neq 0 (
  echo:
  echo [ERROR] Build failed with error %ERRORLEVEL%
  exit /b %ERRORLEVEL%
)
cd /d "%~dp0"

rem ---- Step 5: Locate APK ----
set "APK_PATH=%~dp0android\app\build\outputs\apk\release\app-release.apk"
if not exist "%APK_PATH%" (
  echo [ERROR] APK not found at: %APK_PATH%
  exit /b 1
)

echo:
echo [OK] APK built successfully: %APK_PATH%

rem ---- Step 6: Install via adb ----
set "ADB_EXE=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"
if not exist "%ADB_EXE%" if exist "D:\Program Files\Microvirt\MEmu\adb.exe" set "ADB_EXE=D:\Program Files\Microvirt\MEmu\adb.exe"

if exist "%ADB_EXE%" (
  echo:
  echo Installing APK to device using %ADB_EXE%...
  "%ADB_EXE%" install -r "%APK_PATH%"
) else (
  echo:
  echo Notice: adb was not found to automatically push the app to your phone.
  echo You can copy the APK directly to your phone to install it:
  echo   %APK_PATH%
)

endlocal

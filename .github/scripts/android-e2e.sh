#!/usr/bin/env bash
set -euo pipefail

mkdir -p .maestro-results

echo "Waiting for Android emulator boot..."
adb wait-for-device
for attempt in $(seq 1 60); do
  if [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; then
    break
  fi
  sleep 2
done
if [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" != "1" ]; then
  echo "Android emulator did not finish booting."
  adb devices -l || true
  exit 1
fi

# The emulator is x86_64. Building every Android ABI needlessly compiles
# native C/C++ dependencies four times and was consuming 17-28 minutes.
# Restrict the CI APK to the emulator ABI.
#
# Use a release APK so the JS bundle is embedded in the APK. This removes the
# separate Metro server dependency (which repeatedly failed to start in CI)
# while still exercising the real native app and Maestro UI flow.
gradle --no-daemon -p android -PreactNativeArchitectures=x86_64 assembleRelease

APK="android/app/build/outputs/apk/release/app-release.apk"
if [ ! -f "$APK" ]; then
  echo "Expected release APK was not generated: $APK"
  find android/app/build/outputs/apk -maxdepth 3 -type f -print || true
  exit 1
fi

adb install -r "$APK"

set +e
maestro test --format junit --output .maestro-results/junit.xml .maestro
TEST_EXIT_CODE=$?
set -e

if [ "$TEST_EXIT_CODE" -ne 0 ]; then
  echo "Maestro failed; capturing Android diagnostics."
  adb exec-out screencap -p > .maestro-results/failure-screen.png || true
  adb shell uiautomator dump /sdcard/maestro-window.xml >/dev/null 2>&1 || true
  adb pull /sdcard/maestro-window.xml .maestro-results/window.xml >/dev/null 2>&1 || true
  adb logcat -d -v time > .maestro-results/logcat.txt || true
fi

exit "$TEST_EXIT_CODE"

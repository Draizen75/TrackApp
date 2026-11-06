#!/usr/bin/env bash
set -euo pipefail

# The emulator action may invoke its script from a temporary directory.
# Anchor all test output to the checked-out repository so later workflow
# steps can upload it reliably.
cd "${GITHUB_WORKSPACE:-$(git rev-parse --show-toplevel)}"
RESULT_DIR="$PWD/.maestro-results"
DIAGNOSTICS_DIR="$PWD/.android-diagnostics"
mkdir -p "$RESULT_DIR" "$DIAGNOSTICS_DIR"
: > "$DIAGNOSTICS_DIR/runner-started.txt"

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

# Capture Android logs independently of Maestro's output directory. The
# background capture also preserves startup exceptions and native crashes.
adb logcat -c || true
adb logcat -v time > "$DIAGNOSTICS_DIR"/logcat.txt 2>&1 &
LOGCAT_PID=$!
capture_diagnostics() {
  adb exec-out screencap -p > "$DIAGNOSTICS_DIR"/final-screen.png 2>/dev/null || true
  adb shell uiautomator dump /sdcard/trackapp-window.xml >/dev/null 2>&1 || true
  adb pull /sdcard/trackapp-window.xml "$DIAGNOSTICS_DIR"/window.xml >/dev/null 2>&1 || true
  adb shell dumpsys activity activities > "$DIAGNOSTICS_DIR"/activities.txt 2>&1 || true
  adb shell dumpsys package com.draizen.TrackApp > "$DIAGNOSTICS_DIR"/package.txt 2>&1 || true
  kill "$LOGCAT_PID" >/dev/null 2>&1 || true
  wait "$LOGCAT_PID" 2>/dev/null || true
}
trap capture_diagnostics EXIT

# Build only the emulator ABI and bundle JS into the release APK.
gradle --no-daemon -p android -PreactNativeArchitectures=x86_64 assembleRelease

APK="android/app/build/outputs/apk/release/app-release.apk"
if [ ! -f "$APK" ]; then
  echo "Expected release APK was not generated: $APK"
  find android/app/build/outputs/apk -maxdepth 3 -type f -print || true
  exit 1
fi

adb install -r "$APK"
adb shell am force-stop com.draizen.TrackApp || true
adb shell monkey -p com.draizen.TrackApp 1 >/dev/null 2>&1 || true
sleep 8
adb shell pidof com.draizen.TrackApp > "$DIAGNOSTICS_DIR"/app-pid.txt 2>&1 || true

set +e
maestro test --format junit --output "$RESULT_DIR/junit.xml" .maestro
TEST_EXIT_CODE=$?
set -e

echo "$TEST_EXIT_CODE" > "$DIAGNOSTICS_DIR"/maestro-exit-code.txt
exit "$TEST_EXIT_CODE"

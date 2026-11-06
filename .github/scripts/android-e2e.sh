#!/usr/bin/env bash
set -euo pipefail

adb devices -l
adb wait-for-device
adb shell getprop sys.boot_completed

echo "Inspect generated Android project:"
ls -la android

gradle --no-daemon -p android assembleDebug
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
mkdir -p .maestro-results

# Debug React Native builds load their JavaScript bundle from Metro.
# Start Metro directly instead of through `expo start`: Expo CLI attempts to
# install React Native DevTools (Chromium) even in headless CI, which fails on
# GitHub's unprivileged Linux runner due to Chromium's SUID sandbox requirement.
# The project's metro.config.js still applies Expo Router and NativeWind config.
node ./node_modules/metro/src/cli.js start --config metro.config.js --host 0.0.0.0 --port 8081 --reset-cache > .maestro-results/metro.log 2>&1 &
METRO_PID=$!
cleanup() {
  kill "$METRO_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

METRO_READY=0
for attempt in $(seq 1 60); do
  if curl --silent --fail http://127.0.0.1:8081/status | grep -q "running"; then
    METRO_READY=1
    break
  fi
  sleep 2
done

if [ "$METRO_READY" -ne 1 ]; then
  echo "Metro did not become ready. Recent Metro output:"
  tail -n 100 .maestro-results/metro.log || true
  exit 1
fi

adb reverse tcp:8081 tcp:8081

# Keep diagnostics even when Maestro assertions fail.
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
  tail -n 150 .maestro-results/metro.log || true
fi

exit "$TEST_EXIT_CODE"

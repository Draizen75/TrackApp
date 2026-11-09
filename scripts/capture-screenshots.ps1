$ErrorActionPreference = "Stop"

# Run from the TrackApp repository root.
if (-not (Test-Path "package.json")) {
  throw "Run this script from the TrackApp repository root."
}

if (-not (Test-Path "node_modules")) {
  npm ci
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed." }
}

# Install Playwright without changing package.json or package-lock.json.
npm install --no-save --package-lock=false playwright
if ($LASTEXITCODE -ne 0) { throw "Playwright installation failed." }

npx playwright install chromium
if ($LASTEXITCODE -ne 0) { throw "Chromium installation failed." }

$server = Start-Process -FilePath "npx.cmd" -ArgumentList "expo start --web --port 8081 --non-interactive" -PassThru -NoNewWindow
try {
  $ready = $false
  for ($i = 0; $i -lt 120; $i++) {
    try {
      Invoke-WebRequest "http://127.0.0.1:8081" -UseBasicParsing | Out-Null
      $ready = $true
      break
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  if (-not $ready) { throw "TrackApp web server did not become ready on port 8081." }

  node scripts/capture-screenshots.cjs
  if ($LASTEXITCODE -ne 0) { throw "Screenshot capture failed." }
  Write-Host "Screenshots saved under artifacts/screenshots/"
}
finally {
  if ($server -and -not $server.HasExited) {
    Stop-Process -Id $server.Id -Force
  }
}

# TrackApp UI screenshot capture

This project uses Playwright to capture the real Expo web-rendered TrackApp screens at two responsive viewport sizes:

- Desktop: 1440 × 1000
- Mobile: 390 × 844

The capture covers the five primary tabs: Dashboard, Quick Entry, Debtors, History, and Settings. Screens are saved under `artifacts/screenshots/{desktop,mobile}/`.

## Run on Windows

From the repository root in PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\capture-screenshots.ps1
```

The script installs Playwright and Chromium locally without editing the project's package manifest or lockfile, starts Expo web, captures the screens, and stops the server.

## Run in GitHub Actions

The **TrackApp UI screenshots** workflow runs on pull requests that change app UI/configuration and can also be started manually from the Actions tab. Download the `trackapp-ui-screenshots` artifact from the workflow run.

## Scope and limitations

These are screenshots of the actual app running through Expo web at desktop and mobile responsive sizes. They are not fabricated device mockups. They do not claim to be native Android emulator captures.

The current automated pass captures each top-level tab in its initial state. It does not submit forms, create or modify ledger data, open every modal, or exercise destructive actions. This avoids changing a real user's financial data. Empty states will appear when the web database has no sample data.

For native Android screenshots, run the app on an Android emulator/device and capture using Android Debug Bridge after navigating to the required screen. Native-only UI can differ from Expo web rendering.

## Output

```
artifacts/screenshots/
  desktop/
    dashboard.png
    quick-entry.png
    debtors.png
    history.png
    settings.png
  mobile/
    dashboard.png
    quick-entry.png
    debtors.png
    history.png
    settings.png
```

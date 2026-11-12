# TrackApp 🪙

TrackApp is an Expo mobile ledger and counter-float manager for Sari-Sari store merchants. It records cash services, e-loads, TV loads, wallet float, customer credit, debt payments, and exports.

## 🌟 Highlights

- Ledger-safe money handling with cent-level rounding.
- SQLite guards for wallet overdrafts, debt overpayments, invalid targeted payments, and invalid wallet/customer references.
- Customer transaction history is preserved: customers with any ledger history cannot be deleted.
- FIFO fee-first debt allocation (unpaid contractual fees before principal), optional targeted debt payments, and separate contractual versus extra-profit earnings.
- Paginated transaction history and virtualized lists for responsive scrolling with larger ledgers.
- Offline-first persistence: Expo SQLite on Android/iOS; IndexedDB on web, with migration from legacy localStorage data where available.
- CSV and JSON backup export, validated backup restore, configurable fees, custom wallets, SMS reminders, and copy-to-clipboard fallback.

## 🎨 Design and interaction

TrackApp uses an obsidian-and-gold ledger aesthetic designed for quick, reliable use at a store counter:

- Deep obsidian backgrounds and layered dark surfaces keep financial data readable in low-light environments.
- Gold gradients identify primary actions, while green, amber, red, and blue are reserved for semantic success, warning, error, and informational states.
- Lucide icons, clear labels, accessible touch targets, pressed feedback, safe-area spacing, and haptic confirmation make actions easy to recognize and confirm.
- Toast notifications provide non-blocking feedback for saves, errors, and reminders.
- Transaction and debtor screens use paginated and virtualized lists to keep the interface responsive as the ledger grows.
- Forms and sheets use keyboard avoidance so controls remain reachable while entering amounts, customer data, or wallet balances.

## 🛠️ Technology

- Expo SDK 56, React Native 0.85, React 19, TypeScript
- Expo Router and TanStack Query
- Expo SQLite for native persistence
- IndexedDB for web persistence
- NativeWind and React Native components for the interface

## 📋 Prerequisites

- Node.js 20.19 or later
- npm
- An Expo account and EAS CLI login only when creating cloud builds

## 🚀 Install and run

```bash
npm install
npm run start
```

From the Expo terminal, press:

- `a` for Android
- `i` for iOS
- `w` for web

You can also run:

```bash
npm run android
npm run web
```

## ✅ Quality checks

Run these before committing or building:

```bash
npm run lint
npx tsc --noEmit
npm test -- --runInBand
```

The test suite covers ledger calculations, database guard triggers, backup validation, web persistence, history pagination, utility behavior, and toast feedback.

## 📦 Build an installable Android APK

The `preview` EAS profile produces an installable `.apk` for Android devices and emulators:

```bash
npx eas-cli@latest login
npx eas-cli@latest build --platform android --profile preview
```

The `production` profile uses Expo's default Android App Bundle (`.aab`) format for Google Play distribution. Do not submit an APK to Google Play.

## 🛡️ Data integrity rules

- A wallet cannot fall below zero.
- A debt payment cannot exceed either the customer balance or a selected debt's remaining balance.
- A targeted payment cannot predate the debt it settles.
- A debt with targeted payments cannot be deleted or materially changed until its dependent payments are removed.
- Backup restores are validated before existing data is cleared and run transactionally.

## 💾 Backups and exports

Use the **Data** tab to:

- export a CSV ledger;
- export a JSON backup;
- restore a JSON backup after previewing it; or
- reset the ledger after confirmation.

Treat exported backups as sensitive business data.

## 📁 Project structure

```text
src/app/              Expo Router routes and screens
src/components/       Shared interface components and feedback
src/db/               SQLite schema, indexes, triggers, and migrations
src/hooks/            Data queries, ledger calculations, and mutations
src/utils/            Small pure formatting and calculation utilities
tests/                Regression and behavior tests
eas.json              EAS build profiles
```

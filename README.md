# TrackApp 🪙

[![Launch with Expo](https://github.com/expo/examples/blob/master/.gh-assets/launch.svg?raw=true)](https://launch.expo.dev/select-repo?repo-url=https://github.com/Draizen75/TrackApp.git)

> A high-fidelity, premium mobile ledger and counter-float management application for Sari-Sari store merchants.

TrackApp is built using **Expo SDK 56**, **React Native**, and **TypeScript**, with native persistence powered by **Expo SQLite** and Web/Preview environments managed via a synchronized **localStorage mock engine**. The visual design follows a **Warm Architectural & Premium Fintech Aesthetic** (glassmorphism, slate-charcoal bases, warm amber accents, haptic feedback, and responsive layout scaling).

---

## 🌟 Key Features

### 1. Counter Float Management & Dashboard
*   **Hero KPI Panel**: Displays **True Net Profit** with detailed sub-descriptions, alongside gross fees collected, store expenses incurred, and outstanding customer debt (lends/credit) in an aligned column grid.
*   **Responsive Allocation Analytics**: Features a responsive donut chart visualization showing the float distribution across all registered payment channels.
*   **Fast Log Shortcuts**: Direct click actions next to recent transactions allow merchants to edit logs instantly or revert balance impacts.

### 2. Dynamic Custom Wallets & Hashed Brand Colors
*   **Wallet Registration**: Register custom wallets and bank accounts (e.g. BDO, BPI, ShopeePay) with custom initial balances.
*   **Deterministic Coloring**: Custom wallets are dynamically assigned high-contrast brand colors (Violet, Crimson, Cyan, Pink, Indigo, Orange, Teal, Emerald, Lime, Magenta) hashed deterministically from their names. This color identity propagates across all statistics screens, list borders, and float allocation charts.
*   **Reference Guarded Deletion**: Custom wallets can be deleted only if they do not contain any linked transactions or expenses, preventing ledger data corruption.

### 3. Smart Debtors & Settle Ledger System
*   **Active vs Settled Divisions**: Split customer credit lists into outstanding debts and settled accounts.
*   **Itemized Statement Statements**: View a customer's detailed statement ledger history with precise date stamps and channel references.
*   **Profile Deletion**: Settled customers with a `₱0.00` balance can be permanently deleted to clean up the database. Past transaction histories associated with them remain as anonymous entries in reports.

### 4. Mathematical Precision & Deduct Fee Guardrails
*   **Deduct Fee from Principal**: Handles advanced ledger tracking where service fees are either added on top (`deduct_fee = 0`, client owes `amount + fee`) or subtracted from the payout (`deduct_fee = 1`, client owes only `amount`).
*   **Negative Balance Guards**: Features native SQLite triggers (`tr_wallet_balance_guard`) and web simulation checks that roll back transactions and throw warnings if a wallet's balance would drop below `₱0.00`.
*   **Submission Double-Tap Protection**: In-flight submission states discard rapid multi-clicks to prevent duplicate transactions, double payments, or double-deductions.

### 5. Seamless Native UX Integrations
*   **Sliding Toast Notifications**: Replaced blocking alerts with sliding glassmorphic success and warning capsules that animate from the device Safe Area notch.
*   **Keyboard Avoidance sheets**: All text input sheets (adjusting float balances, registering wallets, paying off debts) are wrapped in `<KeyboardAvoidingView>` containers, resizing modal views above the keyboard.
*   **Safe Area Bottom Navigation**: The floating tab navigation capsule resizes dynamically based on device safe area insets to stay positioned above native software navigation bars.

---

## 🛠️ Technology Stack
*   **Framework**: Expo (SDK 56) with Expo Router (v3) file-based routing.
*   **Language**: TypeScript (ESLint & Expo Lint configured).
*   **Styling**: Vanilla React Native stylesheet tokens.
*   **Database**: Native Expo SQLite (`expo-sqlite`) for mobile builds; localStorage mock engine for Web previews.
*   **Icons**: Lucide React Native (`lucide-react-native`).
*   **Feedback**: Expo Haptics (`expo-haptics`) impact vibrations.

---

## 🚀 Getting Started

### 1. Installation
Clone the repository and install the dependencies:
```bash
npm install
```

### 2. Running Locally (Development Server)
Start the Expo Metro bundler:
```bash
npm run start
```
*   Press **`a`** to launch on an Android emulator or connected device.
*   Press **`i`** to launch on an iOS simulator.
*   Press **`w`** to open the web-preview browser model.

### 3. Database Management & Backups
*   **Export Ledger**: Navigate to the Control Center and press **Export & Share CSV Ledger** to compile transaction history.
*   **Clear Storage**: Reset databases and local caches via **Wipe Database Ledger** inside the Admin panel (requires confirmation).

---

## 📁 Directory Structure
*   `src/app/` — Expo Router file-based screens and layouts.
*   `src/app/(tabs)/` — Main tab routes (Dashboard, Entry form, Debtors list, Control Center settings).
*   `src/hooks/` — SQLite and LocalStorage mock database hooks (`useDbQueries.ts`).
*   `src/db/` — Native SQLite schemas and initialization scripts (`db.ts`).
*   `src/components/` — Global UI overlays, including the sliding `ToastProvider` (`toast.tsx`).
*   `assets/` — Brand app assets, including custom golden launcher icons and splash screens.

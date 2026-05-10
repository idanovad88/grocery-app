# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Homio** is a Hebrew-language household management PWA for Israeli families. It is built with React 19 + Vite on the frontend and Firebase (Firestore, Auth, Storage, Cloud Functions) on the backend. The app is deployed on Vercel (auto-deploys from `main`).

## Commands

```bash
# Frontend
npm install          # install dependencies
npm run dev          # local dev server (http://localhost:5173)
npm run build        # production build
npm run lint         # ESLint check
npm run preview      # preview production build locally

# Cloud Functions (from functions/)
cd functions && npm install
npm run serve        # start functions emulator only
npm run deploy       # deploy functions to Firebase
npm run logs         # tail function logs
```

There is no test suite.

## Architecture

### Single-file frontend (`src/App.jsx`)

The entire React application lives in one large file (~4900+ lines). All screen components, utilities, Firebase initialization, and the root `GroceryApp` component are co-located here. There is no router — navigation is state-based via a `screen` string and `navigateTo()`.

**App flow:**
1. `GroceryApp` (default export) mounts and checks auth state via `onAuthStateChanged`.
2. Auth: Google Sign-In only (`signInWithPopup` / `signInWithRedirect`). No anonymous auth for new users.
3. After sign-in, user picks a household from `HouseholdPickerScreen`. Household state is persisted to `localStorage` (`grocery-householdId`, `grocery-householdName`).
4. Main `HomeScreen` shows a draggable module grid. Each module is opt-in per household and stored in Firestore.
5. Clicking a module navigates to its screen component. All back buttons call `window.history.back()`.

**Screens defined in App.jsx (in order):**
- `LoginScreen` — Google OAuth gate
- `HouseholdPickerScreen` — multi-household list
- `HouseholdSetup` — create or join household via 6-char invite code
- `HomeScreen` — module grid with drag-to-reorder (order stored in localStorage per household)
- `ShoppingScreen` — shared shopping list
- `CouponsScreen` — coupons/vouchers with image/PDF attachments
- `InsuranceScreen` — insurance policy documents
- `PersonalDocsScreen` — personal documents (IDs, licenses, etc.)
- `BirthdaysScreen` — family birthday tracker
- `ServiceProvidersScreen` — home service provider contacts
- `SubscriptionsScreen` — recurring subscription tracker
- `BillsScreen` — bill tracking with Gmail import (AI-powered)
- `SplitBillsScreen` — expense splitting between household members

### PWA & Android Back Button

On mount, two sentinel history entries are pushed so history position ≥ 2. This prevents Chrome from exiting the standalone PWA when the Android back button is pressed. `navigateTo(screen)` wraps `pushState` + `setScreen`. A `popstate` listener re-anchors the stack and syncs React state.

### Firestore Data Model

All data lives under `/households/{hid}/` subcollections. The household doc contains:
- `members: [uid, ...]` — controls all read/write access
- `memberNames: { uid: displayName }` — denormalized display names
- `inviteCode` + `inviteCodeExpiry` — 6-char, 24h-expiry join code
- `enabledModules: [moduleId, ...]` — which modules are active for this household

Subcollections: `items`, `coupons`, `insurance`, `birthdays`, `subscriptions`, `personal_docs`, `service_providers`, `bills`, `splitBills`.

Firestore rules enforce `isMember(hid)` for all subcollection access. The `list` rule on `/households` is open (for invite-code join queries) but capped at `limit <= 20`.

### Firebase Storage

All uploads are stored at `households/{hid}/{module}/{timestamp}_{filename}`. Accepted types: images and PDFs, max 10 MB. Storage rules cross-reference Firestore membership via `firestore.get()`.

### Cloud Function: `scanGmailBills`

Located in `functions/index.js`. An `onCall` function (Node 20, `us-central1`, 512 MiB, 120s timeout) that:
1. Accepts a user's Google OAuth access token and `householdId`.
2. Searches Gmail for Hebrew/English bill emails (last 90 days).
3. Extracts email body text + parses PDF attachments via `pdf-parse`.
4. Sends text to **Claude Haiku** (`claude-haiku-4-5-20251001`) for structured extraction of `{ provider, amount, dueDate }`.
5. Returns extracted bills to the client for user review before saving.

The function requires `ANTHROPIC_API_KEY` as a Firebase environment secret.

### Key Shared Primitives

- **`SwipeItem`** — touch + mouse swipe gesture component. Left swipe = delete (red), right swipe = edit (purple). Used across all list screens.
- **`MODULES`** — array defining all available modules with `id`, icon, label, color, and `optional` flag. Optional modules must be explicitly enabled per household.
- **`PRIORITY_CONFIG`** — red/yellow/green priority labels used in ShoppingScreen.
- **`inputStyle`** — shared inline style object for all text inputs (RTL, Rubik font, rounded).
- **`getUserColor(name)`** — deterministic color assignment from `USER_COLORS` array based on name hash.

## Conventions

- **Language**: All UI text is Hebrew. Code, variable names, and comments are English.
- **Direction**: The app is fully RTL (`dir="rtl"` on root containers). Always set `direction: "rtl"` on new inputs.
- **Styling**: All styles are inline (`style={{}}`). No CSS files or CSS-in-JS libraries. Font is `'Rubik', sans-serif` throughout.
- **Firebase**: `db`, `auth`, `storage`, and `functions` are module-level singletons initialized at the top of `App.jsx`. The Firebase config (API key, project ID) is checked into the repo — this is intentional for a public Firebase project where security is enforced by Firestore/Storage rules.
- **No router**: Adding new screens means: (1) defining a new `function XxxScreen(...)` component in App.jsx, (2) adding an entry to the `MODULES` constant, (3) adding a `screen === "xxx"` branch in `GroceryApp`'s render, (4) adding the module to Firestore `enabledModules` logic.
- **ESLint**: `no-unused-vars` is set to error but ignores `UPPER_CASE` names. Unused lowercase variables will fail lint.
- **Firestore queries**: Any `getDocs` / `onSnapshot` on `/households` must include `.limit(≤20)` or the security rules will reject it.
- **Invite codes**: Always 6 uppercase alphanumeric characters, 24-hour expiry. Use `generateCode()` and `expiryFromNow()`.

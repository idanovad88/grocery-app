# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev          # Start Vite dev server (HMR enabled)
npm run build        # Production bundle
npm run preview      # Preview production build locally
npm run lint         # Run ESLint

# Cloud Functions (run from functions/)
cd functions && npm install   # Install function dependencies

# Firebase deploy (requires firebase-tools)
firebase deploy --only functions   # Deploy Cloud Functions only
firebase deploy --only firestore   # Deploy Firestore rules/indexes only
firebase deploy                    # Deploy everything
```

There is no test suite — ESLint is the only automated code quality tool.

## Architecture

### Frontend

The entire frontend lives in **`src/App.jsx`** (~4,700 lines). This is intentionally monolithic — all screens, state, and UI logic in a single file. There is no React Router; screen navigation is driven by a `screen` state string and `if/else` rendering. There is no global state library; state is managed with `useState`/`useEffect`/`useRef` per feature, all hoisted into the root `GroceryApp` component.

All styling is inline JavaScript objects — no CSS files, no CSS framework.

**Screen flow:**
1. Firebase anonymous auth on load → check for existing `householdId` in localStorage
2. If no household: `login` → `nameSetup` → `householdSetup` (create or join via invite code)
3. Main hub: `home` (module picker) → individual module screens
4. URL param `?join=CODE` triggers invite-code deep-link flow

**Key UI conventions:**
- `SwipeItem`: touch-based swipe-left-to-delete pattern used across all list screens
- `GlobalStyles`: renders a `<style>` tag with shared CSS (scrollbars, animations, etc.)
- Modals/sheets are plain `div` overlays — no modal library
- Color palette per user (for split bills, shopping items) and per priority level

### Firebase / Backend

**Project:** `grocery-app-5fa03`

**Firestore data model** (all data is household-scoped):
```
households/{hid}
  .members[]           # array of uid strings
  .memberNames{}       # uid → display name map
  .inviteCode          # 6-char code, 1-day expiry
  .enabledModules[]    # feature toggles per household

households/{hid}/items/{id}          # shopping list
households/{hid}/coupons/{id}        # discount coupons
households/{hid}/insurance/{id}      # insurance policies
households/{hid}/birthdays/{id}      # birthdays
households/{hid}/subscriptions/{id}  # recurring payments
households/{hid}/service_providers/{id}
households/{hid}/bills/{id}          # bill tracking (gmailMessageId for dedup)
households/{hid}/splitBills/{id}     # split expense calculator
households/{hid}/personal_docs/{id}  # ID cards, licenses, scanned docs
```

**Storage paths:** `households/{hid}/{module}/{filename}` — membership is verified via a cross-service Firestore lookup in `storage.rules`. File size cap: 10 MB; allowed types: images + PDFs.

**Firestore rules:** Reads/writes to any `households/{hid}/**` subcollection require `uid` to be in `households/{hid}.members[]`. There is a self-join rule that allows a user to add themselves to `members` (server-side invite code validation is not yet enforced — noted as a future improvement in the rules file).

### Cloud Functions (`functions/index.js`)

Single callable function: **`scanGmailBills`**

Flow:
1. Verify Firebase auth context + household membership
2. Query Gmail API for bill-related emails (last 90 days)
3. Decode HTML/plain-text bodies and extract PDF attachments (`pdf-parse`)
4. Send content to **Anthropic Claude Haiku** (`claude-haiku-4-5`) with a Hebrew-aware prompt
5. Claude returns structured JSON: `{ provider, amount, dueDate }`
6. Write to Firestore `bills` subcollection; deduplicate by `gmailMessageId`

The Anthropic API key is provided via `process.env.ANTHROPIC_API_KEY` (set as a Firebase Function secret, not committed).

### PWA

- `public/sw.js`: cache-first service worker; returns 503 offline fallback
- `public/manifest.json`: app name "Homio", standalone mode, RTL
- The app is deployed on **Vercel** (CSP/HSTS headers in `vercel.json`) with Firebase backend

### Localization

The app is Hebrew-first (RTL). The HTML root has `dir="rtl" lang="he"`. All user-visible strings in `App.jsx` are in Hebrew. When adding new UI text, use Hebrew.

## Key Conventions

- **Adding a new module:** Add a Firestore subcollection path, add a new screen component function inside `App.jsx`, add an entry to the `HOME_MODULES` array and the `screen` routing block, optionally add to `enabledModules` if it should be opt-in.
- **Real-time data:** Use `onSnapshot()` for all Firestore reads that need live updates. Subscribe in `useEffect` and return the unsubscribe function.
- **Firebase config** is hardcoded in `App.jsx` (public Firebase client config — not a secret, but be aware when reviewing diffs).
- **No TypeScript** — stay in plain JSX.

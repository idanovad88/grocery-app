# Grocery App

A household grocery and home-management PWA built with React + Vite, backed by Firebase (Auth, Firestore, Storage, Cloud Functions) and deployed on Vercel.

## Stack

- **Frontend**: React 19, Vite
- **Backend**: Firebase (Firestore real-time DB, Auth, Storage, Cloud Functions)
- **Hosting**: Vercel (auto-deploys from `main`)

## Navigation

The app uses state-based navigation (`useState`) rather than a router. All screens live in `src/App.jsx` and are rendered conditionally based on a `screen` string.

### Android back button (PWA)

To prevent Chrome from closing the standalone PWA when the user presses the Android back button, the app integrates the browser History API:

- On mount, two sentinel entries are pushed so the user starts at history position ≥ 2. Chrome only exits the PWA when navigation would go below position 0 (the initial app URL); by keeping the user at position 1+, the PWA stays open.
- `navigateTo(screen)` wraps `pushState` + `setScreen` for forward navigation.
- A `popstate` listener syncs React state and re-anchors the history stack whenever the back button is pressed.
- In-app back buttons call `window.history.back()` so both the Android system back and the in-app button share the same code path.

## Development

```bash
npm install
npm run dev      # local dev server
npm run build    # production build
```

# Feature check: APK vs the live portal

Checked `https://cypher-green-systems.vercel.app/` on 2026-10-21.

## Short answer

The APK renders the live site, so it has the site's features — but **the APK you had was pointed at a
placeholder domain** (`cgs-portal.vercel.app`), not your deployment. It has now been rebuilt against
`cypher-green-systems.vercel.app` (v1.3.0). Three things still need your attention: downloads
(fixed in v1.3.0), Google sign-in (blocked by Google inside WebViews), and two files missing from
your deployment.

## 1. Your deployment is the *original* app, not the modified one

| File | Live | Needed for |
|---|---|---|
| `/manifest.webmanifest` | **404** | PWA install prompt, Android splash/theme colour |
| `/.well-known/assetlinks.json` | **404** | Removes the browser bar from the TWA APK; https deep links |
| `/icons/icon-192.png` | **404** | App/PWA icon when installed from the browser |
| `/download/android` | **404** | The kiliMoja-style download page |

You deployed the source as you received it. The version in `CGS-portal-main/` here has these files
(`src/app/manifest.ts`, `public/.well-known/assetlinks.json`, `public/icons/*`, `vercel.json`) —
**redeploy that folder** and all four stop 404ing.

Until `assetlinks.json` is live, the **TWA** APK (2.8 MB) shows a thin browser address bar. The
**native** APK (6.9 MB) does not depend on it.

## 2. Routes verified on your deployment

| Route | Result |
|---|---|
| `/`, `/explore`, `/projects`, `/marketplace`, `/how-it-works`, `/features`, `/faq`, `/about`, `/contact`, `/privacy`, `/terms`, `/platform` | 200 |
| `/login`, `/register`, `/ferd`, `/ferd/login`, `/ferd/register` | 200 |
| `/dashboard`, `/dashboard/gis`, `/dashboard/projects`, `/dashboard/monitoring`, `/dashboard/command`, `/dashboard/marketplace` | 307 → `/login` (auth working) |
| `/ferd/dashboard` | 307 → `/ferd/login` |
| `/admin/ferd` | 307 → `/ferd/admin` |
| `/geo/regions/KE` | 200 `application/json` (map drill-down data works) |
| `/api/payments/status` | 401 (expected without a session) |

Supabase env vars are clearly configured server-side, since auth redirects and the regions API work.

## 3. Feature matrix inside the APK

Because the native APK is a WebView shell, "has the feature" means "the live site handles it in a
WebView". Verified per feature:

| Feature | In the APK | Notes |
|---|---|---|
| Public pages, Explore, Earth/GIS map | ✅ | MapLibre GL needs WebGL; Android System WebView has it, hardware acceleration is on |
| Sign up / sign in (email + password) | ✅ | Cookies persist in the WebView |
| FERD student login (reg no + password) | ✅ | |
| Dashboards, projects, tasks, MRV, marketplace, community | ✅ | Same server-rendered pages |
| File **uploads** (documents, project boundaries, field photos, FERD attachments) | ✅ | Capacitor implements `onShowFileChooser`; camera + gallery work |
| Camera + geolocation prompts | ✅ | Native permissions declared in the manifest |
| **Downloads** (PDF reports, GIS export, FERD files) | ✅ **as of v1.3.0** | Capacitor has no download support; the old APK silently ignored these. Now handled by Android's DownloadManager with the session cookie |
| Offline field capture (`/dashboard/monitoring/offline`) | ✅ | Service worker + IndexedDB both work in WebView |
| **Google sign-in** | ✅ **as of v1.4.0** | Was blocked (Google refuses OAuth in WebViews). Now opens a Custom Tab, returns via `cgs://auth-callback`, exchanges the code in the WebView. Requires adding `cgs://auth-callback` to Supabase → Auth → Redirect URLs — see `GOOGLE-SIGN-IN-FIX.md` |
| Push notifications | ❌ | No FCM configured (kiliMoja doesn't have this either) |
| Truly offline data (records readable with no network) | ❌ | The shell has the plugins but the pages don't call them yet — the bridge work described earlier |
| M-Pesa STK push | ⚠️ | Works if `MPESA_ENABLED=true` and Daraja keys are set; payments aren't affected by the shell |

## 4. What changed in v1.3.0

- `capacitor.config.json` → `https://cypher-green-systems.vercel.app/`
- `offline.html` retry URLs + Android App Links host → your domain
- `MainActivity.java` → DownloadManager with cookie/user-agent forwarding for authenticated exports
- TWA APK rebuilt to v1.2.0 with `app_url` + intent-filter host on your domain

## 5. Still on your side

1. Redeploy `CGS-portal-main/` so `assetlinks.json` + manifest + icons go live.
2. Confirm in Supabase → Auth → URL Configuration: Site URL `https://cypher-green-systems.vercel.app`,
   redirect URLs `https://cypher-green-systems.vercel.app/**`. Add
   `https://cypher-green-systems.vercel.app/auth/callback` to Google Cloud if you use Google sign-in.
3. Tell me if you want the Google OAuth fix (@capacitor/browser + deep link) or the offline bridge.

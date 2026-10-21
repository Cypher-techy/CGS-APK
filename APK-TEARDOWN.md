# Teardown: kiliMoja APK vs. your CGS APK

Analysed on 2026-10-21 from `https://www.kilimoja.com/download/android`
(HTTP 307 → `https://cdn.kilimoja.com/apk/kilimoja-1.0.7.apk`, 72,338,453 bytes,
SHA-256 `3ac27dd1…9e1c3a`).

---

## 1. What their APK actually is

**A React Native app built with Expo (SDK 57)** — not a website wrapper at all. The JavaScript is
compiled into the package and runs on Hermes, the React Native engine, with native modules for
SQLite, camera, files and OTA updates.

| Fact | kiliMoja 1.0.7 | Your CGS 1.0.0 |
|---|---|---|
| Type | React Native / Expo (SDK 57) native app | Trusted Web Activity (web app in Chrome) |
| Package | `co.kilimoja.app` | `com.cyphergreensystems.cgs` |
| Version | 1.0.7 (versionCode 8) | 1.0.0 (versionCode 1) |
| APK size | **69 MB** (102 MB uncompressed) | **2.7 MB** |
| Code inside | 44.4 MB dex + 23.4 MB native libs + 3.8 MB JS bundle | none (loads site from network) |
| minSdk / targetSdk | 24 / **36** (Android 16) | 21 / 35 |
| CPU | arm64-v8a only | all (no native code) |
| Launch activity | `co.kilimoja.app.MainActivity` | TWA `LauncherActivity` |
| Permissions | camera, record audio, vibrate, network state, storage (≤32), SYSTEM_ALERT_WINDOW, Play install-referrer | internet, location |
| Signing | **Android Debug certificate** (`CN=Android Debug`, SHA-256 `fac61745…`) — v2 only | own key `CN=Cypher Green Systems`, v1+v2 |
| Works offline | Yes — expo-sqlite database + sync queue | only the field-capture page |
| Language | English + Kiswahili (`sw-KE`) | English |
| Updates | Native modules for Expo Updates (OTA) present | any redeploy of the site |
| App Links / TWA | none — `/.well-known/assetlinks.json` returns **404** | assetlinks.json included, pinned |
| Build fingerprint | AGP 8.12.0, Expo app config embedded at `assets/app.config` | AGP 8.7.3, hand-written Gradle |

Expo config recovered from `assets/app.config`:

```json
{"name":"kiliMoja","slug":"kilimoja","version":"1.0.7","orientation":"portrait",
 "scheme":"kilimoja","android":{"package":"co.kilimoja.app",
 "adaptiveIcon":{"backgroundColor":"#FFFFFF","foregroundImage":"./assets/images/android-icon-foreground.png",
                  "monochromeImage":"./assets/images/android-icon-monochrome.png"}},
 "plugins":["expo-router",["expo-splash-screen",{...}],"expo-sqlite","expo-font"],
 "sdkVersion":"57.0.0","extra":{"eas":{"projectId":"ba73d01e-…-9414f58a817d"}}}
```

Native modules identified: `expo-router`, `expo-sqlite`, `expo-image`, `expo-imagepicker` (+
`com.canhub.cropper`), `expo-filesystem`, `expo-font`, `expo-splash-screen`, `expo-statusbar`,
`expo-webbrowser`, `expo-updates`, `expo-webview`, `react-native-reanimated`, `react-native-worklets`,
`react-native-screens`, `react-native-gesture-handler`, `@react-native-community/webview`,
Supabase JS (in the bundle), `expo-dev-client` **and** `expo-dev-launcher`/`dev-menu` (dev tooling).

### How they distribute it

1. Website button → `/download/android`
2. That route is a **307 redirect** (no landing page, no HTML) to a versioned file on a separate CDN
   host: `cdn.kilimoja.com/apk/kilimoja-1.0.7.apk`
3. Served with the correct `application/vnd.android.package-archive` type, so Android opens the
   installer directly
4. Website copy: "Android · Open the downloaded file to install", plus **"Coming soon on Google Play"**

---

## 2. The honest comparison

Their app is more capable than yours at three things, and worse at others:

**Better:** real offline data layer (SQLite, not just a cached page), native camera/crop, native
splash + portrait lock + themed monochrome icon, OTA JS updates without reinstalling, and it never
shows a browser fallback.

**Worse / do not copy:**

- **Signed with the Android Debug certificate.** Play Protect warns, nobody can verify the author,
  and it cannot be listed on Play without re-signing (which changes the identity and breaks updates
  for existing installs).
- **69 MB and only arm64-v8a.** Every user pays the dev-tooling weight (dev menu, logbox, dev
  launcher, 90 locales, 5 icon densities); 32-bit-only phones cannot install it.
- **`SYSTEM_ALERT_WINDOW` permission** (draw over other apps) leaks in from the dev menu — a
  red flag on any store listing.
- No assetlinks, so **no verified deep links** — their `https` intent filter has no host, so
  kilimoja.com links open the browser, not the app.
- No push notifications despite a "community" product (no FCM/Firebase Messaging module found).
- The download route has **no version metadata, no checksum, no install instructions page** — a user
  cannot tell what version they are getting or verify the file.

For a Kenyan field app, size matters: 69 MB over mobile data versus 3 MB is a real adoption cost.

---

## 3. Three ways to get "exactly like this"

### Route A — keep the TWA, copy their download experience (hours, no rewrite)
You stay at ~3 MB, updates on every deploy, and you gain the parts users actually see: a proper
`/download/android` page (version, size, checksum, install steps), a versioned file served from your
own domain/CDN, a `/download/android/latest.json` version endpoint, release signing (already done),
and versionCode discipline. You will **not** get native offline SQLite or camera APIs.

### Route B — Capacitor native shell around your Next.js app (days)
Capacitor packages your built web app inside a native Android shell with real plugins:
`@capacitor/camera`, `@capacitor/geolocation`, `@capacitor/filesystem`, `@capacitor/preferences`
(plus `@capacitor-community/sqlite` if you want a real local DB), native splash, portrait lock,
themed icon, offline shell via service worker, and a ~8–15 MB APK. You keep the whole Next.js
codebase and its server actions; only the mobile shell is new. This is the closest "feels exactly
like kiliMoja" you can get without rewriting the product.

### Route C — port to Expo / React Native (weeks–months)
Only this gives an identical APK: `expo-router` screens calling your existing Supabase backend,
`expo-sqlite` offline queue, `expo-image-picker` camera, `expo-notifications` push (which they lack),
EAS Build for signing and EAS Update for OTA. Your Next.js app stays as the admin/GIS/desktop
product. Realistically this is a separate mobile codebase for the student/field-facing flows
(`/ferd/*`, monitoring capture, tasks, notifications) — not the whole GIS Earth workspace.

### Recommendation for CGS
Route B now (days, big perceived-native jump, keeps one codebase), keep the current TWA APK as the
"lite" build until the Capacitor one ship. Go to Route C only if the mobile app becomes the primary
product and you need offline-first data + push at scale. Their 69 MB debug build is not a good
target to clone literally.

---

## 4. Checklist to match them (and beat them)

**Identity & build**
- [x] Own applicationId (`com.cyphergreensystems.cgs` — theirs is `co.kilimoja.app`)
- [x] Release keystore (not a debug key) — yours already is
- [ ] `versionCode` +1 on every release, `versionName` semver (`1.0.7` style, visible in-app)
- [ ] `targetSdk` 36 (Android 16) — Expo SDK 57 / AGP 8.12 level; yours is 35
- [ ] Build an **AAB** (`bundleRelease`) for Play, APK for direct download
- [ ] Reduce size: ABI splits or arm64-only for the direct APK once you're native
- [ ] `minSdk` 24 is enough for Kenya's phone fleet

**Look and feel**
- [x] Adaptive icon (foreground/background layers)
- [ ] Monochrome layer for Android 13 themed icons (`monochromeImage` in Expo)
- [ ] Splash: brand background `#0B0B0B`/`#F4F1E8` + centred mark, ~300 ms fade
- [ ] Portrait lock if the mobile flows are portrait-only
- [ ] Status/navigation bar colours matching the dark canvas
- [ ] Predictive back gesture handling

**Capability (only Route B/C delivers these)**
- [ ] Offline data: SQLite/local store + queued mutations + sync-on-reconnect indicator
- [ ] Camera + gallery + crop for field photos (`expo-image-picker` / Capacitor Camera + Cropper)
- [ ] Geolocation with a permission rationale screen
- [ ] File/PDF handling for FERD resources
- [ ] Push notifications (FCM) — M-Pesa payment results, deadline reminders, community replies
- [ ] Language switch EN/SW (`sw-KE`) with persisted choice
- [ ] Biometric/secure storage for session tokens (`expo-secure-store` / Capacitor Preferences+Keystore)
- [ ] OTA updates: EAS Update, or Capacitor live-update, or "update available" prompt

**Distribution & trust**
- [ ] `/download/android` page: version, build date, size, SHA-256, changelog, install steps
- [ ] Versioned artefact URL (`/apk/cgs-1.0.0.apk`) + `/download/android/latest.json`
- [ ] `application/vnd.android.package-archive` content type
- [ ] HTTPS only, no MITM (their file is HTTP-redirect-free; keep yours the same)
- [ ] Play Protect note in the instructions ("more details → install anyway" is normal for sideloads)
- [ ] Privacy policy URL reachable from the app (`/privacy` already exists)
- [ ] Support contact + version checker inside the app
- [ ] Later: Play Console listing with **Play App Signing** — then add Play's certificate SHA-256
      to `assetlinks.json`, and never lose the upload keystore

**What not to repeat from them:** debug certificate, dev-client/dev-menu modules in a public build,
`SYSTEM_ALERT_WINDOW`, 69 MB with 90 locales and no resource shrinking, no deep-link verification,
no checksum on the download.

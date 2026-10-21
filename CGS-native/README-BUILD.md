# CGS Native (Capacitor) — build a "kiliMoja-style" APK

This is a **native Android shell** around your deployed CGS Portal. Unlike the Trusted Web Activity
build (which is just Chrome in a window), this has a real native `MainActivity`, native splash
screen, portrait lock, themed launcher icon, system-bar control, camera, geolocation, filesystem,
preferences, network status, haptics — and no browser chrome or address bar ever.

| | TWA build (`CGS-portal-main/android`) | This build (`CGS-native`) |
|---|---|---|
| Size | ~2.7 MB | ~4–6 MB |
| Engine | Chrome Custom Tab | Android WebView (Debian/Chromium-based System WebView) |
| Splash | TWA splash meta-data | Real splash theme + animated hand-off |
| Camera / GPS / files | browser permission prompts | native plugins, permission rationale |
| Offline screen | browser error page | branded `offline.html` with auto-retry |
| Deep links | assetlinks only | `cgs://` scheme + https App Links |
| Signature | `cgs-release.keystore` | **same** keystore, same identity |

Both APKs share `applicationId com.cyphergreensystems.cgs` and the same signing key, so a user can
upgrade from one to the other in place without uninstalling.

---

## 1. Point it at your domain

`capacitor.config.json`:

```json
"server": { "url": "https://cypher-green-systems.vercel.app/", ... }
```

Change that URL, plus the host in `android/app/src/main/AndroidManifest.xml`
(`<data android:scheme="https" android:host="…" />`) and the two URLs inside
`www/offline.html` (`location.replace(...)` and the `setInterval` reload).

Then:

```bash
npx cap sync android
```

---

## 2. Build the APK

Requirements: JDK 17+ (21 recommended) and the Android SDK with platform 35 + build-tools 35.0.0.

```bash
cd android
echo "sdk.dir=$ANDROID_HOME" > local.properties
chmod +x gradlew
./gradlew assembleRelease
```

Output: `android/app/build/outputs/apk/release/app-release.apk`

Play Store bundle (`.aab`) instead:

```bash
./gradlew bundleRelease
# android/app/build/outputs/bundle/release/app-release.aab
```

Low-RAM machines: `android/gradle.properties` already pins `-Xmx900m`, `org.gradle.workers.max=1`
and `org.gradle.parallel=false`. If it still dies, run with
`GRADLE_USER_HOME=/tmp/gradle-home` so the 1.5 GB cache stays off your disk image.

Version bumps live in `android/app/build.gradle` (`versionCode` / `versionName`). Increment
`versionCode` for **every** upload.

---

## 3. Signing

`android/keystore/cgs-release.keystore` — alias `cgs`, store/key password `<keystore password — not in this repo>`,
SHA-256 `0A:CD:24:6B:C8:01:2A:17:D3:75:77:DC:F0:5E:9B:E4:8F:D5:F5:77:2A:1C:A3:07:20:EF:F5:47:25:93:AD:38`.

Because it matches `public/.well-known/assetlinks.json`, the site can verify this app and https
links open inside it rather than Chrome. If you generate a new keystore, update that file and
redeploy.

---

## 4. What the plugins give you

Installed and auto-registered (no Java code needed for basic use):

| Plugin | Use in CGS |
|---|---|
| `@capacitor/camera` | Field photos for monitoring records, FERD attachments |
| `@capacitor/geolocation` | "Use my location" on the map + geotagging field records |
| `@capacitor/filesystem` | Save/download PDFs, KML/GeoJSON exports on device |
| `@capacitor/preferences` | Persist session hints, language choice, queued-record index |
| `@capacitor/network` | Show the offline banner, trigger sync when back online |
| `@capacitor/splash-screen` | Native splash + hand-off to the web app |
| `@capacitor/status-bar` | Dark canvas status bar matching the design |
| `@capacitor/keyboard` | `adjustResize` so forms aren't hidden behind the keyboard |
| `@capacitor/haptics` | Tap feedback on primary actions |
| `@capacitor/app` | Back-button and app-state handling |

**Important:** installing a plugin does not change your web app by itself. The Next.js pages still
have to call them. Until you add that bridge, the app behaves like the TWA but with a native shell
and no browser UI.

The bridge (next step, ~a few files in the portal) would be:

1. `src/lib/native.ts` — detects Capacitor, exposes `takePhoto()`, `locate()`, `saveFile()`,
   `queueWhenOffline()` with web fallbacks so the browser build is unaffected.
2. `OfflineCapture.tsx` — use native camera + geolocation instead of `<input type=file>`; store the
   queue in `Preferences`/`Filesystem` so it survives app restarts (today it lives in the browser's
   IndexedDB).
3. `FerdShell` / dashboard shell — subscribe to `Network`, show a sync banner, replay the queue.
4. Optional: `App.addListener('backButton')` to make Android back navigate the router instead of
   exiting.

Ask and I'll implement it.

---

## 5. Install & distribute

- Sideload: copy the APK to the phone → tap → allow "install unknown apps" → *Install anyway*.
- Web download page: mirrors kiliMoja — a `/download/android` route that redirects to a versioned
  file (`/apk/cgs-1.1.0.apk`) with `Content-Type: application/vnd.android.package-archive`, plus
  version, size and SHA-256 shown on the page (they don't show a checksum; worth having).
- Play Store: `bundleRelease`, private `applicationId` on a domain you own, Play App Signing →
  add Play's certificate SHA-256 to `assetlinks.json` as well.

## 6. Where this still differs from kiliMoja

They are React Native + Expo: the UI is native views, data is in `expo-sqlite`, and updates ship as
JS bundles. This build is a WebView shell: the UI is your HTML/CSS, and the JS runs in the WebView.
Consequences:

- Theirs is genuinely offline-first; yours needs the bridge above plus a local store for that.
- Theirs gets OTA JS updates via Expo Updates; yours updates instantly anyway because it loads the
  live site — no reinstall needed.
- Theirs is 69 MB and arm64-only; this is a few MB and runs on any phone with an up-to-date
  Android System WebView (the Play Store keeps it current on virtually every device).

# CGS Portal — what you got

**Source:** `CGS-portal-main.zip` from your Google Drive — a Next.js 16 + Supabase app (CGS public
site, workspace, GIS/Earth, MRV, marketplace, FERD student portal).
**Reference:** kiliMoja's APK, inspected in `APK-TEARDOWN.md`.

Two APKs are built and signed with the **same key and applicationId**, so either can be installed
over the other without uninstalling.

---

## 1. The APKs (ready now)

| File | Size | What it is |
|---|---|---|
| `apk/CGS-native-1.4.0-release.apk` | 7.3 MB | **Capacitor native shell** — real `MainActivity`, native splash, portrait lock, themed icon, camera/GPS/files/network plugins, branded offline screen, no browser UI |
| `apk/CGS-1.2.0-release.apk` | 2.8 MB | Trusted Web Activity — Chrome-in-a-window, lightest option |

Both: package `com.cyphergreensystems.cgs` · minSdk 21/24 · targetSdk 35 · signed
`CN=Cypher Green Systems` · SHA-256 `0A:CD:24:6B:C8:…:25:93:AD:38` (pinned in `assetlinks.json`).

| | kiliMoja 1.0.7 (theirs) | CGS native (yours) |
|---|---|---|
| Kind | React Native + Expo SDK 57 | Capacitor WebView shell |
| Size | 69 MB, arm64 only | 6.9 MB, any phone |
| Signing | **Android Debug key** | your own release key |
| Offline | expo-sqlite + sync queue | branded offline screen + retry (data queue needs the bridge) |
| Updates | Expo OTA | instant — it loads the live site |

**Both APKs point at your live deployment: `https://cypher-green-systems.vercel.app/`.**
If the domain changes:
- native: `CGS-native/capacitor.config.json` → `server.url`, the `android:host` in
  `CGS-native/android/app/src/main/AndroidManifest.xml`, and the two URLs in
  `CGS-native/www/offline.html`; then `npx cap sync android` and rebuild
- TWA: `CGS-portal-main/android/app/src/main/res/values/strings.xml` (`app_url`) + the manifest host

**Install:** copy to the phone → tap → allow "install unknown apps" → *Install anyway* (Play Protect
warns about any app from outside Play).

---

## 2. The web app

`CGS-portal-deployable.zip` — app + `CGS-native/` + both APKs, no `node_modules`, no build output.

```bash
cd CGS-portal-main
npm i -g vercel && vercel login && vercel link
vercel --prod     # after adding env vars in the dashboard
```

Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_CONTACT_EMAIL`, `MPESA_ENABLED=false`,
`GEMINI_API_KEY`.

**Apply the Supabase migrations first** (`supabase link` + `supabase db push`) — `README.md` flags
recent ones (geo intelligence, FERD portal, community chat) that routes depend on.

---

## 3. What I added

**Branding**: the supplied CGS logo (`brand/logo-source.png`) is the app icon, launcher icon,
splash, in-app loader, offline screen and PWA/favicon set. Regenerate with
`python3 brand/build_icons.py`.

**Portal** (`CGS-portal-main/`): PWA manifest + full icon set, `assetlinks.json`, `vercel.json`
(Cape Town region, headers), TWA `android/` project, GitHub Actions APK workflow,
`DEPLOY-ANDROID.md`.

**Native** (`CGS-native/`): Capacitor 7 project, 11 plugins, adaptive + **monochrome** icon,
136 splash assets, portrait lock, real release signing, deep links, offline screen,
`README-BUILD.md`.

No application code, schema or styling was changed.

---

## 4. Verified here

- ✅ Capacitor `assembleRelease` → BUILD SUCCESSFUL (414 tasks)
- ✅ `apksigner verify` — v2 valid, fingerprint matches `assetlinks.json`
- ✅ `aapt2 dump badging` — `MainActivity` launcher, label "CGS", permissions correct
- ✅ TWA APK — signed, verified, SHA-256 recorded
- ⚠️ `next build` compiled cleanly; the full `tsc` pass didn't finish on this 2 GB box (slow, not
  failing). Vercel runs it — send me anything it reports.

## 5. Build notes / gotchas

- The sandbox is recycled between sessions: Android SDK, JDK and Gradle caches live outside
  `/home/user` and must be reinstalled each time; swap (`3 GB`) was needed to stop the Gradle daemon
  from being OOM-killed, and `GRADLE_USER_HOME` must sit on real disk (`/var/gradle-home`), not the
  992 MB `/tmp` tmpfs.
- Folder names `dist/`, `build/`, `out/` are **excluded from workspace snapshots** — that's why the
  APKs now live in `apk/`. Keep deliverables out of those names.
- Keystore: `CGS-native/android/keystore/cgs-release.keystore` (and a copy in
  `CGS-portal-main/android/keystore/`), alias `cgs`, password `<keystore password — not in this repo>`. Losing it means you
  can never update the app under the same identity.
- These are sideload builds. Google Play needs an `.aab` (`./gradlew bundleRelease`), a
  private domain-based `applicationId`, and Play App Signing's certificate added to
  `assetlinks.json`.

## 6. The one gap left vs kiliMoja

Their app is offline-first: SQLite storage, a mutation queue, native camera feeding records. This
shell has the plugins installed but your web pages don't call them yet, so it behaves like the site
in a native frame.

Closing that is a small bridge in the portal (~4 files): `src/lib/native.ts` helpers, native camera
+ geolocation in `OfflineCapture.tsx`, a `Preferences`/`Filesystem`-backed queue that survives app
restarts, a network banner that replays the queue, and hardware back-button routing. Say the word and
I'll build it.

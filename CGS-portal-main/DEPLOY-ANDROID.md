# CGS Portal — deploy to Vercel + Android APK

This folder is the app from `CGS-portal-main.zip` with the following additions, so that it can be
deployed to Vercel and shipped as an Android APK:

| Added | What it does |
|---|---|
| `public/icons/*` | CGS launcher/favicon set (48 → 512 px + maskable) |
| `src/app/manifest.ts` | Web app manifest served at `/manifest.webmanifest` |
| `src/app/layout.tsx` (edited) | Registers the manifest, icons and iOS `appleWebApp` metadata |
| `public/.well-known/assetlinks.json` | Pins the APK's signing certificate so the APK runs fullscreen |
| `vercel.json` | Region `cpt1` (Cape Town) + correct headers for the manifest, service worker and assetlinks |
| `android/` | Trusted Web Activity (TWA) project — builds the APK |
| `dist/CGS-1.0.0-release.apk` | The built, signed APK (debug-signature, sideloadable) |

Nothing else in the app was changed.

---

## 1. Deploy the web app to Vercel

The app is Next.js 16 + Supabase (server rendering, server actions, API routes), so it needs a Node
host — Vercel is the simplest.

```bash
cd CGS-portal-main
npm i -g vercel          # once
vercel login
vercel link              # create a project
```

**Add the environment variables** (Vercel → Project → Settings → Environment Variables, for
Production *and* Preview):

| Variable | Where to get it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API (publishable/anon key) |
| `SUPABASE_SECRET_KEY` | Supabase → Project Settings → API (secret/service key — **server only**) |
| `NEXT_PUBLIC_SITE_URL` | `https://<your-app>.vercel.app` (no trailing slash) |
| `NEXT_PUBLIC_CONTACT_EMAIL` | optional |
| `MPESA_ENABLED` | `false` until a real STK push has been tested |
| `GEMINI_API_KEY` | optional, for the FERD study assistant |

Then:

```bash
vercel --prod
```

> **Database first.** The repo expects several Supabase migrations that were added recently
> (see `README.md`). Before the first request, apply them:
> ```bash
> supabase link --project-ref <your-ref>
> supabase db push
> ```
> Otherwise pages that use the new tables/functions will error.

### Supabase Auth URLs

Supabase → Authentication → URL Configuration:

- **Site URL:** `https://<your-app>.vercel.app`
- **Redirect URLs:** `https://<your-app>.vercel.app/**`

Google sign-in (if used) also needs the Vercel callback
`https://<your-app>.vercel.app/auth/callback` in Google Cloud Console.

---

## 2. Point the APK at your domain

The APK is a **Trusted Web Activity**: a native shell that opens your deployed site fullscreen. So
the APK must know your final URL, and your site must vouch for the APK's certificate.

Two files to edit if your domain differs from `https://cgs-portal.vercel.app/`:

1. `android/app/src/main/res/values/strings.xml` → `app_url`
2. `android/app/src/main/AndroidManifest.xml` → the `<data android:host="…"/>` in the App Links
   intent filter

`public/.well-known/assetlinks.json` already contains the correct package
(`com.cyphergreensystems.cgs`) and the SHA-256 of the keystore in `android/keystore/`, so it needs
no edit unless you re-sign the APK.

Redeploy the site after changing anything under `public/`.

**Verify** (after the deploy is live):

```bash
curl -sI https://<your-app>.vercel.app/.well-known/assetlinks.json   # 200 + application/json
```
or open `https://developers.google.com/digital-asset-links/tools/generator` and run the test.

Until the site verifies the APK, the app still works — it simply shows a thin browser address bar.
Once verified, the address bar disappears.

---

## 3. Rebuild the APK

Requirements: JDK 17+ and the Android SDK (platform 35, build-tools 35.0.0).

```bash
cd android
# point Gradle at the SDK once
echo "sdk.dir=$ANDROID_HOME" > local.properties

./gradlew assembleRelease        # signed release APK
./gradlew assembleDebug          # debug build
```

Output:

```
android/app/build/outputs/apk/release/app-release.apk
```

Tools to verify:

```bash
$ANDROID_HOME/build-tools/35.0.0/apksigner verify --print-certs app-release.apk
$ANDROID_HOME/build-tools/35.0.0/aapt2 dump badging app-release.apk | head
```

### Signing

`android/keystore/cgs-release.keystore` is committed and used for **both** debug and release builds,
so every build produces the same certificate fingerprint (which `assetlinks.json` pins).

- store / key password: `<keystore password — not in this repo>`, alias: `cgs`
- SHA-256: `0A:CD:24:6B:C8:01:2A:17:D3:75:77:DC:F0:5E:9B:E4:8F:D5:F5:77:2A:1C:A3:07:20:EF:F5:47:25:93:AD:38`

Keep this keystore private before publishing to Google Play: losing it means you can never update
that listing. If you generate a new one, copy its SHA-256 into `public/.well-known/assetlinks.json`.

---

## 4. Install the APK on a phone

1. Copy `dist/CGS-1.0.0-release.apk` to the phone (USB, Google Drive, WhatsApp to yourself…).
2. Tap it. Android will ask to allow installs from that app ("Install unknown apps") — allow it.
3. Play Protect may warn about an app from outside Play — choose **Install anyway**.

The app requires Chrome (or another Custom Tabs browser) for the fullscreen experience, plus a
network connection for first load.

### Publishing to Google Play later

- Change `applicationId` to a domain you own (reverse-DNS), e.g. `com.cyphergreen.systems`.
- Bump `versionCode` / `versionName` in `android/app/build.gradle` for each upload.
- Build an **AAB** instead: `./gradlew bundleRelease` → `app/build/outputs/bundle/release/`.
- Play requires the App Links/assetlinks step to be live and verified.
- If Play re-signs your app (Play App Signing), add the **Play** certificate SHA-256 to
  `assetlinks.json` as well — Play shows it under *Release → Setup → App signing*.

---

## 5. PWA alternative (no APK)

The same deployment is an installable PWA: open the site in Chrome on Android → ⋮ → **Add to Home
screen**. It installs with the CGS icon, runs standalone, and needs no certificate pinning. This is
useful for testing before you distribute the APK.

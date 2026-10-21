# CGS APK — Cypher Green Systems portal + Android apps

Source and signed builds for the Cypher Green Systems portal
([cypher-green-systems.vercel.app](https://cypher-green-systems.vercel.app)) and its Android apps.

| Folder | What it is |
|---|---|
| `CGS-portal-main/` | The Next.js 16 + Supabase web app (public site, Explore/Earth GIS, workspace, MRV, marketplace, FERD student portal) |
| `CGS-native/` | Capacitor 7 native Android shell — real `MainActivity`, native splash, portrait lock, camera/GPS/files/network plugins, offline screen, download support, deep links |
| `CGS-portal-main/android/` | Trusted Web Activity (TWA) build — lightest option, runs the site in Chrome |
| `brand/` | Logo pipeline: one command regenerates every icon, splash and favicon |
| `apk/` | Signed release APKs |
| `preview/` | Interactive device preview of the native shell (`device-preview.html`) |

## Download

| File | Size | Notes |
|---|---|---|
| `apk/CGS-native-1.4.0-release.apk` | 7.0 MB | Native shell. Recommended. |
| `apk/CGS-1.2.0-release.apk` | 2.8 MB | TWA. Needs `assetlinks.json` live to drop the browser bar. |

Both are package `com.cyphergreensystems.cgs`, signed with the same key, so either installs over the
other. Install by opening the file on the phone and allowing "install unknown apps".

## Docs

- `START-HERE.md` — what is in this repo and how to deploy the web app
- `FEATURE-CHECK.md` — audit of the deployed site vs what the APK can do
- `GOOGLE-SIGN-IN-FIX.md` — the native Google sign-in flow and the one Supabase setting it needs
- `APK-TEARDOWN.md` — analysis of a comparable app's APK, and what is worth copying
- `CGS-portal-main/DEPLOY-ANDROID.md` — Vercel deploy, build and Play Store steps
- `CGS-native/README-BUILD.md` — how to rebuild the native app

## Build the apps

```bash
# native shell
cd CGS-native && npm ci && npx cap sync android
cd android && echo "sdk.dir=$ANDROID_HOME" > local.properties && ./gradlew assembleRelease

# TWA
cd CGS-portal-main/android && ./gradlew assembleRelease
```

Requires JDK 17+ and the Android SDK (platform 35, build-tools 35.0.0).

## Signing

**The release keystore is deliberately not in this repository** — it is public, and anyone holding
the key could publish updates as this app.

To produce signed builds, create `android/keystore.properties` from
`android/keystore.properties.example` (or set `CGS_KEYSTORE`, `CGS_KEYSTORE_PASSWORD`,
`CGS_KEY_ALIAS`, `CGS_KEY_PASSWORD`). Without it `assembleRelease` still runs but the APK is
unsigned.

The `SHA-256` fingerprint pinned in `CGS-portal-main/public/.well-known/assetlinks.json` must match
whichever keystore you sign with.

## Regenerate the brand assets

```bash
python3 brand/build_icons.py    # icons, splash, favicons, PWA icons from brand/logo-source.png
```

# Fixing Google sign-in in the Android app

## Why it fails

`src/modules/auth/actions.ts` → `signInWithGoogle()` calls `supabase.auth.signInWithOAuth(...)` on the
server and then `redirect(data.url)`. Inside the app that navigates the **WebView** to
`accounts.google.com`, and Google refuses OAuth from embedded WebViews:

> Error 403: disallowed_useragent — "This user-agent is not permitted to make an OAuth authorization
> request to Google as it is classified as an embedded user-agent (also known as a web-view)."

Chrome Custom Tabs are a real browser, so Google allows them. That is the whole basis of the fix.

## What I changed (in `CGS-portal-main/`)

| File | Change |
|---|---|
| `src/lib/supabase/client.ts` | **new** — browser-side Supabase client (`createBrowserClient`), which writes cookies the server can read |
| `src/modules/auth/native-google.ts` | **new** — the native OAuth flow (Custom Tab + deep link + code exchange) |
| `src/modules/auth/GoogleSignIn.tsx` | intercepts submit **only** when running inside the app; the website still uses the original server action |
| `src/modules/ferd/FerdGoogleSignIn.tsx` | **new** — same for the FERD student login |
| `src/app/ferd/login/page.tsx` | uses the new FERD button |
| `package.json` | adds `@capacitor/core`, `@capacitor/app`, `@capacitor/browser` at **v7** — they must match the native shell's Capacitor major version |

Native side: `@capacitor/browser` installed and registered
(`android/app/src/main/assets/capacitor.plugins.json`), APK rebuilt as **v1.4.0**.

## How the flow works

```
App (WebView)                    Custom Tab (Chrome)          Google / Supabase
────────────────                 ───────────────────          ─────────────────
signInWithOAuth
  skipBrowserRedirect  ───────►  opens accounts.google.com ──► Google consent
  (PKCE verifier kept
   in the WebView)
                                        │
                                        ▼
                                 Supabase redirects to
                                 cgs://auth-callback?code=…
                                        │
      Android routes that URL back to the app (intent-filter)
                                        ▼
App receives appUrlOpen
  Browser.close()
  exchangeCodeForSession(code)   ← verifier + cookie stay in the WebView
  window.location.replace("/dashboard")
```

The session never leaves the device, and `@supabase/ssr` writes the session cookie on the site
origin, so server components are signed in on the next request. The website is untouched: in a normal
browser `isNativePlatform()` is false and the original server action runs.

## What you must do in Supabase (one setting)

Supabase → **Authentication → URL Configuration → Redirect URLs**, add:

```
cgs://auth-callback
```

(Some projects prefer a wildcard: `cgs://**`.) Without this, Supabase rejects the `redirect_to` and
sign-in stops at the callback with an error.

Keep the existing entries:

- **Site URL:** `https://cypher-green-systems.vercel.app`
- **Redirect URLs:** `https://cypher-green-systems.vercel.app/**`

No Google Cloud change is needed — Google's authorised redirect URI is still Supabase's callback
(`https://<project-ref>.supabase.co/auth/v1/callback`), because Google talks to Supabase, not to your
app.

## Order of operations

1. Add `cgs://auth-callback` in the Supabase dashboard.
2. Deploy the updated portal to Vercel (the code in `CGS-portal-main/`).
3. Install `CGS/apk/CGS-native-1.4.0-release.apk`.

If you install the new APK before deploying, the app still works — the Google button falls back to
the old server-action path and shows Google's 403 page, exactly as before. Nothing else regresses.

## How to verify

1. Open the app → **Sign in** → **Continue with Google**.
2. A Chrome Custom Tab opens (you will see the address bar — that is correct and expected).
3. Choose an account. The tab closes on its own.
4. The app returns to `/dashboard` (or `/ferd/dashboard`) already signed in.

If it hangs after choosing an account, the redirect allow-list entry is missing.

## Remaining limitation

The session is a cookie in the app's WebView. If the same person also signs in on the website in
Chrome, the two sessions are independent — that is normal for a wrapper app, and signing out in one
does not sign out the other.

## If you later want one-tap native sign-in

The alternative to this flow is `@capgo/capacitor-social-login` (or `@codetrix-studio/capacitor-google-auth`),
which uses Google's native SDK and returns tokens to the app directly — no Custom Tab. It needs an
Android OAuth client ID and SHA-1 registration in Google Cloud, and it bypasses Supabase's redirect
URLs entirely. More setup; faster UX. The flow above needs no Google Cloud changes, which is why it is
the recommended first step.

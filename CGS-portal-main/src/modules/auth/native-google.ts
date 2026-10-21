"use client";

/**
 * Google sign-in for the Android app.
 *
 * Why the normal flow fails in the app: the server action `signInWithGoogle()` redirects the
 * WebView to accounts.google.com, and Google refuses OAuth inside embedded WebViews
 * ("disallowed_useragent", error 403). A Chrome Custom Tab is a real browser, so it is allowed.
 *
 * The flow below keeps every sensitive step inside the app:
 *   1. Start OAuth in the WebView (skipBrowserRedirect) so the PKCE verifier is stored here.
 *   2. Open the Google URL in a Custom Tab — Google is happy.
 *   3. Supabase redirects to the app's custom scheme `cgs://auth-callback?code=…`.
 *   4. Android hands that URL back to the app (see the intent-filter in AndroidManifest.xml).
 *   5. Exchange the code in the WebView; @supabase/ssr writes the session cookie for this origin,
 *      so server components are signed in as soon as the page reloads.
 */

const DEEP_LINK = "cgs://auth-callback";
const TIMEOUT_MS = 5 * 60 * 1000;

export type NativeAuthResult =
  | { ok: true }
  | { ok: false; reason: "not-native" | "cancelled" | "failed"; message?: string };

/** True only inside the Capacitor Android shell; the website always takes the normal path. */
export function isNativePlatform(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return cap?.isNativePlatform?.() === true;
}

export async function startNativeGoogleSignIn(destination = "/dashboard"): Promise<NativeAuthResult> {
  if (!isNativePlatform()) return { ok: false, reason: "not-native" };

  try {
    const [{ Browser }, { App }] = await Promise.all([
      import("@capacitor/browser"),
      import("@capacitor/app"),
    ]);
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();

    // Wait for the deep link before opening the tab, so no callback is missed.
    let settle: (url: string | null) => void = () => {};
    const returned = new Promise<string | null>((resolve) => {
      settle = resolve;
    });
    const timer = setTimeout(() => settle(null), TIMEOUT_MS);
    const listener = await App.addListener("appUrlOpen", ({ url }) => {
      if (url && url.startsWith(DEEP_LINK)) settle(url);
    });

    const redirectTo = `${DEEP_LINK}?next=${encodeURIComponent(destination)}`;
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        skipBrowserRedirect: true,
        queryParams: { prompt: "select_account" },
      },
    });

    if (error || !data?.url) {
      clearTimeout(timer);
      await listener.remove();
      return { ok: false, reason: "failed", message: error?.message ?? "Google sign-in could not start." };
    }

    await Browser.open({ url: data.url, presentationStyle: "popover" });

    const callbackUrl = await returned;
    clearTimeout(timer);
    await listener.remove();
    await Browser.close().catch(() => {});
    await Browser.removeAllListeners().catch(() => {});

    if (!callbackUrl) return { ok: false, reason: "cancelled" };

    const params = new URL(callbackUrl).searchParams;
    const providerError = params.get("error");
    if (providerError) {
      return {
        ok: false,
        reason: providerError === "access_denied" ? "cancelled" : "failed",
        message: params.get("error_description") ?? undefined,
      };
    }

    const code = params.get("code");
    if (!code) return { ok: false, reason: "failed", message: "No authorisation code was returned." };

    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) return { ok: false, reason: "failed", message: exchangeError.message };

    const next = params.get("next");
    const target = next && next.startsWith("/") && !next.startsWith("//") ? next : destination;
    // Full reload so server components pick up the new session cookie.
    window.location.replace(target);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: "failed", message: error instanceof Error ? error.message : String(error) };
  }
}

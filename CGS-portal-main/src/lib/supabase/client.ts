import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client.
 *
 * The rest of the app runs on server components and server actions, which is why there was no
 * browser client until now. The Android shell needs one: Google sign-in has to start and finish
 * inside the WebView so the PKCE verifier and the resulting session cookie stay on the same origin
 * (@supabase/ssr stores the session in cookies, so the server sees it immediately afterwards).
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}

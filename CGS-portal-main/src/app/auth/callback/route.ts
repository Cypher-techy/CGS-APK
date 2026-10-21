import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing point for links in Supabase Auth e-mails (address confirmation, password recovery).
 * Supports both the PKCE code flow and token-hash links from custom e-mail templates.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  // Only same-site relative paths are accepted as the continuation target.
  // A sign-in started on the FERD page leaves its destination in a short-lived cookie, used once.
  const remembered = request.cookies.get("auth_next")?.value ?? "";
  const requested = searchParams.get("next") ?? remembered;
  const next = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/dashboard";

  // Google (via Supabase) reports a cancelled or failed sign-in in the query string.
  const providerError = searchParams.get("error");
  if (providerError) {
    console.error("OAuth callback error:", providerError, searchParams.get("error_code"), searchParams.get("error_description"));
    return NextResponse.redirect(`${origin}/login?notice=${providerError === "access_denied" ? "google-cancelled" : "google-failed"}`);
  }

  const supabase = await createClient();
  let verified = false;
  if (code) {
    verified = !(await supabase.auth.exchangeCodeForSession(code)).error;
  } else if (tokenHash && type) {
    verified = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error;
  }
  const response = NextResponse.redirect(`${origin}${verified ? next : "/login?notice=link-invalid"}`);
  if (remembered) response.cookies.delete("auth_next");
  return response;
}

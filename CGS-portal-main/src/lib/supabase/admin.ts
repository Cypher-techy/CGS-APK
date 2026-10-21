import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client with the secret (service-role) key. It bypasses Row Level Security, so it is used only by
 * FERD server code for the few operations that have no signed-in user or must not be decided by the browser:
 * looking up the account behind a registration number, recording sign-in attempts, finalising M-Pesa payments
 * and signing short-lived file links after access has been checked. It must never be imported by client code;
 * the "server-only" import above makes the build fail if it is.
 */
export function adminConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SECRET_KEY;
}

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("SUPABASE_SECRET_KEY is not configured on the server");
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

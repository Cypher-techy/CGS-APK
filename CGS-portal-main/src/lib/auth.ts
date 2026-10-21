import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile, Role } from "@/lib/types";

/** Signed-in user and profile for the current request (verified against Supabase Auth). */
export const getSession = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!profile) return null;
  return { supabase, user, profile: profile as Profile };
});

/** Requires a signed-in user; redirects to the login page otherwise. */
export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/**
 * Requires an active account, optionally restricted to given roles.
 * Pending, suspended and terminated accounts are sent to the dashboard notice.
 */
export async function requireActive(roles?: Role[]) {
  const session = await requireSession();
  if (session.profile.status !== "active" || !session.profile.terms_accepted_at) redirect("/dashboard");
  if (roles && !roles.includes(session.profile.role)) redirect("/dashboard");
  return session;
}

/** Session for server actions: null unless the caller is signed in with an active account. */
export async function activeSession(roles?: Role[]) {
  const session = await getSession();
  if (!session || session.profile.status !== "active" || !session.profile.terms_accepted_at) return null;
  if (roles && !roles.includes(session.profile.role)) return null;
  return session;
}

export const NOT_ALLOWED = "You are not signed in or not permitted to perform this action.";

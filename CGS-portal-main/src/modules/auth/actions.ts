"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { dbError, fail, ok, optionalText, parseForm, text } from "@/lib/actions";
import { SELF_REGISTER_ROLES } from "@/lib/constants";
import type { ActionState } from "@/lib/types";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

const email = z.string().trim().toLowerCase().email("enter a valid e-mail address").max(160);
const password = z
  .string()
  .min(10, "must be at least 10 characters")
  .max(72, "must be at most 72 characters")
  .regex(/[a-zA-Z]/, "must contain a letter")
  .regex(/[0-9]/, "must contain a number");

export async function signIn(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({ email, password: z.string().min(1, "is required") }), formData);
  if (parsed.error) return parsed.error;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.code === "email_not_confirmed") {
      return fail("Please confirm your e-mail address first. Check your inbox for the verification link.");
    }
    return fail("Incorrect e-mail address or password.");
  }
  redirect("/dashboard");
}

export async function signUp(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(
    z.object({
      full_name: text(2, 120),
      email,
      password,
      requested_role: z.enum(SELF_REGISTER_ROLES as [string, ...string[]], { message: "select a valid role" }),
      phone: optionalText(30),
      organization: optionalText(160),
      location: optionalText(160),
      accepted_terms: z.literal("on", { message: "you must accept the Terms and the Privacy Policy" }),
    }),
    formData,
  );
  if (parsed.error) return parsed.error;
  const { email: address, password: secret, accepted_terms: _accepted, ...meta } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: address,
    password: secret,
    options: {
      emailRedirectTo: `${SITE_URL}/auth/callback`,
      // Read by the database trigger that creates the profile. The role is only a request:
      // administrative roles cannot be obtained this way.
      data: { ...meta, accepted_terms: "true" },
    },
  });
  if (error) {
    if (error.code === "over_email_send_rate_limit") {
      return fail("Too many registration e-mails were requested. Please try again in a few minutes.");
    }
    if (error.code === "weak_password") return fail("Please choose a stronger password.");
    console.error("Sign-up error:", error.code, error.message);
    return fail("The account could not be created. Please check your details and try again.");
  }
  if (data.session) redirect("/dashboard");
  return ok("Account created. Check your e-mail for a verification link, then sign in.");
}

/**
 * Starts Google sign-in through Supabase Auth. Google verifies the e-mail address; Supabase then signs in
 * the existing account with that address, or creates a pending Community Member account. No role or
 * other profile data is taken from the browser.
 */
export async function signInWithGoogle() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${SITE_URL}/auth/callback`, queryParams: { prompt: "select_account" } },
  });
  if (error || !data.url) {
    console.error("Google sign-in could not start:", error?.message);
    redirect("/login?notice=google-unavailable");
  }
  redirect(data.url);
}

/** Records acceptance of the Terms and the Privacy Policy for accounts that did not register through the form. */
export async function acceptTerms(_: ActionState, formData: FormData): Promise<ActionState> {
  if (formData.get("accepted_terms") !== "on") return fail("You must accept the Terms and the Privacy Policy to continue.");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Your session has expired. Please sign in again.");
  const { error } = await supabase.from("profiles").update({ terms_accepted_at: new Date().toISOString() }).eq("id", user.id);
  if (error) return dbError(error);
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function requestPasswordReset(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({ email }), formData);
  if (parsed.error) return parsed.error;
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${SITE_URL}/auth/callback?next=/reset-password`,
  });
  // Same answer whether or not the address exists, so accounts cannot be enumerated.
  return ok("If an account exists for that address, a password reset link has been sent.");
}

export async function updatePassword(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({ password, confirm_password: z.string() }), formData);
  if (parsed.error) return parsed.error;
  if (parsed.data.password !== parsed.data.confirm_password) return fail("The two passwords do not match.");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Your session has expired. Request a new password reset link.");
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return fail(error.code === "same_password" ? "The new password must differ from the current one." : "The password could not be updated.");
  }
  return ok("Your password has been updated.");
}

export async function updateProfile(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(
    z.object({
      full_name: text(2, 120),
      phone: optionalText(30),
      organization: optionalText(160),
      location: optionalText(160),
      email_notifications: z.enum(["true", "false"]).default("true"),
    }),
    formData,
  );
  if (parsed.error) return parsed.error;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Your session has expired. Please sign in again.");
  const { email_notifications, ...fields } = parsed.data;
  const { error } = await supabase
    .from("profiles")
    .update({ ...fields, email_notifications: email_notifications === "true" })
    .eq("id", user.id);
  if (error) return dbError(error);
  revalidatePath("/dashboard", "layout");
  return ok("Profile updated.");
}

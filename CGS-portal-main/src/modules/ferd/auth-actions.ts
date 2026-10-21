"use server";

import { createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { dbError, fail, ok, parseForm, text } from "@/lib/actions";
import { getSession } from "@/lib/auth";
import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";
import { normalizePhone, phoneProblem, REGNO_EXAMPLE, REGNO_PATTERN, regnoKey } from "@/modules/ferd/constants";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const UNAVAILABLE = "The student portal is not fully configured on this server yet. Please try again later.";
// One answer for every failed sign-in, so a registration number can never be probed.
const BAD_LOGIN = "The registration number or password is incorrect, or the account is not available.";
const WINDOW_MINUTES = 15;
const MAX_FAILURES_PER_NUMBER = 5;
const MAX_FAILURES_PER_CLIENT = 20;

const regNo = z
  .string()
  .trim()
  .max(40)
  .transform(regnoKey)
  .refine((key) => key.length >= 5 && key.length <= 30 && REGNO_PATTERN.test(key), `enter your registration number in the format ${REGNO_EXAMPLE}`);
const password = z
  .string()
  .min(10, "must be at least 10 characters")
  .max(72, "must be at most 72 characters")
  .regex(/[a-zA-Z]/, "must contain a letter")
  .regex(/[0-9]/, "must contain a number");

/** A stable, non-reversible label for the caller's network address, used only to count attempts. */
async function clientHash(): Promise<string> {
  const h = await headers();
  const address = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
  return createHash("sha256").update(`ferd-login:${address}`).digest("hex").slice(0, 32);
}

/**
 * Sign-in with a registration number and password. The number is mapped to its account on the server;
 * students never type an e-mail address and the mapping is never sent to the browser.
 */
export async function ferdSignIn(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({ reg_no: regNo, password: z.string().min(1, "is required").max(72) }), formData);
  if (parsed.error) return fail(BAD_LOGIN);
  if (!adminConfigured()) return fail(UNAVAILABLE);
  const admin = createAdminClient();
  const key = parsed.data.reg_no;
  const client = await clientHash();
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();

  const failures = (column: "reg_no_key" | "client_hash", value: string) =>
    admin.from("ferd_login_attempts").select("id", { count: "exact", head: true }).eq(column, value).eq("succeeded", false).gte("created_at", since);
  const [byNumber, byClient] = await Promise.all([failures("reg_no_key", key), failures("client_hash", client)]);
  if ((byNumber.count ?? 0) >= MAX_FAILURES_PER_NUMBER || (byClient.count ?? 0) >= MAX_FAILURES_PER_CLIENT) {
    return fail(`Too many sign-in attempts. Please wait ${WINDOW_MINUTES} minutes and try again.`);
  }

  const record = (succeeded: boolean) => admin.from("ferd_login_attempts").insert({ reg_no_key: key, client_hash: client, succeeded });
  const { data: student } = await admin.from("ferd_students").select("user_id, status").eq("reg_no_key", key).maybeSingle();
  const { data: account } = student ? await admin.from("profiles").select("email, status").eq("id", student.user_id).maybeSingle() : { data: null };
  if (!student || !account || account.status === "suspended" || account.status === "terminated") {
    await record(false);
    return fail(BAD_LOGIN);
  }

  const supabase = await createClient();
  const attempt = () => supabase.auth.signInWithPassword({ email: account.email, password: parsed.data.password });
  let { error } = await attempt();
  // A student is identified by registration number and password, not by a confirmation e-mail. Supabase
  // reports an unconfirmed address only after the correct password was given, so the address is marked
  // confirmed and the sign-in repeated. This also lets in students who registered before this rule.
  if (error?.code === "email_not_confirmed") {
    const confirmed = await admin.auth.admin.updateUserById(student.user_id, { email_confirm: true });
    if (!confirmed.error) ({ error } = await attempt());
  }
  if (error) {
    await record(false);
    return fail(BAD_LOGIN);
  }
  await record(true);
  // Pending, rejected and suspended students can sign in only to see their status; the portal itself stays closed.
  redirect(student.status === "verified" ? "/ferd/dashboard" : "/ferd/status");
}

/**
 * Registration. The database decides the student's status: verified at once when automatic verification is
 * on and the registration number matches a department, otherwise pending until an administrator reviews it.
 */
export async function ferdRegister(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(
    z.object({
      full_name: text(2, 120),
      reg_no: regNo,
      email: z.string().trim().toLowerCase().email("enter a valid e-mail address").max(160),
      // Mandatory: the M-Pesa payment prompt is sent to this number.
      phone: z.string().trim().min(1, "is required").max(20),
      year_of_study: z.enum(["", "1", "2", "3", "4", "5", "6"]).default(""),
      password,
      confirm_password: z.string(),
      accepted_terms: z.literal("on", { message: "you must accept the terms to register" }),
    }),
    formData,
  );
  if (parsed.error) return parsed.error;
  const { full_name, reg_no, email, year_of_study, password: secret, confirm_password } = parsed.data;
  if (secret !== confirm_password) return fail("The two passwords do not match.");
  const phone = normalizePhone(parsed.data.phone);
  if (!phone) return fail(`Phone number: ${phoneProblem(parsed.data.phone)}`);
  if (!adminConfigured()) return fail(UNAVAILABLE);

  const admin = createAdminClient();
  const [{ data: taken }, { data: existing }] = await Promise.all([
    admin.from("ferd_students").select("user_id").eq("reg_no_key", reg_no).maybeSingle(),
    admin.from("profiles").select("id").eq("email", email).maybeSingle(),
  ]);
  // A person who cannot register needs to know why and what to do next. Neither message says who holds
  // the registration number or the address.
  if (taken) return fail("This registration number already has an account. If it is yours, sign in with it or use “Forgot your password?”. If you did not create it, contact FERD support.");
  if (existing) return fail("This e-mail address already has a Cypher Green Systems account. Sign in to that account first (with Google, if that is how you created it), then come back to this page to add your registration number.");

  // The account is created on the server, already confirmed: students sign in with a registration number,
  // so nobody is left waiting for a confirmation e-mail. Department and status are not sent; the database
  // derives both. No session is started, so the visitor signs in deliberately afterwards.
  const { error } = await admin.auth.admin.createUser({
    email,
    password: secret,
    email_confirm: true,
    user_metadata: { portal: "ferd", full_name, reg_no, phone, year_of_study, accepted_terms: "true" },
  });
  if (error) {
    console.error("FERD registration failed:", error.code ?? error.name);
    return fail("Registration could not be completed. Please check your details and try again.");
  }
  return ok("Your account has been created. You can now sign in with your registration number and password.");
}

/**
 * Google sign-in from the FERD page, for people whose account was created with Google and so has no
 * password. It uses the same return address as the Cypher Green Systems sign-in; a short-lived cookie tells
 * the return page to continue to the FERD portal.
 */
export async function ferdGoogleSignIn() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${SITE_URL}/auth/callback`, queryParams: { prompt: "select_account" } },
  });
  if (error || !data.url) {
    console.error("Google sign-in could not start:", error?.message);
    redirect("/ferd/login?notice=google-unavailable");
  }
  (await cookies()).set("auth_next", "/ferd/login", { httpOnly: true, sameSite: "lax", secure: SITE_URL.startsWith("https://"), path: "/", maxAge: 600 });
  redirect(data.url);
}

/**
 * Adds a student record to the account the visitor is already signed in to (for example a Cypher Green
 * Systems account created with Google). The database function decides the department and the status.
 */
export async function ferdEnroll(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session) return fail("Sign in to your account first.");
  const parsed = parseForm(
    z.object({
      full_name: text(2, 120),
      reg_no: regNo,
      phone: z.string().trim().min(1, "is required").max(20),
      year_of_study: z.enum(["", "1", "2", "3", "4", "5", "6"]).default(""),
      accepted_terms: z.literal("on", { message: "you must accept the terms to register" }),
    }),
    formData,
  );
  if (parsed.error) return parsed.error;
  const phone = normalizePhone(parsed.data.phone);
  if (!phone) return fail(`Phone number: ${phoneProblem(parsed.data.phone)}`);
  const { data: status, error } = await session.supabase.rpc("ferd_enroll_self", {
    p_full_name: parsed.data.full_name,
    p_reg_no: parsed.data.reg_no,
    p_phone: phone,
    p_year_of_study: parsed.data.year_of_study ? Number(parsed.data.year_of_study) : null,
  });
  if (error) return dbError(error);
  redirect(status === "verified" ? "/ferd/dashboard" : "/ferd/status");
}

/** Password recovery by registration number. The reset link goes to the e-mail address on the account. */
export async function ferdForgotPassword(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({ reg_no: regNo }), formData);
  const done = ok("If that registration number has an account, a password reset link has been sent to its e-mail address.");
  if (parsed.error) return done;
  if (!adminConfigured()) return fail(UNAVAILABLE);
  const admin = createAdminClient();
  const { data: student } = await admin.from("ferd_students").select("user_id").eq("reg_no_key", parsed.data.reg_no).maybeSingle();
  const { data: account } = student ? await admin.from("profiles").select("email").eq("id", student.user_id).maybeSingle() : { data: null };
  if (account?.email) {
    const supabase = await createClient();
    await supabase.auth.resetPasswordForEmail(account.email, { redirectTo: `${SITE_URL}/auth/callback?next=/reset-password` });
  }
  return done;
}

export async function ferdSignOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/ferd");
}

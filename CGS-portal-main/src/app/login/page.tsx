import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { AuthCard } from "@/components/AuthCard";
import { ClearOfflineCopy } from "@/components/ClearOfflineCopy";
import { Field } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { signIn } from "@/modules/auth/actions";
import { GoogleSignIn } from "@/modules/auth/GoogleSignIn";

export const metadata: Metadata = { title: "Sign in" };

/** Messages for outcomes of e-mail links and Google sign-in. Details of failures stay in the server log. */
const NOTICES: Record<string, string> = {
  "link-invalid": "That link is invalid or has expired. Request a new one and open it in the same browser.",
  "google-cancelled": "Google sign-in was cancelled. You can try again or sign in with your e-mail address and password.",
  "google-failed": "Google sign-in could not be completed. Please try again. If the problem continues, contact CGS support.",
  "google-unavailable": "Google sign-in is not available at the moment. Sign in with your e-mail address and password.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  if (await getSession()) redirect("/dashboard");
  const { notice } = await searchParams;
  return (
    <AuthCard
      title="Sign in"
      lead="Access your Cypher Green Systems workspace."
      footer={
        <>
          No account yet? <Link href="/register" className="link">Register</Link>
        </>
      }
    >
      <ClearOfflineCopy />
      {notice && NOTICES[notice] && <p className="alert alert-error mb-4">{NOTICES[notice]}</p>}
      <ActionForm action={signIn} submitLabel="Sign in" submitClass="btn btn-primary w-full" className="space-y-4" resetOnSuccess={false}>
        <Field label="E-mail address">
          <input name="email" type="email" className="input" required autoComplete="email" />
        </Field>
        <Field label="Password">
          <input name="password" type="password" className="input" required autoComplete="current-password" />
        </Field>
        <p className="text-right text-xs">
          <Link href="/forgot-password" className="link">Forgot your password?</Link>
        </p>
      </ActionForm>
      <GoogleSignIn />
    </AuthCard>
  );
}

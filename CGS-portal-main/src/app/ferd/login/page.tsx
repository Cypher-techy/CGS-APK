import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { Field } from "@/components/ui";
import { ferdSignIn } from "@/modules/ferd/auth-actions";
import { FerdGoogleSignIn } from "@/modules/ferd/FerdGoogleSignIn";
import { FerdAuthCard } from "@/modules/ferd/FerdAuthCard";
import { getFerdSession } from "@/modules/ferd/session";

export const metadata: Metadata = { title: "FERD sign in" };

const NOTICES: Record<string, string> = {
  "not-registered": "This account has no student record yet. Add your registration number to it on the registration page.",
  "google-unavailable": "Google sign-in is not available at the moment. Sign in with your registration number and password.",
};

export default async function FerdLoginPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams;
  const session = await getFerdSession();
  if (session?.role && !session.student) redirect("/ferd/admin");
  // Signed in to a Cypher Green Systems account that has no student record: offer to add one.
  if (session && !session.student && !notice) redirect("/ferd/register");
  if (session?.student) redirect(session.student.status === "verified" ? "/ferd/dashboard" : "/ferd/status");

  return (
    <FerdAuthCard
      title="Student sign in"
      lead="Use your university registration number and your FERD password."
      footer={
        <>
          No account yet? <Link href="/ferd/register" className="link">Register</Link>
          <span className="mx-2">·</span>
          Staff? <Link href="/login" className="link">Use your CGS sign-in</Link>
        </>
      }
    >
      {notice && NOTICES[notice] && <p className="alert alert-info mb-4" role="status">{NOTICES[notice]}</p>}
      <ActionForm action={ferdSignIn} submitLabel="Sign in" submitClass="btn btn-primary w-full" className="space-y-4" resetOnSuccess={false}>
        <Field label="Registration number" hint="Format: N12/12345/25">
          <input name="reg_no" className="input uppercase" required maxLength={40} placeholder="N12/12345/25" autoComplete="username" autoCapitalize="characters" spellCheck={false} />
        </Field>
        <Field label="Password">
          <input name="password" type="password" className="input" required maxLength={72} autoComplete="current-password" />
        </Field>
        <p className="text-right text-xs">
          <Link href="/ferd/forgot-password" className="link">Forgot your password?</Link>
        </p>
      </ActionForm>
      <div className="mt-5 border-t border-subtle-border pt-5">
        <FerdGoogleSignIn>Continue with Google</FerdGoogleSignIn>
        <p className="mt-2 text-center text-xs text-muted-grey">For accounts that were created with Google and have no FERD password.</p>
      </div>
    </FerdAuthCard>
  );
}

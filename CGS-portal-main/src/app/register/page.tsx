import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { AuthCard } from "@/components/AuthCard";
import { Field } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { ROLE_LABELS, SELF_REGISTER_ROLES } from "@/lib/constants";
import { signUp } from "@/modules/auth/actions";
import { GoogleSignIn } from "@/modules/auth/GoogleSignIn";

export const metadata: Metadata = { title: "Register" };

export default async function RegisterPage() {
  if (await getSession()) redirect("/dashboard");
  return (
    <AuthCard
      wide
      title="Create an account"
      lead="After you confirm your e-mail address, CGS reviews and activates the account."
      footer={
        <>
          Already registered? <Link href="/login" className="link">Sign in</Link>
        </>
      }
    >
      <ActionForm action={signUp} submitLabel="Create account" className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name">
            <input name="full_name" className="input" required minLength={2} maxLength={120} autoComplete="name" />
          </Field>
          <Field label="E-mail address">
            <input name="email" type="email" className="input" required maxLength={160} autoComplete="email" />
          </Field>
          <Field label="Password" hint="At least 10 characters, with a letter and a number.">
            <input name="password" type="password" className="input" required minLength={10} maxLength={72} autoComplete="new-password" />
          </Field>
          <Field label="I am registering as" hint="Your role is confirmed by a CGS administrator.">
            <select name="requested_role" className="input" required defaultValue="project_owner">
              {SELF_REGISTER_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Phone (optional)">
            <input name="phone" type="tel" className="input" maxLength={30} autoComplete="tel" />
          </Field>
          <Field label="Organisation (optional)">
            <input name="organization" className="input" maxLength={160} autoComplete="organization" />
          </Field>
        </div>
        <Field label="County / location (optional)">
          <input name="location" className="input" maxLength={160} />
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input name="accepted_terms" type="checkbox" required className="mt-0.5" />
          <span>
            I have read and accept the{" "}
            <Link href="/terms" className="link" target="_blank">Terms and Conditions</Link> and consent to the processing of my
            personal data as described in the <Link href="/privacy" className="link" target="_blank">Privacy Policy</Link>.
          </span>
        </label>
      </ActionForm>
      <GoogleSignIn />
    </AuthCard>
  );
}

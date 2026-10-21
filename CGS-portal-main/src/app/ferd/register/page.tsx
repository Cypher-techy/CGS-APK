import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { Field } from "@/components/ui";
import { redirect } from "next/navigation";
import { ferdEnroll, ferdRegister, ferdSignOut } from "@/modules/ferd/auth-actions";
import { displayPhone } from "@/modules/ferd/constants";
import { FerdAuthCard } from "@/modules/ferd/FerdAuthCard";
import { getFerdSession } from "@/modules/ferd/session";

export const metadata: Metadata = { title: "FERD registration" };

export const dynamic = "force-dynamic";

export default async function FerdRegisterPage() {
  const session = await getFerdSession();
  if (session?.student) redirect(session.student.status === "verified" ? "/ferd/dashboard" : "/ferd/status");

  // Already signed in to a Cypher Green Systems account: the student record is added to that account.
  if (session) {
    return (
      <FerdAuthCard
        wide
        title="Add your student record"
        lead={`You are signed in as ${session.profile.email}. Your student record will be added to this account, and you will keep signing in the same way.`}
        footer={
          <form action={ferdSignOut}>
            Not you? <button type="submit" className="link">Sign out</button>
          </form>
        }
      >
        <ActionForm action={ferdEnroll} submitLabel="Add student record" submitClass="btn btn-primary w-full" className="space-y-4" resetOnSuccess={false}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" hint="As it appears on your student ID">
              <input name="full_name" className="input" required minLength={2} maxLength={120} defaultValue={session.profile.full_name} autoComplete="name" />
            </Field>
            <Field label="Registration number" hint="Format: N12/12345/25 (prefix / serial number / year)">
              <input name="reg_no" className="input uppercase" required maxLength={40} placeholder="N12/12345/25" pattern="[A-Za-z][0-9]{2}/[0-9]{3,6}/[0-9]{2}" title="Format: N12/12345/25" autoCapitalize="characters" spellCheck={false} />
            </Field>
            <Field label="Phone number" hint="Your M-Pesa number: 07XX XXX XXX, 01XX XXX XXX or +254 7XX XXX XXX.">
              <input name="phone" type="tel" inputMode="tel" className="input" required maxLength={20} placeholder="0712 345 678" defaultValue={displayPhone(session.profile.phone)} autoComplete="tel" />
            </Field>
            <Field label="Year of study (optional)">
              <select name="year_of_study" className="input" defaultValue="">
                <option value="">Select</option>
                {[1, 2, 3, 4, 5, 6].map((year) => (
                  <option key={year} value={year}>Year {year}</option>
                ))}
              </select>
            </Field>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input name="accepted_terms" type="checkbox" required className="mt-0.5" />
            <span>
              I accept the <Link href="/terms" className="link" target="_blank">Terms</Link> and the processing of my details as described in the{" "}
              <Link href="/privacy" className="link" target="_blank">Privacy Policy</Link>.
            </span>
          </label>
        </ActionForm>
      </FerdAuthCard>
    );
  }

  return (
    <FerdAuthCard
      wide
      title="Register as a student"
      lead="Your department is assigned from your registration number. Once your account is created you can sign in straight away."
      footer={
        <>
          Already registered? <Link href="/ferd/login" className="link">Sign in</Link>
          <span className="mx-2">·</span>
          Already have a Cypher Green Systems account? <Link href="/login" className="link">Sign in to it</Link>, then return here.
        </>
      }
    >
      <ActionForm action={ferdRegister} submitLabel="Register" submitClass="btn btn-primary w-full" className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" hint="As it appears on your student ID">
            <input name="full_name" className="input" required minLength={2} maxLength={120} autoComplete="name" />
          </Field>
          <Field label="Registration number" hint="Format: N12/12345/25 (prefix / serial number / year)">
            <input name="reg_no" className="input uppercase" required maxLength={40} placeholder="N12/12345/25" pattern="[A-Za-z][0-9]{2}/[0-9]{3,6}/[0-9]{2}" title="Format: N12/12345/25" autoCapitalize="characters" spellCheck={false} />
          </Field>
          <Field label="E-mail address" hint="Used for confirmation and password recovery only">
            <input name="email" type="email" className="input" required maxLength={160} autoComplete="email" />
          </Field>
          <Field label="Phone number" hint="Your M-Pesa number: 07XX XXX XXX, 01XX XXX XXX or +254 7XX XXX XXX. Payment prompts are sent to it.">
            <input name="phone" type="tel" inputMode="tel" className="input" required maxLength={20} placeholder="0712 345 678" autoComplete="tel" />
          </Field>
          <Field label="Year of study (optional)">
            <select name="year_of_study" className="input" defaultValue="">
              <option value="">Select</option>
              {[1, 2, 3, 4, 5, 6].map((year) => (
                <option key={year} value={year}>Year {year}</option>
              ))}
            </select>
          </Field>
          <span className="hidden sm:block" />
          <Field label="Password" hint="At least 10 characters, with a letter and a number">
            <input name="password" type="password" className="input" required minLength={10} maxLength={72} autoComplete="new-password" />
          </Field>
          <Field label="Confirm password">
            <input name="confirm_password" type="password" className="input" required maxLength={72} autoComplete="new-password" />
          </Field>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input name="accepted_terms" type="checkbox" required className="mt-0.5" />
          <span>
            I accept the <Link href="/terms" className="link" target="_blank">Terms</Link> and the processing of my details as described in the{" "}
            <Link href="/privacy" className="link" target="_blank">Privacy Policy</Link>.
          </span>
        </label>
      </ActionForm>
    </FerdAuthCard>
  );
}

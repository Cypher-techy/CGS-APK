import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { Field } from "@/components/ui";
import { ferdForgotPassword } from "@/modules/ferd/auth-actions";
import { FerdAuthCard } from "@/modules/ferd/FerdAuthCard";

export const metadata: Metadata = { title: "FERD password reset" };

export default function FerdForgotPasswordPage() {
  return (
    <FerdAuthCard
      title="Reset your password"
      lead="Enter your registration number. A reset link is sent to the e-mail address on your account."
      footer={<Link href="/ferd/login" className="link">Back to sign in</Link>}
    >
      <ActionForm action={ferdForgotPassword} submitLabel="Send reset link" submitClass="btn btn-primary w-full" className="space-y-4">
        <Field label="Registration number">
          <input name="reg_no" className="input uppercase" required maxLength={40} placeholder="N12/12345/25" autoCapitalize="characters" spellCheck={false} />
        </Field>
      </ActionForm>
    </FerdAuthCard>
  );
}

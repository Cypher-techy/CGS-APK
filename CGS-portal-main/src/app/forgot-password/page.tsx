import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { AuthCard } from "@/components/AuthCard";
import { Field } from "@/components/ui";
import { requestPasswordReset } from "@/modules/auth/actions";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Reset your password"
      lead="Enter your e-mail address and we will send you a link to choose a new password."
      footer={<Link href="/login" className="link">Back to sign in</Link>}
    >
      <ActionForm action={requestPasswordReset} submitLabel="Send reset link" submitClass="btn btn-primary w-full" className="space-y-4">
        <Field label="E-mail address">
          <input name="email" type="email" className="input" required autoComplete="email" />
        </Field>
      </ActionForm>
    </AuthCard>
  );
}

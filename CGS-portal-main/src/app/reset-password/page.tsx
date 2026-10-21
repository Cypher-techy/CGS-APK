import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { AuthCard } from "@/components/AuthCard";
import { Field } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { updatePassword } from "@/modules/auth/actions";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage() {
  // Reached through the e-mailed recovery link, which signs the user in first.
  if (!(await getSession())) redirect("/login?notice=link-invalid");
  return (
    <AuthCard title="Choose a new password" footer={<Link href="/dashboard" className="link">Continue to the dashboard</Link>}>
      <ActionForm action={updatePassword} submitLabel="Update password" submitClass="btn btn-primary w-full" className="space-y-4">
        <Field label="New password" hint="At least 10 characters, with a letter and a number.">
          <input name="password" type="password" className="input" required minLength={10} maxLength={72} autoComplete="new-password" />
        </Field>
        <Field label="Confirm new password">
          <input name="confirm_password" type="password" className="input" required autoComplete="new-password" />
        </Field>
      </ActionForm>
    </AuthCard>
  );
}

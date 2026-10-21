import { ActionForm } from "@/components/ActionForm";
import { Card, DetailList, Field, PageHeader, StatusBadge } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { ACCOUNT_STATUS, ROLE_LABELS } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { updatePassword, updateProfile } from "@/modules/auth/actions";

export default async function ProfilePage() {
  const { profile } = await requireSession();
  return (
    <>
      <PageHeader title="Profile and security" description="Your account details and password." />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Personal details">
            <ActionForm action={updateProfile} submitLabel="Save changes" className="space-y-4" resetOnSuccess={false}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Full name">
                  <input name="full_name" className="input" required minLength={2} maxLength={120} defaultValue={profile.full_name} autoComplete="name" />
                </Field>
                <Field label="Phone">
                  <input name="phone" type="tel" className="input" maxLength={30} defaultValue={profile.phone ?? ""} autoComplete="tel" />
                </Field>
                <Field label="Organisation">
                  <input name="organization" className="input" maxLength={160} defaultValue={profile.organization ?? ""} />
                </Field>
                <Field label="County / location">
                  <input name="location" className="input" maxLength={160} defaultValue={profile.location ?? ""} />
                </Field>
              </div>
              <Field label="Notification e-mails" hint={`Sent to ${profile.email}. In-app notifications are always shown.`}>
                <select name="email_notifications" className="input sm:max-w-xs" defaultValue={String(profile.email_notifications)}>
                  <option value="true">Send my notifications by e-mail</option>
                  <option value="false">Do not e-mail me</option>
                </select>
              </Field>
            </ActionForm>
          </Card>
          <Card title="Change password">
            <ActionForm action={updatePassword} submitLabel="Update password" className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="New password" hint="At least 10 characters, with a letter and a number.">
                  <input name="password" type="password" className="input" required minLength={10} maxLength={72} autoComplete="new-password" />
                </Field>
                <Field label="Confirm new password">
                  <input name="confirm_password" type="password" className="input" required autoComplete="new-password" />
                </Field>
              </div>
            </ActionForm>
          </Card>
        </div>
        <Card title="Account">
          <DetailList
            items={[
              ["E-mail address", profile.email],
              ["Role", ROLE_LABELS[profile.role]],
              ["Status", <StatusBadge key="s" map={ACCOUNT_STATUS} value={profile.status} />],
              ["Member since", formatDate(profile.created_at)],
            ]}
          />
          <p className="mt-4 text-xs text-muted-grey">
            Your role and e-mail address can only be changed by a CGS administrator. To request access to, correction
            or deletion of your personal data, use the Contact and Support page.
          </p>
        </Card>
      </div>
    </>
  );
}

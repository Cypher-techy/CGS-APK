import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, EmptyState, Field, PageHeader } from "@/components/ui";
import { requireActive } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { saveCategory, saveSettings } from "@/modules/admin/actions";

export default async function SettingsPage() {
  const { supabase } = await requireActive(["super_admin"]);
  const [{ data: settings }, { data: categories }, { data: messages }] = await Promise.all([
    supabase.from("system_settings").select("*").maybeSingle(),
    supabase.from("project_categories").select("id, name, description, is_active").order("name"),
    supabase.from("contact_messages").select("id, full_name, email, subject, message, created_at").order("created_at", { ascending: false }).limit(20),
  ]);

  return (
    <>
      <PageHeader title="Settings" description="Platform configuration, project categories and messages from the public contact form." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="System settings">
          <ActionForm action={saveSettings} submitLabel="Save settings" className="space-y-4" resetOnSuccess={false}>
            <Field label="Platform name">
              <input name="platform_name" className="input" required maxLength={80} defaultValue={settings?.platform_name} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Support e-mail">
                <input name="support_email" type="email" className="input" required maxLength={160} defaultValue={settings?.support_email} />
              </Field>
              <Field label="Support phone">
                <input name="support_phone" className="input" required maxLength={30} defaultValue={settings?.support_phone} />
              </Field>
            </div>
            <Field
              label="Project owner registration"
              hint="Project manager and field officer accounts always require approval. Administrator accounts cannot be self-registered."
            >
              <select name="require_account_approval" className="input" defaultValue={String(settings?.require_account_approval ?? true)}>
                <option value="true">Require administrator approval</option>
                <option value="false">Activate automatically after e-mail confirmation</option>
              </select>
            </Field>
          </ActionForm>
          {settings?.updated_at && <p className="hint">Last changed {formatDateTime(settings.updated_at)}.</p>}
        </Card>

        <Card title="Project categories">
          <ul className="mb-5 divide-y divide-subtle-border">
            {(categories ?? []).map((category) => (
              <li key={category.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0 text-sm">
                  <span className="font-medium">{category.name}</span>{" "}
                  <Badge tone={category.is_active ? "success" : "neutral"}>{category.is_active ? "Active" : "Inactive"}</Badge>
                  {category.description && <p className="text-xs text-muted-grey">{category.description}</p>}
                </div>
                <ActionForm action={saveCategory} submitLabel={category.is_active ? "Deactivate" : "Activate"} submitClass="btn btn-secondary btn-sm">
                  <input type="hidden" name="category_id" value={category.id} />
                  <input type="hidden" name="name" value={category.name} />
                  <input type="hidden" name="description" value={category.description ?? ""} />
                  <input type="hidden" name="is_active" value={String(!category.is_active)} />
                </ActionForm>
              </li>
            ))}
          </ul>
          <ActionForm action={saveCategory} submitLabel="Add category" submitClass="btn btn-secondary" className="space-y-3">
            <Field label="New category name">
              <input name="name" className="input" required minLength={2} maxLength={80} />
            </Field>
            <Field label="Description (optional)">
              <input name="description" className="input" maxLength={400} />
            </Field>
          </ActionForm>
          <p className="hint">Inactive categories are no longer offered for new projects; existing projects keep them.</p>
        </Card>
      </div>

      <div className="mt-5">
        <Card title="Contact form messages (latest 20)" pad={false}>
          {(messages ?? []).length === 0 ? (
            <EmptyState title="No messages have been received." />
          ) : (
            <ul className="divide-y divide-subtle-border">
              {(messages ?? []).map((m) => (
                <li key={m.id} className="px-4 py-3 text-sm sm:px-5">
                  <p className="font-medium">{m.subject}</p>
                  <p className="text-xs text-muted-grey">
                    {m.full_name} · <a className="link" href={`mailto:${m.email}`}>{m.email}</a> · {formatDateTime(m.created_at)}
                  </p>
                  <p className="prose-block mt-1">{m.message}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

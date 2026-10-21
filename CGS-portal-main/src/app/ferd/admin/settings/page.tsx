import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, Field, PageHeader } from "@/components/ui";
import { adminConfigured } from "@/lib/supabase/admin";
import { saveDepartment, saveDepartmentModule, saveFerdSettings, saveModule, savePrefixRule, updatePrefixRule } from "@/modules/ferd/admin-actions";
import { mpesaConfig } from "@/modules/ferd/mpesa";
import { requireStaff } from "@/modules/ferd/session";

/** Departments, registration-number rules, dashboard modules and platform status. Super Admin only. */
export default async function FerdAdminSettingsPage() {
  const { supabase } = await requireStaff([]);
  const [{ data: departments }, { data: rules }, { data: modules }, { data: overrides }, { data: settings }] = await Promise.all([
    supabase.from("ferd_departments").select("id, code, name, tagline, description, focus_areas, accent, is_active").order("sort_order"),
    supabase.from("ferd_prefix_rules").select("id, prefix, department_id, note, is_active").order("prefix"),
    supabase.from("ferd_modules").select("key, label, description, sort_order, is_enabled").order("sort_order"),
    supabase.from("ferd_department_modules").select("department_id, module_key, is_enabled, label, sort_order"),
    supabase.from("ferd_settings").select("auto_verify_students").maybeSingle(),
  ]);
  const autoVerify = settings?.auto_verify_students ?? false;
  const mpesa = mpesaConfig();
  const depts = departments ?? [];
  const override = (dept: string, key: string) => (overrides ?? []).find((o) => o.department_id === dept && o.module_key === key);

  return (
    <div className="space-y-5">
      <PageHeader title="Departments and features" description="Everything here is configuration stored in the database. Changes take effect immediately, without a deployment." />

      <Card title="Platform status">
        <ul className="space-y-2 text-sm">
          <li className="flex items-center justify-between gap-3">
            <span>Server key for sign-in, file delivery and payments (SUPABASE_SECRET_KEY)</span>
            <Badge tone={adminConfigured() ? "success" : "danger"}>{adminConfigured() ? "Configured" : "Missing"}</Badge>
          </li>
          <li className="flex items-center justify-between gap-3">
            <span>M-Pesa payments {mpesa.problem && <span className="block text-xs text-muted-grey">{mpesa.problem}</span>}</span>
            <Badge tone={mpesa.enabled ? "success" : "warning"}>{mpesa.enabled ? "On" : "Off"}</Badge>
          </li>
          <li className="flex items-center justify-between gap-3">
            <span>M-Pesa mode</span>
            <span className="text-muted-grey">{mpesa.baseUrl.includes("sandbox") ? "Sandbox" : "Production"} · {mpesa.transactionType === "CustomerBuyGoodsOnline" ? "Buy Goods (till)" : "Pay Bill"}</span>
          </li>
        </ul>
        <p className="mt-3 text-xs text-muted-grey">These are set as environment variables on the server (Vercel), not here, so that secrets never pass through the browser.</p>
      </Card>

      <Card title="Student verification" actions={<Badge tone={autoVerify ? "warning" : "success"}>{autoVerify ? "Automatic" : "Manual review"}</Badge>}>
        <p className="text-sm text-muted-grey">
          {autoVerify
            ? "New students can use the portal as soon as they register, when their registration number matches a department. Nobody checks their identity first, so anyone who knows another student's registration number could register it before that student does. Students whose number matches no department still wait for you."
            : "Every new student waits on the Students page until an administrator has checked their identity."}
        </p>
        <ActionForm action={saveFerdSettings} submitLabel="Save" submitClass="btn btn-secondary" className="mt-4 flex flex-wrap items-end gap-3" resetOnSuccess={false}>
          <Field label="New registrations">
            <select name="auto_verify_students" className="input" defaultValue={autoVerify ? "true" : "false"}>
              <option value="true">Verify automatically (no approval needed)</option>
              <option value="false">Wait for an administrator</option>
            </select>
          </Field>
        </ActionForm>
        <p className="mt-3 text-xs text-muted-grey">You can still suspend or correct any student on the Students page, whichever option is chosen.</p>
      </Card>

      {depts.map((d) => (
        <Card key={d.id} title={`${d.name} (${d.code})`} actions={<Badge tone={d.is_active ? "success" : "neutral"}>{d.is_active ? "Active" : "Hidden"}</Badge>}>
          <ActionForm action={saveDepartment} submitLabel="Save department" submitClass="btn btn-secondary" className="grid gap-4 sm:grid-cols-3" resetOnSuccess={false}>
            <input type="hidden" name="id" value={d.id} />
            <Field label="Name">
              <input name="name" className="input" required maxLength={80} defaultValue={d.name} />
            </Field>
            <Field label="Accent colour">
              <input name="accent" type="color" className="input h-10" defaultValue={d.accent} />
            </Field>
            <Field label="Visible">
              <select name="is_active" className="input" defaultValue={d.is_active ? "true" : "false"}>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </Field>
            <div className="sm:col-span-3">
              <Field label="Tagline">
                <input name="tagline" className="input" maxLength={200} defaultValue={d.tagline ?? ""} />
              </Field>
            </div>
            <div className="sm:col-span-3">
              <Field label="Description">
                <textarea name="description" className="input" rows={2} maxLength={2000} defaultValue={d.description ?? ""} />
              </Field>
            </div>
            <div className="sm:col-span-3">
              <Field label="Focus areas" hint="Comma separated. Each becomes a shortcut on the department dashboard that lists resources tagged with it.">
                <input name="focus_areas" className="input" maxLength={600} defaultValue={(d.focus_areas ?? []).join(", ")} />
              </Field>
            </div>
          </ActionForm>

          <h3 className="section-title mt-6">Dashboard modules for this department</h3>
          <div className="table-wrap mt-2">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Module</th>
                  <th>Settings for {d.code}</th>
                </tr>
              </thead>
              <tbody>
                {(modules ?? []).map((m) => {
                  const o = override(d.id, m.key);
                  return (
                    <tr key={m.key}>
                      <td>
                        {m.label}
                        {!m.is_enabled && <div className="text-xs text-amber-200">Switched off for everyone</div>}
                      </td>
                      <td>
                        <ActionForm action={saveDepartmentModule} submitLabel="Save" submitClass="btn btn-secondary btn-sm" className="flex flex-wrap items-end gap-2" resetOnSuccess={false}>
                          <input type="hidden" name="department_id" value={d.id} />
                          <input type="hidden" name="module_key" value={m.key} />
                          <select name="is_enabled" className="input w-28" defaultValue={o?.is_enabled === false ? "false" : "true"} aria-label="Visibility">
                            <option value="true">Shown</option>
                            <option value="false">Hidden</option>
                          </select>
                          <input name="label" className="input w-40" maxLength={40} placeholder={`Label (${m.label})`} defaultValue={o?.label ?? ""} aria-label="Label for this department" />
                          <input name="sort_order" type="number" min={0} max={99} className="input w-20" placeholder={String(m.sort_order)} defaultValue={o?.sort_order ?? ""} aria-label="Order for this department" />
                        </ActionForm>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      <Card title="Modules for all departments" pad={false}>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Module</th>
                <th>Label, description, order and availability</th>
              </tr>
            </thead>
            <tbody>
              {(modules ?? []).map((m) => (
                <tr key={m.key}>
                  <td className="text-xs text-muted-grey">{m.key}</td>
                  <td>
                    <ActionForm action={saveModule} submitLabel="Save" submitClass="btn btn-secondary btn-sm" className="flex flex-wrap items-end gap-2" resetOnSuccess={false}>
                      <input type="hidden" name="key" value={m.key} />
                      <input name="label" className="input w-40" required maxLength={40} defaultValue={m.label} aria-label="Label" />
                      <input name="description" className="input w-72" maxLength={200} defaultValue={m.description ?? ""} aria-label="Description" />
                      <input name="sort_order" type="number" min={0} max={99} className="input w-20" required defaultValue={m.sort_order} aria-label="Order" />
                      <select name="is_enabled" className="input w-28" defaultValue={m.is_enabled ? "true" : "false"} aria-label="Availability">
                        <option value="true">On</option>
                        <option value="false">Off</option>
                      </select>
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Registration-number prefix rules">
        <p className="text-sm text-muted-grey">
          A new registration is placed in the department of the longest matching active prefix. A number that matches no rule gets no department and waits for an administrator.
          The Natural Resources prefixes below are known examples; confirm them against official records and add or remove rules as needed.
        </p>
        <ul className="mt-4 divide-y divide-subtle-border rounded-2xl border border-subtle-border">
          {(rules ?? []).map((rule) => (
            <li key={rule.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span>
                <code className="font-semibold text-white">{rule.prefix}</code> → {depts.find((d) => d.id === rule.department_id)?.name}
                {rule.note && <span className="block text-xs text-muted-grey">{rule.note}</span>}
              </span>
              <span className="flex items-center gap-2">
                <Badge tone={rule.is_active ? "success" : "neutral"}>{rule.is_active ? "Active" : "Off"}</Badge>
                <ActionForm action={updatePrefixRule} submitLabel={rule.is_active ? "Turn off" : "Turn on"} submitClass="btn btn-secondary btn-sm">
                  <input type="hidden" name="id" value={rule.id} />
                  <input type="hidden" name="intent" value={rule.is_active ? "disable" : "enable"} />
                </ActionForm>
                <ActionForm action={updatePrefixRule} submitLabel="Delete" submitClass="btn btn-danger btn-sm" confirm={`Delete the rule for ${rule.prefix}?`}>
                  <input type="hidden" name="id" value={rule.id} />
                  <input type="hidden" name="intent" value="delete" />
                </ActionForm>
              </span>
            </li>
          ))}
        </ul>
        <ActionForm action={savePrefixRule} submitLabel="Add rule" submitClass="btn btn-secondary" className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field label="Prefix" hint="For example N16/">
            <input name="prefix" className="input uppercase" required maxLength={12} />
          </Field>
          <Field label="Department">
            <select name="department_id" className="input" required>
              {depts.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Note (optional)">
            <input name="note" className="input" maxLength={300} />
          </Field>
        </ActionForm>
      </Card>
    </div>
  );
}

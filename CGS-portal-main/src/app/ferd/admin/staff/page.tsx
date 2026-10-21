import { ActionForm } from "@/components/ActionForm";
import { Card, EmptyState, Field, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { removeStaff, saveStaff } from "@/modules/ferd/admin-actions";
import { FERD_ROLES, type FerdRole } from "@/modules/ferd/constants";
import { requireStaff } from "@/modules/ferd/session";


type Row = Record<string, any>;

/** Staff accounts and roles. Super Admin only; roles are enforced by the database, not by this menu. */
export default async function FerdAdminStaffPage() {
  const { supabase, departments, user } = await requireStaff([]);
  const { data: staff } = await supabase.from("ferd_staff").select("user_id, role, department_id, created_at, person:profiles!ferd_staff_user_id_fkey(full_name, email)").order("created_at");

  return (
    <div className="space-y-5">
      <PageHeader title="Staff and roles" description="Give an existing account a FERD role. Platform Super Admins are the CGS administrators; they are appointed in the CGS administration, never through a sign-up form." />
      <Card title="Roles" pad={false}>
        {((staff ?? []) as Row[]).length === 0 ? (
          <EmptyState title="No FERD staff roles assigned">CGS administrators already have full access. Add department admins and managers below.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Role</th>
                  <th>Department</th>
                  <th>Since</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {((staff ?? []) as Row[]).map((s) => (
                  <tr key={s.user_id}>
                    <td>
                      {s.person?.full_name ?? "Account"}
                      <div className="text-xs text-muted-grey">{s.person?.email}</div>
                    </td>
                    <td>{FERD_ROLES[s.role as FerdRole]?.label ?? s.role}</td>
                    <td>{departments.find((d) => d.id === s.department_id)?.name ?? "All"}</td>
                    <td className="text-xs text-muted-grey">{formatDate(s.created_at)}</td>
                    <td>
                      {s.user_id !== user.id && (
                        <ActionForm action={removeStaff} submitLabel="Remove" submitClass="btn btn-danger btn-sm" confirm="Remove this person's FERD role?">
                          <input type="hidden" name="user_id" value={s.user_id} />
                        </ActionForm>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Assign a role">
        <ActionForm action={saveStaff} submitLabel="Save role" className="grid gap-4 sm:grid-cols-3">
          <Field label="E-mail of the account" hint="The person must already have a Cypher Green Systems account.">
            <input name="email" type="email" className="input" required maxLength={160} />
          </Field>
          <Field label="Role">
            <select name="role" className="input" required defaultValue="content_manager">
              {Object.entries(FERD_ROLES).map(([key, value]) => (
                <option key={key} value={key}>{value.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Department" hint="Required for a department admin; optional limit for a content manager.">
            <select name="department_id" className="input" defaultValue="">
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </Field>
        </ActionForm>
        <dl className="mt-5 grid gap-2 text-xs sm:grid-cols-2">
          {Object.values(FERD_ROLES).map((role) => (
            <div key={role.label}>
              <dt className="font-semibold text-charcoal">{role.label}</dt>
              <dd className="text-muted-grey">{role.summary}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}

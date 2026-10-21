import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { requireActive } from "@/lib/auth";
import { ACCOUNT_STATUS, ROLE_LABELS } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import type { Profile } from "@/lib/types";
import { updateUserAccess } from "@/modules/admin/actions";

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; role?: string }> }) {
  const { supabase, profile: admin } = await requireActive(["super_admin"]);
  const { q = "", status = "", role = "" } = await searchParams;

  let query = supabase.from("profiles").select("*").order("created_at", { ascending: false }).limit(300);
  if (status in ACCOUNT_STATUS) query = query.eq("status", status);
  if (role in ROLE_LABELS) query = query.eq("role", role);
  const term = q.trim().replace(/[%,()]/g, " ").slice(0, 80);
  if (term) query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%,organization.ilike.%${term}%`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const users = data as Profile[];

  return (
    <>
      <PageHeader
        title="Users"
        description="Approve registrations, assign roles and suspend or terminate accounts. Every change is recorded in the activity log."
      />
      <Card pad={false}>
        <form className="flex flex-wrap items-end gap-3 border-b border-subtle-border p-4">
          <label className="min-w-40 flex-1">
            <span className="label">Search</span>
            <input name="q" defaultValue={q} placeholder="Name, e-mail or organisation" className="input" />
          </label>
          <label>
            <span className="label">Status</span>
            <select name="status" defaultValue={status} className="input">
              <option value="">All</option>
              {Object.entries(ACCOUNT_STATUS).map(([value, { label }]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">Role</span>
            <select name="role" defaultValue={role} className="input">
              <option value="">All</option>
              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn btn-secondary">Apply</button>
          {(q || status || role) && <Link href="/dashboard/admin/users" className="btn btn-secondary">Clear</Link>}
        </form>
        {users.length === 0 ? (
          <EmptyState title="No users match these filters." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Organisation</th>
                  <th>Registered</th>
                  <th>Status</th>
                  <th>Role and access</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <span className="font-medium">{user.full_name}</span>
                      <div className="text-xs text-muted-grey">{user.email}</div>
                    </td>
                    <td>{user.organization ?? "—"}</td>
                    <td>{formatDate(user.created_at)}</td>
                    <td>
                      <StatusBadge map={ACCOUNT_STATUS} value={user.status} />
                    </td>
                    <td>
                      {user.id === admin.id ? (
                        <span className="text-xs text-muted-grey">{ROLE_LABELS[user.role]} (your own account cannot be changed here)</span>
                      ) : (
                        <ActionForm action={updateUserAccess} submitLabel="Save" submitClass="btn btn-secondary btn-sm" className="flex flex-wrap items-center gap-1.5" resetOnSuccess={false}>
                          <input type="hidden" name="user_id" value={user.id} />
                          <select name="role" defaultValue={user.role} className="input w-auto py-1 text-xs" aria-label={`Role of ${user.full_name}`}>
                            {Object.entries(ROLE_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                          <select name="status" defaultValue={user.status} className="input w-auto py-1 text-xs" aria-label={`Status of ${user.full_name}`}>
                            {Object.entries(ACCOUNT_STATUS).map(([value, { label }]) => (
                              <option key={value} value={value}>{value === "active" && user.status === "pending" ? "Active (approve)" : label}</option>
                            ))}
                          </select>
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
    </>
  );
}

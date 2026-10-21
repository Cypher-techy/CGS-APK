import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { ActionForm } from "@/components/ActionForm";
import { Card, EmptyState, Field, PageHeader, StatusBadge } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { correctStudent, importStudentRecords, reviewStudent } from "@/modules/ferd/admin-actions";
import { displayPhone, STUDENT_STATUS } from "@/modules/ferd/constants";
import { requireStaff } from "@/modules/ferd/session";

const PAGE = 25;

/** Student management and verification. Department admins see their own department and unassigned students. */
export default async function FerdAdminStudentsPage({ searchParams }: { searchParams: Promise<{ status?: string; dept?: string; q?: string; page?: string }> }) {
  const params = await searchParams;
  const { supabase, departments, role, staffDepartmentId } = await requireStaff(["department_admin"]);
  const page = Math.max(1, Number(params.page) || 1);
  const status = params.status && params.status in STUDENT_STATUS ? params.status : "";
  const q = (params.q ?? "").replace(/[%,()*\\"']/g, " ").trim().slice(0, 60);

  let query = supabase
    .from("ferd_students")
    .select("user_id, reg_no, reg_no_key, full_name, phone, year_of_study, department_id, status, status_note, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (status) query = query.eq("status", status);
  if (params.dept === "none") query = query.is("department_id", null);
  else if (params.dept && departments.some((d) => d.id === params.dept)) query = query.eq("department_id", params.dept);
  if (q) query = query.or(`full_name.ilike.%${q}%,reg_no_key.ilike.%${q.toUpperCase().replace(/[^A-Z0-9/]/g, "")}%`);
  const { data: students, count } = await query;
  const list = students ?? [];
  const { data: records } = list.length
    ? await supabase.from("ferd_student_records").select("reg_no_key, full_name, department_id").in("reg_no_key", list.map((s) => s.reg_no_key))
    : { data: [] };
  const official = new Map((records ?? []).map((r) => [r.reg_no_key, r]));
  const assignable = role === "super_admin" ? departments : departments.filter((d) => d.id === staffDepartmentId);
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const link = (next: number) => `/ferd/admin/students?${new URLSearchParams({ ...(status && { status }), ...(params.dept && { dept: params.dept }), ...(q && { q }), page: String(next) })}`;

  return (
    <div className="space-y-5">
      <PageHeader title="Students" description="Review, correct or suspend student accounts. A registration-number prefix alone is never proof of identity: check the official record shown on each card, especially when verification is automatic." />
      <form className="flex flex-wrap items-end gap-3" role="search">
        <label className="min-w-48 flex-1">
          <span className="label">Search</span>
          <input name="q" type="search" defaultValue={q} className="input" placeholder="Name or registration number" />
        </label>
        <label>
          <span className="label">Status</span>
          <select name="status" defaultValue={status} className="input">
            <option value="">All</option>
            {Object.entries(STUDENT_STATUS).map(([key, value]) => (
              <option key={key} value={key}>{value.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Department</span>
          <select name="dept" defaultValue={params.dept ?? ""} className="input">
            <option value="">All</option>
            <option value="none">Not assigned</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-secondary">Apply</button>
      </form>

      {list.length === 0 ? (
        <Card>
          <EmptyState title="No students match">Registrations appear here as soon as students sign up.</EmptyState>
        </Card>
      ) : (
        <ul className="space-y-3">
          {list.map((s) => {
            const record = official.get(s.reg_no_key);
            const department = departments.find((d) => d.id === s.department_id);
            return (
              <li key={s.user_id} className="card card-pad">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-display text-lg font-bold text-white">{s.full_name}</p>
                    <p className="text-sm text-muted-grey">
                      {s.reg_no} · {department?.name ?? "No department (prefix not recognised)"}
                      {s.year_of_study ? ` · Year ${s.year_of_study}` : ""}
                      {s.phone ? ` · ${displayPhone(s.phone)}` : " · no phone on file"} · registered {formatDate(s.created_at)}
                    </p>
                    <p className={`mt-1 flex items-center gap-1.5 text-xs ${record ? "text-emerald-200" : "text-amber-200"}`}>
                      {record ? (
                        <>
                          <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" /> Official record found: {record.full_name}
                          {record.full_name.trim().toLowerCase() !== s.full_name.trim().toLowerCase() && " (name differs: check the student ID)"}
                        </>
                      ) : (
                        "No official record on file for this number: verify the student ID yourself."
                      )}
                    </p>
                  </div>
                  <StatusBadge map={STUDENT_STATUS} value={s.status} />
                </div>
                {s.status_note && <p className="mt-2 text-xs text-muted-grey">Note: {s.status_note}</p>}
                <div className="mt-4 grid gap-4 border-t border-subtle-border pt-4 lg:grid-cols-2">
                  <ActionForm action={reviewStudent} submitLabel="Save decision" submitClass="btn btn-primary btn-sm" className="grid gap-3 sm:grid-cols-3" resetOnSuccess={false}>
                    <input type="hidden" name="user_id" value={s.user_id} />
                    <Field label="Decision">
                      <select name="status" className="input" defaultValue={s.status === "pending" ? "verified" : s.status}>
                        <option value="verified">Verify</option>
                        <option value="pending">Keep pending</option>
                        <option value="rejected">Reject</option>
                        <option value="suspended">Suspend</option>
                      </select>
                    </Field>
                    <Field label="Department">
                      <select name="department_id" className="input" defaultValue={s.department_id ?? record?.department_id ?? ""}>
                        <option value="">Unchanged</option>
                        {assignable.map((d) => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Note to the student">
                      <input name="status_note" className="input" maxLength={500} defaultValue={s.status_note ?? ""} />
                    </Field>
                  </ActionForm>
                  <details>
                    <summary className="cursor-pointer text-xs text-muted-grey hover:text-white">Correct name or registration number</summary>
                    <ActionForm action={correctStudent} submitLabel="Save correction" submitClass="btn btn-secondary btn-sm" className="mt-3 grid gap-3 sm:grid-cols-2" resetOnSuccess={false} confirm="Correct this student's verified record? The change is written to the audit log.">
                      <input type="hidden" name="user_id" value={s.user_id} />
                      <Field label="Full name">
                        <input name="full_name" className="input" required maxLength={120} defaultValue={s.full_name} />
                      </Field>
                      <Field label="Registration number">
                        <input name="reg_no" className="input uppercase" required maxLength={40} defaultValue={s.reg_no} />
                      </Field>
                    </ActionForm>
                  </details>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between text-sm text-muted-grey">
          <span>Page {page} of {pages} · {count} students</span>
          <span className="flex gap-2">
            {page > 1 && <Link href={link(page - 1)} className="btn btn-secondary btn-sm">Previous</Link>}
            {page < pages && <Link href={link(page + 1)} className="btn btn-secondary btn-sm">Next</Link>}
          </span>
        </nav>
      )}

      <Card title="Official student records">
        <p className="text-sm text-muted-grey">
          Paste records supplied by the faculty, one per line: <code>registration number, full name</code>. A matching record is shown to the reviewer; it never activates an account by itself.
        </p>
        <ActionForm action={importStudentRecords} submitLabel="Save records" submitClass="btn btn-secondary" className="mt-4 space-y-3">
          <Field label="Department of these records">
            <select name="department_id" className="input sm:max-w-xs" required defaultValue={assignable[0]?.id ?? ""}>
              {assignable.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Records">
            <textarea name="records" className="input font-mono text-xs" rows={5} required placeholder={"N12/12345/25, Jane Wanjiru\nN12/12346/25, John Otieno"} />
          </Field>
        </ActionForm>
      </Card>
    </div>
  );
}

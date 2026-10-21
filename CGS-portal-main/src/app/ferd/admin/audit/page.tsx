import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { formatDateTime, humanize } from "@/lib/format";
import { requireStaff } from "@/modules/ferd/session";


type Row = Record<string, any>;
const PAGE = 50;

/** Audit log of privileged actions. Written by database triggers; it cannot be edited through the application. */
export default async function FerdAdminAuditPage({ searchParams }: { searchParams: Promise<{ page?: string; entity?: string }> }) {
  const params = await searchParams;
  const { supabase } = await requireStaff([]);
  const page = Math.max(1, Number(params.page) || 1);
  const entity = /^[a-z_]{3,40}$/.test(params.entity ?? "") ? params.entity! : "";
  let query = supabase
    .from("ferd_audit_logs")
    .select("id, action, entity, entity_id, details, created_at, actor:profiles!ferd_audit_logs_actor_id_fkey(full_name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (entity) query = query.eq("entity", entity);
  const { data, count } = await query;
  const rows = (data ?? []) as Row[];
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const summary = (details: Row) => {
    const d = details?.after ?? details ?? {};
    return [d.title, d.name, d.reg_no, d.prefix, d.reference, d.role, d.to_status && `→ ${d.to_status}`, d.note].filter(Boolean).join(" · ").slice(0, 160);
  };
  const ENTITIES = ["ferd_students", "ferd_content", "ferd_payments", "ferd_entitlements", "ferd_products", "ferd_staff", "ferd_prefix_rules", "ferd_modules", "ferd_department_modules", "ferd_departments", "ferd_student_records"];

  return (
    <div className="space-y-5">
      <PageHeader title="Audit log" description="Who changed what: verifications, corrections, content, prices, access grants, roles, feature settings and payment outcomes." />
      <nav aria-label="Filter by record" className="flex flex-wrap gap-2">
        <Link href="/ferd/admin/audit" className={`btn btn-sm ${entity ? "btn-secondary" : "btn-primary"}`}>All</Link>
        {ENTITIES.map((name) => (
          <Link key={name} href={`/ferd/admin/audit?entity=${name}`} className={`btn btn-sm ${entity === name ? "btn-primary" : "btn-secondary"}`}>
            {humanize(name.replace("ferd_", ""))}
          </Link>
        ))}
      </nav>
      <Card pad={false}>
        {rows.length === 0 ? (
          <EmptyState title="No activity recorded" />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Action</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((log) => (
                  <tr key={log.id}>
                    <td className="whitespace-nowrap text-xs text-muted-grey">{formatDateTime(log.created_at)}</td>
                    <td>{log.actor?.full_name ?? "System"}</td>
                    <td>{humanize(log.action)}</td>
                    <td className="text-xs text-muted-grey">{summary(log.details)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between text-sm text-muted-grey">
          <span>Page {page} of {pages}</span>
          <span className="flex gap-2">
            {page > 1 && <Link href={`/ferd/admin/audit?${new URLSearchParams({ ...(entity && { entity }), page: String(page - 1) })}`} className="btn btn-secondary btn-sm">Previous</Link>}
            {page < pages && <Link href={`/ferd/admin/audit?${new URLSearchParams({ ...(entity && { entity }), page: String(page + 1) })}`} className="btn btn-secondary btn-sm">Next</Link>}
          </span>
        </nav>
      )}
    </div>
  );
}

import Link from "next/link";
import { Card, PageHeader, StatCard, StatGrid } from "@/components/ui";
import { formatDateTime, formatNumber, humanize } from "@/lib/format";
import { adminConfigured } from "@/lib/supabase/admin";
import { FERD_ROLES } from "@/modules/ferd/constants";
import { mpesaConfig } from "@/modules/ferd/mpesa";
import { requireStaff } from "@/modules/ferd/session";

const head = { count: "exact", head: true } as const;

/** Overview and analytics. Every number is counted from the database under the viewer's own permissions. */
export default async function FerdAdminOverviewPage() {
  const { supabase, role, departments } = await requireStaff();
  const students = (status: string) => supabase.from("ferd_students").select("user_id", head).eq("status", status);
  const content = (status: string) => supabase.from("ferd_content").select("id", head).eq("status", status);
  const [pending, verified, published, drafts, premium, paid, { data: revenue }, entitlements, { data: logs }, { data: perDept }] = await Promise.all([
    students("pending"),
    students("verified"),
    content("published"),
    content("draft"),
    supabase.from("ferd_content").select("id", head).eq("tier", "premium").eq("status", "published"),
    supabase.from("ferd_payments").select("id", head).eq("status", "success"),
    supabase.from("ferd_payments").select("amount_kes").eq("status", "success").limit(5000),
    supabase.from("ferd_entitlements").select("id", head).is("revoked_at", null),
    supabase.from("ferd_audit_logs").select("id, action, entity, created_at").order("created_at", { ascending: false }).limit(8),
    supabase.from("ferd_students").select("department_id").eq("status", "verified").limit(10000),
  ]);
  const mpesa = mpesaConfig();
  const money = role === "super_admin" || role === "finance_admin";
  const total = (revenue ?? []).reduce((sum, row) => sum + Number(row.amount_kes), 0);

  return (
    <div className="space-y-5">
      <PageHeader title="FERD administration" description={`${FERD_ROLES[role].label}. ${FERD_ROLES[role].summary}`} />
      {(!adminConfigured() || !mpesa.enabled) && (role === "super_admin" || role === "finance_admin") && (
        <div className="alert alert-warning space-y-1">
          {!adminConfigured() && <p>The server key (SUPABASE_SECRET_KEY) is not set, so student sign-in, file delivery and payments cannot work on this deployment.</p>}
          {!mpesa.enabled && <p>{mpesa.problem} Libraries cannot be purchased until this is resolved.</p>}
        </div>
      )}
      <StatGrid>
        <StatCard label="Students awaiting review" value={pending.count ?? 0} href="/ferd/admin/students?status=pending" />
        <StatCard label="Verified students" value={verified.count ?? 0} href="/ferd/admin/students?status=verified" />
        <StatCard label="Published items" value={published.count ?? 0} hint={`${premium.count ?? 0} premium`} href="/ferd/admin/content?status=published" />
        <StatCard label="Drafts" value={drafts.count ?? 0} href="/ferd/admin/content?status=draft" />
        {money && <StatCard label="Confirmed payments" value={paid.count ?? 0} hint={`KSh ${formatNumber(total)} in total`} href="/ferd/admin/payments" />}
        {money && <StatCard label="Active library access" value={entitlements.count ?? 0} href="/ferd/admin/products" />}
      </StatGrid>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Verified students by department">
          <ul className="space-y-2 text-sm">
            {departments.map((d) => {
              const count = (perDept ?? []).filter((row) => row.department_id === d.id).length;
              return (
                <li key={d.id} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.accent }} /> {d.name}
                  </span>
                  <span className="tabular-nums text-muted-grey">{count}</span>
                </li>
              );
            })}
          </ul>
        </Card>
        {role === "super_admin" && (
          <Card title="Recent privileged actions" pad={false} actions={<Link href="/ferd/admin/audit" className="link text-xs">Audit log</Link>}>
            {(logs ?? []).length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-grey">No activity recorded yet.</p>
            ) : (
              <ul className="divide-y divide-subtle-border">
                {(logs ?? []).map((log) => (
                  <li key={log.id} className="flex justify-between gap-3 px-4 py-2.5 text-sm sm:px-5">
                    <span>{humanize(log.action)}</span>
                    <span className="shrink-0 text-xs text-muted-grey">{formatDateTime(log.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

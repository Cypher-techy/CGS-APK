import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { Card, EmptyState, PageHeader, StatCard, StatGrid, StatusBadge } from "@/components/ui";
import { formatDateTime, formatNumber } from "@/lib/format";
import { reconcilePayment } from "@/modules/ferd/admin-actions";
import { PAYMENT_STATUS } from "@/modules/ferd/constants";
import { mpesaConfig } from "@/modules/ferd/mpesa";
import { requireStaff } from "@/modules/ferd/session";


type Row = Record<string, any>;
const PAGE = 40;
const head = { count: "exact", head: true } as const;

/** Payments: view and reconcile. Records cannot be edited here or anywhere else. */
export default async function FerdAdminPaymentsPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const params = await searchParams;
  const { supabase } = await requireStaff(["finance_admin"]);
  const page = Math.max(1, Number(params.page) || 1);
  const status = params.status && params.status in PAYMENT_STATUS ? params.status : "";
  let query = supabase
    .from("ferd_payments")
    .select("id, user_id, amount_kes, paid_amount_kes, phone, reference, status, result_desc, mpesa_receipt, created_at, completed_at, product:ferd_products(name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (status) query = query.eq("status", status);
  const [{ data, count }, success, pending, { data: paid }] = await Promise.all([
    query,
    supabase.from("ferd_payments").select("id", head).eq("status", "success"),
    supabase.from("ferd_payments").select("id", head).eq("status", "pending"),
    supabase.from("ferd_payments").select("amount_kes").eq("status", "success").limit(10000),
  ]);
  const rows = (data ?? []) as Row[];
  const ids = [...new Set(rows.map((r) => r.user_id))];
  const { data: students } = ids.length ? await supabase.from("ferd_students").select("user_id, reg_no, full_name").in("user_id", ids) : { data: [] };
  const student = new Map((students ?? []).map((s) => [s.user_id, s]));
  const mpesa = mpesaConfig();
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  // Phone numbers are shown masked: finance needs to recognise a payment, not to hold the full number.
  const mask = (phone: string) => `${phone.slice(0, 5)}•••${phone.slice(-3)}`;

  return (
    <div className="space-y-5">
      <PageHeader title="Payments" description="M-Pesa payments for premium libraries. A payment becomes final only when Safaricom confirms it; final records cannot be changed." />
      {!mpesa.enabled && <p className="alert alert-warning">{mpesa.problem}</p>}
      <StatGrid>
        <StatCard label="Confirmed payments" value={success.count ?? 0} />
        <StatCard label="Confirmed total" value={`KSh ${formatNumber((paid ?? []).reduce((sum, r) => sum + Number(r.amount_kes), 0))}`} />
        <StatCard label="Pending" value={pending.count ?? 0} hint="Awaiting a result from Safaricom" href="/ferd/admin/payments?status=pending" />
        <StatCard label="Environment" value={mpesa.baseUrl.includes("sandbox") ? "Sandbox" : "Production"} hint={mpesa.transactionType === "CustomerBuyGoodsOnline" ? "Buy Goods (till)" : "Pay Bill"} />
      </StatGrid>
      <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
        {[["", "All"], ...Object.entries(PAYMENT_STATUS).map(([key, value]) => [key, value.label])].map(([key, label]) => (
          <Link key={key} href={key ? `/ferd/admin/payments?status=${key}` : "/ferd/admin/payments"} className={`btn btn-sm ${status === key ? "btn-primary" : "btn-secondary"}`}>
            {label}
          </Link>
        ))}
      </nav>
      <Card pad={false}>
        {rows.length === 0 ? (
          <EmptyState title="No payments" />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Library</th>
                  <th>Amount</th>
                  <th>Phone</th>
                  <th>Reference / receipt</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {student.get(p.user_id)?.full_name ?? "Student"}
                      <div className="text-xs text-muted-grey">{student.get(p.user_id)?.reg_no}</div>
                    </td>
                    <td>{p.product?.name}</td>
                    <td className="tabular-nums">KSh {formatNumber(p.amount_kes)}</td>
                    <td className="tabular-nums">{mask(p.phone)}</td>
                    <td className="text-xs">
                      {p.reference}
                      <div className="text-muted-grey">{p.mpesa_receipt ?? p.result_desc ?? ""}</div>
                    </td>
                    <td><StatusBadge map={PAYMENT_STATUS} value={p.status} /></td>
                    <td className="text-xs text-muted-grey">{formatDateTime(p.created_at)}</td>
                    <td>
                      {p.status === "pending" && (
                        <ActionForm action={reconcilePayment} submitLabel="Check with Safaricom" submitClass="btn btn-secondary btn-sm">
                          <input type="hidden" name="id" value={p.id} />
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
      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between text-sm text-muted-grey">
          <span>Page {page} of {pages}</span>
          <span className="flex gap-2">
            {page > 1 && <Link href={`/ferd/admin/payments?${new URLSearchParams({ ...(status && { status }), page: String(page - 1) })}`} className="btn btn-secondary btn-sm">Previous</Link>}
            {page < pages && <Link href={`/ferd/admin/payments?${new URLSearchParams({ ...(status && { status }), page: String(page + 1) })}`} className="btn btn-secondary btn-sm">Next</Link>}
          </span>
        </nav>
      )}
    </div>
  );
}

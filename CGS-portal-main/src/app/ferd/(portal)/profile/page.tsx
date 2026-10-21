import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { Card, DetailList, EmptyState, Field, PageHeader, StatusBadge } from "@/components/ui";
import { formatDateTime, formatNumber } from "@/lib/format";
import { displayPhone, PAYMENT_STATUS, STUDENT_STATUS } from "@/modules/ferd/constants";
import { requireViewer } from "@/modules/ferd/session";
import { updateStudentProfile } from "@/modules/ferd/student-actions";

/** The student's own account: identity, contact details, purchases, entitlements, bookmarks and downloads. */
export default async function FerdProfilePage() {
  const { supabase, user, student, department, profile } = await requireViewer();
  const [{ data: payments }, { data: entitlements }, { data: bookmarks }, { data: downloads }] = await Promise.all([
    supabase.from("ferd_payments").select("id, amount_kes, status, reference, mpesa_receipt, created_at, product:ferd_products(name)").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
    supabase.from("ferd_entitlements").select("id, source, created_at, revoked_at, product:ferd_products(name)").eq("user_id", user.id).order("created_at", { ascending: false }),
    supabase.from("ferd_bookmarks").select("created_at, content:ferd_content(id, title)").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30),
    supabase.from("ferd_download_logs").select("id, created_at, content:ferd_content(id, title)").eq("user_id", user.id).order("created_at", { ascending: false }).limit(15),
  ]);

  const rows = <T,>(data: T[] | null) => (data ?? []) as any[];

  return (
    <>
      <PageHeader title="Profile" description="Your FERD account. Only you and FERD administrators can see this information." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Student record">
          {student ? (
            <>
              <DetailList
                items={[
                  ["Name", student.full_name],
                  ["Registration number", student.reg_no],
                  ["Department", department.name],
                  ["Status", <StatusBadge key="s" map={STUDENT_STATUS} value={student.status} />],
                  ["E-mail", profile.email],
                ]}
              />
              <p className="mt-3 text-xs text-muted-grey">Your name, registration number and department can only be corrected by an administrator.</p>
              <ActionForm action={updateStudentProfile} submitLabel="Save contact details" submitClass="btn btn-secondary" className="mt-5 grid gap-4 sm:grid-cols-2" resetOnSuccess={false}>
                <Field label="Phone number" hint="Required. 07…, 01… or +254… M-Pesa payment prompts are sent to this number.">
                  <input name="phone" type="tel" inputMode="tel" className="input" required maxLength={20} defaultValue={displayPhone(student.phone)} />
                </Field>
                <Field label="Year of study">
                  <select name="year_of_study" className="input" defaultValue={student.year_of_study?.toString() ?? ""}>
                    <option value="">Not set</option>
                    {[1, 2, 3, 4, 5, 6].map((year) => (
                      <option key={year} value={year}>Year {year}</option>
                    ))}
                  </select>
                </Field>
              </ActionForm>
            </>
          ) : (
            <p className="text-sm text-muted-grey">You are signed in as staff ({profile.email}); there is no student record on this account.</p>
          )}
        </Card>

        <Card title="Libraries you own" pad={false}>
          {rows(entitlements).length === 0 ? (
            <EmptyState title="No premium libraries yet">Purchases appear here once the payment is confirmed.</EmptyState>
          ) : (
            <ul className="divide-y divide-subtle-border">
              {rows(entitlements).map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm sm:px-5">
                  <span className="text-white">{e.product?.name}</span>
                  <span className="text-xs text-muted-grey">{e.revoked_at ? "Access withdrawn" : e.source === "grant" ? "Granted by FERD" : "Purchased"} · {formatDateTime(e.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Payments" pad={false}>
          {rows(payments).length === 0 ? (
            <EmptyState title="No payments" />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Library</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Receipt</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {rows(payments).map((p) => (
                    <tr key={p.id}>
                      <td>{p.product?.name}</td>
                      <td className="tabular-nums">KSh {formatNumber(p.amount_kes)}</td>
                      <td><StatusBadge map={PAYMENT_STATUS} value={p.status} /></td>
                      <td className="text-xs">{p.mpesa_receipt ?? "—"}</td>
                      <td className="text-xs text-muted-grey">{formatDateTime(p.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Bookmarks and recent downloads" pad={false}>
          {rows(bookmarks).length + rows(downloads).length === 0 ? (
            <EmptyState title="Nothing saved yet">Bookmark an item to find it here later.</EmptyState>
          ) : (
            <ul className="divide-y divide-subtle-border">
              {rows(bookmarks).filter((b) => b.content).map((b) => (
                <li key={`b${b.content.id}`} className="flex justify-between gap-3 px-4 py-2.5 text-sm sm:px-5">
                  <Link href={`/ferd/content/${b.content.id}`} className="link truncate">{b.content.title}</Link>
                  <span className="shrink-0 text-xs text-muted-grey">Bookmarked</span>
                </li>
              ))}
              {rows(downloads).filter((d) => d.content).map((d) => (
                <li key={`d${d.id}`} className="flex justify-between gap-3 px-4 py-2.5 text-sm sm:px-5">
                  <Link href={`/ferd/content/${d.content.id}`} className="link truncate">{d.content.title}</Link>
                  <span className="shrink-0 text-xs text-muted-grey">Opened {formatDateTime(d.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

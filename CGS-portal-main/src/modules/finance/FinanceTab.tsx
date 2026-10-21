import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, EmptyState, Field, StatCard } from "@/components/ui";
import { formatDate, formatNumber, today } from "@/lib/format";
import { addBenefitTerm, addFinancialRecord, deleteBenefitTerm, deleteFinancialRecord, setPaymentStatus } from "@/modules/finance/actions";
import type { ExtendedTabProps } from "@/modules/projects/tabs-extended";

export const FINANCE_KINDS: Record<string, string> = {
  budget: "Budget allocation",
  expense: "Expense",
  income: "Income",
  benefit_payment: "Benefit-sharing payment",
};
const STATUS_TONE = { planned: "neutral", pending: "warning", paid: "success" } as const;

/** Benefit-sharing terms (all participants) and financial records (owner, manager, administrators). */
export async function FinanceTab({ supabase, project, canManage, viewer, memberRole }: ExtendedTabProps) {
  const [{ data: terms }, { data: records }, { data: documents }] = await Promise.all([
    supabase.from("benefit_sharing_terms").select("id, beneficiary, share_percent, description, agreed_on, document_id").eq("project_id", project.id).order("created_at"),
    // RLS returns everything to the owner and managers, and benefit-sharing payments only to community members.
    supabase.from("financial_records").select("*").eq("project_id", project.id).order("record_date", { ascending: false }),
    canManage
      ? supabase.from("documents").select("id, title").eq("project_id", project.id).eq("category", "agreement").order("title")
      : Promise.resolve({ data: [] }),
  ]);
  const rows = records ?? [];
  const seesAll = canManage || project.owner_id === viewer.id;
  const currencies = [...new Set(rows.map((r) => r.currency as string))].sort();
  const sum = (currency: string, kind: string, paidOnly = false) =>
    rows.filter((r) => r.currency === currency && r.kind === kind && (!paidOnly || r.payment_status === "paid")).reduce((t, r) => t + Number(r.amount), 0);
  const shareTotal = (terms ?? []).reduce((t, term) => t + Number(term.share_percent ?? 0), 0);

  return (
    <div className="space-y-5">
      <p className="alert alert-info">
        These are records kept by the project manager. The portal does not make, receive or process payments; a payment
        marked as paid here records a payment made outside the portal.
      </p>

      <Card title="Benefit-sharing arrangement" pad={false}>
        {(terms ?? []).length === 0 ? (
          <EmptyState title="No benefit-sharing terms have been recorded for this project." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Beneficiary</th>
                  <th>Share</th>
                  <th>Terms</th>
                  <th>Agreed on</th>
                  <th>Agreement</th>
                  {canManage && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {(terms ?? []).map((term) => (
                  <tr key={term.id}>
                    <td className="font-medium">{term.beneficiary}</td>
                    <td className="tabular-nums">{term.share_percent !== null ? `${formatNumber(term.share_percent, 2)}%` : "—"}</td>
                    <td className="max-w-md">{term.description}</td>
                    <td>{formatDate(term.agreed_on)}</td>
                    <td>{term.document_id && seesAll ? <a href={`/api/documents/${term.document_id}`} className="link">Download</a> : term.document_id ? "On file" : "—"}</td>
                    {canManage && (
                      <td>
                        <ActionForm action={deleteBenefitTerm} confirm={`Remove the term for ${term.beneficiary}?`} submitLabel="Remove" submitClass="btn btn-danger btn-sm">
                          <input type="hidden" name="term_id" value={term.id} />
                        </ActionForm>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(terms ?? []).length > 0 && (
          <p className="border-t border-subtle-border px-4 py-2.5 text-xs text-muted-grey sm:px-5">Shares recorded: {formatNumber(shareTotal, 2)}% of 100%.</p>
        )}
        {canManage && (
          <div className="border-t border-subtle-border p-4 sm:p-5">
            <ActionForm action={addBenefitTerm} submitLabel="Record term" submitClass="btn btn-secondary" className="space-y-4">
              <input type="hidden" name="project_id" value={project.id} />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Beneficiary" hint="Person, group or organisation.">
                  <input name="beneficiary" className="input" required minLength={2} maxLength={160} />
                </Field>
                <Field label="Share (%) (optional)">
                  <input name="share_percent" type="number" min="0" max="100" step="0.01" className="input" />
                </Field>
                <Field label="Agreed on (optional)">
                  <input name="agreed_on" type="date" className="input" max={today()} />
                </Field>
                <Field label="Agreement document (optional)" hint="Documents in the Agreement category.">
                  <select name="document_id" className="input" defaultValue="">
                    <option value="">None</option>
                    {(documents ?? []).map((d) => (
                      <option key={d.id} value={d.id}>{d.title}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Terms" hint="What the beneficiary receives, when, and on what basis.">
                <textarea name="description" className="input" rows={2} required minLength={5} maxLength={2000} />
              </Field>
            </ActionForm>
          </div>
        )}
      </Card>

      {seesAll && currencies.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {currencies.flatMap((currency) => [
            <StatCard key={`${currency}-b`} label={`Budget (${currency})`} value={formatNumber(sum(currency, "budget"), 2)} />,
            <StatCard key={`${currency}-e`} label={`Expenses paid (${currency})`} value={formatNumber(sum(currency, "expense", true), 2)} hint={`Budget remaining: ${formatNumber(sum(currency, "budget") - sum(currency, "expense", true), 2)}`} />,
            <StatCard key={`${currency}-i`} label={`Income received (${currency})`} value={formatNumber(sum(currency, "income", true), 2)} />,
            <StatCard key={`${currency}-p`} label={`Benefit payments paid (${currency})`} value={formatNumber(sum(currency, "benefit_payment", true), 2)} />,
          ])}
        </div>
      )}

      {(seesAll || memberRole === "community_member") && (
        <Card title={seesAll ? "Financial records" : "Benefit-sharing payments"} pad={false}>
          {rows.length === 0 ? (
            <EmptyState title="No records yet." />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Description</th>
                    <th>Amount</th>
                    <th>Status</th>
                    {canManage && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>{formatDate(r.record_date)}</td>
                      <td>
                        {FINANCE_KINDS[r.kind]}
                        {r.category && <div className="text-xs text-muted-grey">{r.category}</div>}
                      </td>
                      <td className="max-w-sm">
                        {r.description}
                        {r.beneficiary && <div className="text-xs text-muted-grey">Beneficiary: {r.beneficiary}</div>}
                      </td>
                      <td className="whitespace-nowrap tabular-nums">{r.currency} {formatNumber(r.amount, 2)}</td>
                      <td>
                        <Badge tone={STATUS_TONE[r.payment_status as keyof typeof STATUS_TONE]}>{r.payment_status}</Badge>
                      </td>
                      {canManage && (
                        <td>
                          <div className="flex flex-wrap gap-1.5">
                            {r.payment_status !== "paid" && (
                              <ActionForm action={setPaymentStatus} submitLabel="Mark paid" submitClass="btn btn-secondary btn-sm">
                                <input type="hidden" name="record_id" value={r.id} />
                                <input type="hidden" name="payment_status" value="paid" />
                              </ActionForm>
                            )}
                            <ActionForm action={deleteFinancialRecord} confirm="Delete this financial record?" submitLabel="Delete" submitClass="btn btn-danger btn-sm">
                              <input type="hidden" name="record_id" value={r.id} />
                            </ActionForm>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {canManage && (
        <Card title="Add a financial record">
          <ActionForm action={addFinancialRecord} submitLabel="Add record" className="space-y-4">
            <input type="hidden" name="project_id" value={project.id} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Type">
                <select name="kind" className="input" defaultValue="expense">
                  {Object.entries(FINANCE_KINDS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Amount">
                <input name="amount" type="number" min="0.01" step="0.01" required className="input" />
              </Field>
              <Field label="Currency">
                <select name="currency" className="input" defaultValue="KES">
                  <option value="KES">KES</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </Field>
              <Field label="Date">
                <input name="record_date" type="date" required className="input" defaultValue={today()} />
              </Field>
              <Field label="Status">
                <select name="payment_status" className="input" defaultValue="paid">
                  <option value="planned">Planned</option>
                  <option value="pending">Pending</option>
                  <option value="paid">Paid</option>
                </select>
              </Field>
              <Field label="Category (optional)" hint="e.g. Seedlings, Labour, Transport.">
                <input name="category" className="input" maxLength={80} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Beneficiary" hint="Required for benefit-sharing payments.">
                  <input name="beneficiary" className="input" maxLength={160} />
                </Field>
              </div>
            </div>
            <Field label="Description">
              <input name="description" className="input" required minLength={3} maxLength={500} />
            </Field>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}

import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, EmptyState, Field, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { grantEntitlement, saveProduct, setEntitlementRevoked } from "@/modules/ferd/admin-actions";
import { requireStaff } from "@/modules/ferd/session";


type Row = Record<string, any>;

/** Premium libraries (price, terms, availability) and who has access. Editing is for the Super Admin; finance can view. */
export default async function FerdAdminProductsPage() {
  const { supabase, departments, role } = await requireStaff(["finance_admin"]);
  const [{ data: products }, { data: entitlements }, { data: items }] = await Promise.all([
    supabase.from("ferd_products").select("id, slug, name, description, terms, price_kes, department_id, is_active").order("name"),
    supabase.from("ferd_entitlements").select("id, user_id, product_id, source, note, revoked_at, created_at, product:ferd_products(name)").order("created_at", { ascending: false }).limit(100),
    supabase.from("ferd_content").select("product_id").eq("tier", "premium").eq("status", "published"),
  ]);
  const ids = [...new Set(((entitlements ?? []) as Row[]).map((e) => e.user_id))];
  const { data: students } = ids.length ? await supabase.from("ferd_students").select("user_id, reg_no, full_name").in("user_id", ids) : { data: [] };
  const student = new Map((students ?? []).map((s) => [s.user_id, s]));
  const canEdit = role === "super_admin";
  const count = (id: string) => (items ?? []).filter((i) => i.product_id === id).length;

  const form = (product?: Row) => (
    <ActionForm action={saveProduct} submitLabel={product ? "Save library" : "Create library"} submitClass="btn btn-secondary" className="grid gap-4 sm:grid-cols-3" resetOnSuccess={!product}>
      {product && <input type="hidden" name="id" value={product.id} />}
      <Field label="Name">
        <input name="name" className="input" required minLength={3} maxLength={120} defaultValue={product?.name} />
      </Field>
      <Field label="Price (KSh)" hint="Applies to future purchases only.">
        <input name="price_kes" type="number" min={1} max={150000} step={1} className="input" required defaultValue={product?.price_kes ?? 100} />
      </Field>
      <Field label="Department">
        <select name="department_id" className="input" defaultValue={product?.department_id ?? ""}>
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </Field>
      <div className="sm:col-span-3">
        <Field label="Description" hint="Say exactly what the library contains. Students read this before paying.">
          <textarea name="description" className="input" rows={3} maxLength={3000} defaultValue={product?.description ?? ""} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Access terms">
          <textarea name="terms" className="input" rows={2} maxLength={3000} defaultValue={product?.terms ?? ""} />
        </Field>
      </div>
      <Field label="On sale">
        <select name="is_active" className="input" defaultValue={product?.is_active ? "true" : "false"}>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </Field>
    </ActionForm>
  );

  return (
    <div className="space-y-5">
      <PageHeader title="Libraries and access" description="A library is a premium collection: one payment unlocks every premium item attached to it in the content library." />
      {((products ?? []) as Row[]).map((product) => (
        <Card
          key={product.id}
          title={product.name}
          actions={
            <span className="flex items-center gap-2 text-xs text-muted-grey">
              {count(product.id)} published item{count(product.id) === 1 ? "" : "s"} <Badge tone={product.is_active ? "success" : "neutral"}>{product.is_active ? "On sale" : "Not on sale"}</Badge>
            </span>
          }
        >
          {canEdit ? form(product) : <p className="text-sm text-muted-grey">KSh {product.price_kes}. {product.description}</p>}
        </Card>
      ))}
      {canEdit && <Card title="New library">{form()}</Card>}

      {canEdit && (
        <Card title="Grant a library without payment">
          <p className="text-sm text-muted-grey">For a bursary or a correction. Every grant is attributed to you and written to the audit log.</p>
          <ActionForm action={grantEntitlement} submitLabel="Grant access" submitClass="btn btn-secondary" className="mt-4 grid gap-4 sm:grid-cols-3" confirm="Give this student the library without payment?">
            <Field label="Library">
              <select name="product_id" className="input" required>
                {((products ?? []) as Row[]).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Registration number">
              <input name="reg_no" className="input uppercase" required maxLength={40} />
            </Field>
            <Field label="Reason">
              <input name="note" className="input" required minLength={5} maxLength={300} />
            </Field>
          </ActionForm>
        </Card>
      )}

      <Card title="Library access (latest 100)" pad={false}>
        {(entitlements ?? []).length === 0 ? (
          <EmptyState title="No one has library access yet" />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Library</th>
                  <th>How</th>
                  <th>Since</th>
                  <th>State</th>
                  {canEdit && <th />}
                </tr>
              </thead>
              <tbody>
                {((entitlements ?? []) as Row[]).map((e) => (
                  <tr key={e.id}>
                    <td>
                      {student.get(e.user_id)?.full_name ?? "Student"}
                      <div className="text-xs text-muted-grey">{student.get(e.user_id)?.reg_no}</div>
                    </td>
                    <td>{e.product?.name}</td>
                    <td>
                      {e.source === "grant" ? "Granted" : "Paid"}
                      {e.note && <div className="text-xs text-muted-grey">{e.note}</div>}
                    </td>
                    <td className="text-xs text-muted-grey">{formatDateTime(e.created_at)}</td>
                    <td><Badge tone={e.revoked_at ? "danger" : "success"}>{e.revoked_at ? "Withdrawn" : "Active"}</Badge></td>
                    {canEdit && (
                      <td>
                        <ActionForm action={setEntitlementRevoked} submitLabel={e.revoked_at ? "Restore" : "Withdraw"} submitClass="btn btn-secondary btn-sm" className="flex items-end gap-2" confirm={e.revoked_at ? "Restore this access?" : "Withdraw this student's access?"}>
                          <input type="hidden" name="id" value={e.id} />
                          <input type="hidden" name="revoked" value={e.revoked_at ? "false" : "true"} />
                          <input name="note" className="input w-40" required minLength={5} maxLength={300} placeholder="Reason" aria-label="Reason" />
                        </ActionForm>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

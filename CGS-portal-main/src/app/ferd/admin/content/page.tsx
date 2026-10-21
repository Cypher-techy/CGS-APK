import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { setContentStatus } from "@/modules/ferd/admin-actions";
import { CONTENT_STATUS, CONTENT_TYPES, displayStatus } from "@/modules/ferd/constants";
import { requireStaff } from "@/modules/ferd/session";

const PAGE = 30;
const SORTS: Record<string, [string, boolean]> = { updated: ["updated_at", false], title: ["title", true], type: ["type", true], publish: ["publish_at", false] };

/** Content library: everything published or drafted in FERD, with search, filters, sorting and paging. */
export default async function FerdAdminContentPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; status?: string; dept?: string; tier?: string; sort?: string; page?: string; deleted?: string }>;
}) {
  const params = await searchParams;
  const { supabase, departments } = await requireStaff(["department_admin", "content_manager", "opportunities_manager", "project_manager"]);
  const page = Math.max(1, Number(params.page) || 1);
  const q = (params.q ?? "").replace(/[%,()*\\"']/g, " ").trim().slice(0, 80);
  const [column, ascending] = SORTS[params.sort ?? "updated"] ?? SORTS.updated;

  let query = supabase
    .from("ferd_content")
    .select("id, type, title, tier, status, publish_at, expires_at, departments, updated_at", { count: "exact" })
    .order(column, { ascending, nullsFirst: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (q) query = query.ilike("title", `%${q}%`);
  if (params.type && params.type in CONTENT_TYPES) query = query.eq("type", params.type);
  if (params.status && ["draft", "published", "unpublished", "archived"].includes(params.status)) query = query.eq("status", params.status);
  if (params.tier === "free" || params.tier === "premium") query = query.eq("tier", params.tier);
  if (params.dept && departments.some((d) => d.id === params.dept)) query = query.contains("departments", [params.dept]);
  const { data, count } = await query;
  const rows = data ?? [];
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const keep = Object.fromEntries(Object.entries({ q, type: params.type, status: params.status, dept: params.dept, tier: params.tier, sort: params.sort }).filter(([, v]) => v)) as Record<string, string>;
  const link = (next: number) => `/ferd/admin/content?${new URLSearchParams({ ...keep, page: String(next) })}`;
  const code = (ids: string[]) => (ids.length === 0 ? "All" : ids.map((id) => departments.find((d) => d.id === id)?.code ?? "?").join(", "));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Content library"
        description="Notes, manuals, announcements, events, opportunities, galleries, datasets and more. Changes go live for students immediately; no deployment is needed."
        actions={<Link href="/ferd/admin/content/new" className="btn btn-primary">New content</Link>}
      />
      {params.deleted && <p className="alert alert-success" role="status">The item and its files were deleted.</p>}
      <form className="flex flex-wrap items-end gap-3" role="search">
        <label className="min-w-44 flex-1">
          <span className="label">Search title</span>
          <input name="q" type="search" defaultValue={q} className="input" />
        </label>
        <label>
          <span className="label">Type</span>
          <select name="type" defaultValue={params.type ?? ""} className="input">
            <option value="">All</option>
            {Object.entries(CONTENT_TYPES).map(([key, value]) => (
              <option key={key} value={key}>{value.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Status</span>
          <select name="status" defaultValue={params.status ?? ""} className="input">
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="unpublished">Unpublished</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <label>
          <span className="label">Access</span>
          <select name="tier" defaultValue={params.tier ?? ""} className="input">
            <option value="">All</option>
            <option value="free">Free</option>
            <option value="premium">Premium</option>
          </select>
        </label>
        <label>
          <span className="label">Department</span>
          <select name="dept" defaultValue={params.dept ?? ""} className="input">
            <option value="">All</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Sort by</span>
          <select name="sort" defaultValue={params.sort ?? "updated"} className="input">
            <option value="updated">Last edited</option>
            <option value="publish">Publication date</option>
            <option value="title">Title</option>
            <option value="type">Type</option>
          </select>
        </label>
        <button type="submit" className="btn btn-secondary">Apply</button>
      </form>

      <Card pad={false}>
        {rows.length === 0 ? (
          <EmptyState title="No content matches">Use “New content” to add the first item.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Type</th>
                  <th>Departments</th>
                  <th>Access</th>
                  <th>Status</th>
                  <th>Edited</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const shown = displayStatus(row);
                  return (
                    <tr key={row.id}>
                      <td><Link href={`/ferd/admin/content/${row.id}`} className="link">{row.title}</Link></td>
                      <td>{CONTENT_TYPES[row.type]?.label ?? row.type}</td>
                      <td>{code(row.departments ?? [])}</td>
                      <td className="capitalize">{row.tier}</td>
                      <td><StatusBadge map={CONTENT_STATUS} value={shown} /></td>
                      <td className="text-xs text-muted-grey">{formatDateTime(row.updated_at)}</td>
                      <td>
                        <ActionForm action={setContentStatus} submitLabel={row.status === "published" ? "Unpublish" : "Publish"} submitClass="btn btn-secondary btn-sm">
                          <input type="hidden" name="id" value={row.id} />
                          <input type="hidden" name="status" value={row.status === "published" ? "unpublished" : "published"} />
                        </ActionForm>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between text-sm text-muted-grey">
          <span>Page {page} of {pages} · {count} items</span>
          <span className="flex gap-2">
            {page > 1 && <Link href={link(page - 1)} className="btn btn-secondary btn-sm">Previous</Link>}
            {page < pages && <Link href={link(page + 1)} className="btn btn-secondary btn-sm">Next</Link>}
          </span>
        </nav>
      )}
    </div>
  );
}

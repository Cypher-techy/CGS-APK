import Link from "next/link";
import { ActivityList, ACTIVITY_COLUMNS } from "@/components/lists";
import { Card, PageHeader } from "@/components/ui";
import { requireActive } from "@/lib/auth";

const ENTITIES = ["project", "task", "milestone", "document", "monitoring_record", "user", "category", "settings"];
const PAGE_SIZE = 100;

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ entity?: string; from?: string; to?: string; page?: string }> }) {
  const { supabase } = await requireActive(["super_admin"]);
  const { entity = "", from = "", to = "", page = "1" } = await searchParams;
  const pageNumber = Math.max(1, Number.parseInt(page, 10) || 1);
  const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

  let query = supabase
    .from("activity_logs")
    .select(ACTIVITY_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range((pageNumber - 1) * PAGE_SIZE, pageNumber * PAGE_SIZE - 1);
  if (ENTITIES.includes(entity)) query = query.eq("entity_type", entity);
  if (isDate(from)) query = query.gte("created_at", `${from}T00:00:00+03:00`);
  if (isDate(to)) query = query.lte("created_at", `${to}T23:59:59+03:00`);
  const { data: logs, count, error } = await query;
  if (error) throw new Error(error.message);

  const total = count ?? 0;
  const pageLink = (n: number) => `/dashboard/admin/activity?${new URLSearchParams({ entity, from, to, page: String(n) })}`;

  return (
    <>
      <PageHeader
        title="Activity logs"
        description="Audit trail of important operations. Entries are written by the database when records change and cannot be edited."
      />
      <Card pad={false}>
        <form className="flex flex-wrap items-end gap-3 border-b border-subtle-border p-4">
          <label>
            <span className="label">Record type</span>
            <select name="entity" defaultValue={entity} className="input">
              <option value="">All</option>
              {ENTITIES.map((value) => (
                <option key={value} value={value}>{value.replace("_", " ")}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">From</span>
            <input name="from" type="date" defaultValue={from} className="input" />
          </label>
          <label>
            <span className="label">To</span>
            <input name="to" type="date" defaultValue={to} className="input" />
          </label>
          <button type="submit" className="btn btn-secondary">Apply</button>
          {(entity || from || to) && <Link href="/dashboard/admin/activity" className="btn btn-secondary">Clear</Link>}
        </form>
        <ActivityList logs={logs} empty="No activity matches these filters." />
        <div className="flex items-center justify-between border-t border-subtle-border px-4 py-2.5 text-xs text-muted-grey">
          <span>
            {total === 0 ? "0 entries" : `Entries ${(pageNumber - 1) * PAGE_SIZE + 1}–${Math.min(pageNumber * PAGE_SIZE, total)} of ${total}`}
          </span>
          <span className="flex gap-2">
            {pageNumber > 1 && <Link href={pageLink(pageNumber - 1)} className="btn btn-secondary btn-sm">Newer</Link>}
            {pageNumber * PAGE_SIZE < total && <Link href={pageLink(pageNumber + 1)} className="btn btn-secondary btn-sm">Older</Link>}
          </span>
        </div>
      </Card>
    </>
  );
}

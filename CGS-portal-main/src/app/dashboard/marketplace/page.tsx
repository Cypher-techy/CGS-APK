import Link from "next/link";
import { Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { requireActive } from "@/lib/auth";
import { DEVELOPMENT_STAGES } from "@/lib/constants";
import { formatNumber } from "@/lib/format";

const CARBON_NOTE =
  "Carbon figures are estimates recorded by the project team with their stated method. They are not verified emission reductions and not issued carbon credits unless the development stage says so with a named standard and evidence.";

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; county?: string; stage?: string; min_area?: string; saved?: string }>;
}) {
  const { supabase, profile } = await requireActive(["investor", "super_admin"]);
  const params = await searchParams;
  const { q = "", category = "", county = "", stage = "", min_area = "", saved } = params;

  const [{ data: all, error }, { data: savedRows }] = await Promise.all([
    supabase.rpc("marketplace_browse"),
    supabase.from("marketplace_saved").select("project_id"),
  ]);
  if (error) throw new Error(error.message);
  const savedIds = new Set((savedRows ?? []).map((r) => r.project_id));

   
  const listings = (all ?? []) as any[];
  const term = q.trim().toLowerCase();
  const minArea = Number(min_area) || 0;
  const scale = (l: { mapped_area_ha: number | null; declared_area_ha: number | null }) => Number(l.mapped_area_ha ?? l.declared_area_ha ?? 0);
  const shown = listings
    .filter((l) => !term || `${l.name} ${l.summary} ${l.code}`.toLowerCase().includes(term))
    .filter((l) => !category || l.category === category)
    .filter((l) => !county || l.county === county)
    .filter((l) => !stage || l.development_stage === stage)
    .filter((l) => scale(l) >= minArea)
    .filter((l) => !saved || savedIds.has(l.project_id))
    .sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));
  const options = (key: string) => [...new Set(listings.map((l) => l[key]).filter(Boolean))].sort() as string[];
  const filtered = !!(q || category || county || stage || min_area);

  return (
    <>
      <PageHeader
        title={saved ? "Saved projects" : "Carbon project marketplace"}
        description="Published environmental projects open to partnership enquiries. Discovery and enquiries only: no carbon credits are traded and no payments are processed here."
        actions={profile.role === "investor" && <Link href="/dashboard/marketplace/enquiries" className="btn btn-secondary">My enquiries</Link>}
      />
      <p className="alert alert-info mb-4">{CARBON_NOTE}</p>
      <Card pad={false}>
        <form className="grid items-end gap-3 border-b border-subtle-border p-4 sm:grid-cols-2 lg:grid-cols-6">
          {saved && <input type="hidden" name="saved" value="1" />}
          <label className="lg:col-span-2">
            <span className="label">Search</span>
            <input name="q" defaultValue={q} placeholder="Project name or keyword" className="input" />
          </label>
          <label>
            <span className="label">Category</span>
            <select name="category" defaultValue={category} className="input">
              <option value="">All</option>
              {options("category").map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <label>
            <span className="label">County</span>
            <select name="county" defaultValue={county} className="input">
              <option value="">All</option>
              {options("county").map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <label>
            <span className="label">Development stage</span>
            <select name="stage" defaultValue={stage} className="input">
              <option value="">All</option>
              {Object.entries(DEVELOPMENT_STAGES).map(([value, { label }]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>
            <span className="label">Minimum area (ha)</span>
            <input name="min_area" type="number" min="0" step="1" defaultValue={min_area} className="input" />
          </label>
          <div className="flex gap-2 lg:col-span-6">
            <button type="submit" className="btn btn-secondary">Apply filters</button>
            {filtered && <Link href={saved ? "/dashboard/marketplace?saved=1" : "/dashboard/marketplace"} className="btn btn-secondary">Clear</Link>}
          </div>
        </form>
        {shown.length === 0 ? (
          <EmptyState title={saved ? "You have not saved any projects." : filtered ? "No listings match these filters." : "No projects are listed yet."}>
            {!saved && !filtered && "Listings appear here once a project owner submits one and CGS publishes it."}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Category</th>
                  <th>County</th>
                  <th>Area (ha)</th>
                  <th>Development stage</th>
                  <th>Estimated carbon potential</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => (
                  <tr key={l.project_id}>
                    <td>
                      <Link href={`/dashboard/marketplace/${l.project_id}`} className="link">{l.name}</Link>
                      <div className="text-xs text-muted-grey">
                        {l.code}
                        {savedIds.has(l.project_id) && " · Saved"}
                      </div>
                    </td>
                    <td>{l.category ?? "—"}</td>
                    <td>{l.county}</td>
                    <td className="tabular-nums">
                      {formatNumber(scale(l), 2)}
                      <div className="text-xs text-muted-grey">{l.mapped_area_ha !== null ? "Mapped" : "Declared"}</div>
                    </td>
                    <td>
                      <StatusBadge map={DEVELOPMENT_STAGES} value={l.development_stage} />
                      {l.standard && <div className="mt-1 text-xs text-muted-grey">{l.standard}</div>}
                    </td>
                    <td className="tabular-nums">
                      {l.estimated_tco2e !== null ? (
                        <>
                          {formatNumber(l.estimated_tco2e, 0)} tCO₂e
                          <div className="text-xs text-muted-grey">Estimate, not verified</div>
                        </>
                      ) : (
                        <span className="text-xs text-muted-grey">Not yet assessed</span>
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

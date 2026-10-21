import Link from "next/link";
import { Card, EmptyState, PageHeader, StatCard, StatGrid } from "@/components/ui";
import { requireActive } from "@/lib/auth";
import { formatNumber } from "@/lib/format";
import { MAP_UNAVAILABLE, projectIds, projectInsights, workspaceMap } from "@/modules/geo/data";
import { Earth } from "@/modules/geo/Earth";

/** Workspace Earth: the projects the viewer is authorised to see, on the globe and as a 2D GIS map. */
export default async function GisPage() {
  const { supabase } = await requireActive();
  const [{ features: collection, available }, insights, { data: projects }, { data: boundaries }] = await Promise.all([
    workspaceMap(supabase),
    projectInsights(supabase),
    supabase.from("projects").select("id, code, name, country, county, area_ha, latitude, longitude").order("name"),
    supabase.from("project_boundaries").select("project_id, area_ha, source, updated_at"),
  ]);
  const mapped = new Map((boundaries ?? []).map((b) => [b.project_id, b]));
  const count = (kind: string) => collection.features.filter((f) => f.properties?.kind === kind).length;
  const mappedArea = (boundaries ?? []).reduce((total, b) => total + Number(b.area_ha), 0);
  const unplaced = (projects ?? []).filter((p) => p.latitude === null && !mapped.has(p.id)).length;

  return (
    <>
      <PageHeader
        title="Earth & GIS workspace"
        description="Your projects on the Earth: boundaries, sites, declared locations and georeferenced field observations. Switch between the 3D Earth and the 2D GIS map at any time."
        actions={<a href="/api/gis/export" className="btn btn-secondary">Export GeoJSON</a>}
      />
      <div className="space-y-5">
        {!available && <p className="alert alert-warning" role="status">{MAP_UNAVAILABLE}</p>}
        <Earth features={collection} mode="workspace" variant="embedded" signedIn ownProjectIds={projectIds(collection)} insights={insights} basePath="/dashboard/gis" height="min(74vh, 44rem)" />
        <StatGrid>
          <StatCard label="Projects" value={(projects ?? []).length} hint={unplaced > 0 ? `${unplaced} without a location yet` : "All placed on the map"} />
          <StatCard label="With mapped boundary" value={mapped.size} hint={`${(projects ?? []).length - mapped.size} without a boundary`} />
          <StatCard label="Total mapped area" value={`${formatNumber(mappedArea, 2)} ha`} hint="Derived from boundary geometry" />
          <StatCard label="Sites / observations" value={`${count("site")} / ${count("observation")}`} hint="Georeferenced records" />
        </StatGrid>
        <Card title="Spatial summary by project" pad={false}>
          {(projects ?? []).length === 0 ? (
            <EmptyState title="No projects available">There are no projects in your workspace to map yet.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Location</th>
                    <th>Declared area (ha)</th>
                    <th>Mapped area (ha)</th>
                    <th>Difference</th>
                    <th>Boundary source</th>
                  </tr>
                </thead>
                <tbody>
                  {(projects ?? []).map((p) => {
                    const b = mapped.get(p.id);
                    const diff = b && p.area_ha !== null ? Number(b.area_ha) - Number(p.area_ha) : null;
                    return (
                      <tr key={p.id}>
                        <td>
                          <Link href={`/dashboard/projects/${p.id}?tab=map`} className="link">{p.name}</Link>
                          <div className="text-xs text-muted-grey">{p.code}</div>
                        </td>
                        <td>
                          {p.county}
                          <div className="text-xs text-muted-grey">{p.country}</div>
                        </td>
                        <td className="tabular-nums">{formatNumber(p.area_ha, 2)}</td>
                        <td className="tabular-nums">{b ? formatNumber(b.area_ha, 2) : "Not mapped"}</td>
                        <td className="tabular-nums">{diff === null ? "—" : `${diff > 0 ? "+" : ""}${formatNumber(diff, 2)} ha`}</td>
                        <td className="text-xs text-muted-grey">{b?.source ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <p className="text-xs text-muted-grey">
          Mapped area is the geodesic area of the stored boundary (derived). Declared area is the figure entered by the project owner (user-submitted).
          Land cover is a third-party satellite classification and has not been ground-truthed by CGS.
        </p>
      </div>
    </>
  );
}

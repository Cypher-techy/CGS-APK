import Link from "next/link";
import type { Supabase } from "@/lib/supabase/server";
import { MAP_UNAVAILABLE, projectIds, projectInsights, workspaceMap } from "@/modules/geo/data";
import { Earth } from "@/modules/geo/Earth";

/**
 * The Earth as the first thing on a dashboard: the viewer's permitted projects in their geographic context.
 * Administrators are pointed to the command centre, which adds platform-wide activity.
 */
export async function WorkspaceEarth({ supabase, admin = false }: { supabase: Supabase; admin?: boolean }) {
  const [{ features, available }, insights] = await Promise.all([workspaceMap(supabase), projectInsights(supabase)]);
  return (
    <section aria-label="Your projects on the Earth">
      {!available && <p className="alert alert-warning mb-2" role="status">{MAP_UNAVAILABLE}</p>}
      <Earth features={features} mode={admin ? "admin" : "workspace"} variant="embedded" signedIn ownProjectIds={projectIds(features)} insights={insights} basePath="/dashboard" height="min(60vh, 34rem)" />
      <p className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-muted-grey">
        <span>Select a country, county or project on the Earth to see what is happening there.</span>
        <Link href={admin ? "/dashboard/command" : "/dashboard/gis"} className="link">
          {admin ? "Open the Global Command Center" : "Open the full Earth & GIS workspace"}
        </Link>
      </p>
    </section>
  );
}

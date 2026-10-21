import type { Metadata } from "next";
import { PublicShell } from "@/components/PublicShell";
import { getSession } from "@/lib/auth";
import { mergeFeatures, projectIds, publicFeatures, workspaceFeatures } from "@/modules/geo/data";
import { Earth } from "@/modules/geo/Earth";

export const metadata: Metadata = {
  title: "Explore the Earth",
  description: "Discover environmental projects geographically: Earth, Africa, Kenya, county, project and site.",
};
export const dynamic = "force-dynamic";

/** Public Explore mode. Signed-in users also see the projects they take part in. */
export default async function ExplorePage() {
  const session = await getSession();
  const active = !!session && session.profile.status === "active" && !!session.profile.terms_accepted_at;
  const [shared, own] = await Promise.all([
    publicFeatures(session?.supabase),
    active ? workspaceFeatures(session.supabase).catch(() => null) : null,
  ]);
  const features = own ? mergeFeatures(own, shared.features) : shared.features;

  return (
    <PublicShell immersive>
      <div className="flex h-full flex-col p-2 sm:p-3">
        <h1 className="sr-only">Explore environmental projects on the Earth</h1>
        {!shared.available && (
          <p className="alert alert-warning mb-2" role="status">
            The public project feed is unavailable right now. The map and its reference layers still work.
          </p>
        )}
        <Earth features={features} mode="explore" signedIn={!!session} ownProjectIds={own ? projectIds(own) : []} basePath="/explore" height="100%" className="min-h-0 flex-1" />
      </div>
    </PublicShell>
  );
}

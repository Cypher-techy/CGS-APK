import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, MapPin } from "lucide-react";
import { PublicShell } from "@/components/PublicShell";
import { StatusBadge } from "@/components/ui";
import { LIFECYCLE_STAGES, PROJECT_STATUS } from "@/lib/constants";
import { formatNumber } from "@/lib/format";
import { publicFeatures } from "@/modules/geo/data";
import { encodePath } from "@/modules/geo/geo-utils";
import { COUNTRIES } from "@/modules/geo/places";

export const metadata: Metadata = { title: "Environmental Projects" };
export const dynamic = "force-dynamic";

export default async function PublicProjectsPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const { category } = await searchParams;
  const { features, available } = await publicFeatures();
  const all = features.features.filter((f) => f.properties?.kind === "project").map((f) => f.properties!);
  const categories = [...new Set(all.map((p) => p.category).filter(Boolean))].sort() as string[];
  const projects = category ? all.filter((p) => p.category === category) : all;
  const at = (p: Record<string, unknown>) => {
    const country = COUNTRIES.find((c) => c.name.toLowerCase() === String(p.country).toLowerCase());
    return encodePath({ continent: country?.continent ?? null, country: country?.iso2 ?? null, county: String(p.county), project: String(p.project_id), site: null });
  };

  return (
    <PublicShell>
      <div className="contours border-b border-subtle-border">
        <div className="mx-auto max-w-[92rem] px-4 pb-14 pt-36 sm:px-8 sm:pt-44">
          <p className="kicker">Environmental projects</p>
          <h1 className="mt-3 max-w-4xl text-5xl font-bold leading-[0.98] text-white sm:text-7xl">Projects published on the CGS Earth</h1>
          <p className="mt-4 max-w-2xl text-lg text-muted-grey">
            Each project below was approved by CGS and published by its manager. Open one to see its location, boundary and sites on the map.
          </p>
          {categories.length > 0 && (
            <nav aria-label="Project categories" className="mt-6 flex flex-wrap gap-2">
              <Link href="/projects" className={`btn btn-sm ${category ? "btn-secondary" : "btn-primary"}`}>All</Link>
              {categories.map((name) => (
                <Link key={name} href={`/projects?category=${encodeURIComponent(name)}`} className={`btn btn-sm ${category === name ? "btn-primary" : "btn-secondary"}`}>
                  {name}
                </Link>
              ))}
            </nav>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-[92rem] px-4 py-12 sm:px-6">
        {projects.length === 0 ? (
          <div className="card mx-auto max-w-xl p-10 text-center">
            <p className="font-display text-xl font-semibold text-heading">{available ? "No projects available" : "Project data unavailable"}</p>
            <p className="mt-2 text-sm text-muted-grey">
              {available
                ? "No project has been published to Explore yet. Projects appear here after CGS approval, when their manager chooses to publish them."
                : "The project register could not be read right now. Please try again shortly."}
            </p>
            <Link href="/explore" className="btn btn-primary mt-5">Explore the Earth</Link>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <li key={p.project_id} className="card flex flex-col p-6">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge map={PROJECT_STATUS} value={p.status} />
                  <span className="text-xs text-muted-grey">{p.category ?? "Uncategorised"}</span>
                </div>
                <h2 className="mt-3 text-xl font-semibold text-heading">{p.name}</h2>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-grey">
                  <MapPin className="h-4 w-4" aria-hidden="true" /> {[p.county, p.country].filter(Boolean).join(", ")}
                </p>
                {p.summary && <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-charcoal">{p.summary}</p>}
                <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-subtle-border pt-4 text-xs">
                  <div>
                    <dt className="text-muted-grey">Mapped area (derived)</dt>
                    <dd className="font-semibold text-charcoal">{p.mapped_area_ha != null ? `${formatNumber(p.mapped_area_ha, 1)} ha` : "Not mapped"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-grey">Stage</dt>
                    <dd className="font-semibold text-charcoal">{LIFECYCLE_STAGES[p.lifecycle_stage]?.label ?? "—"}</dd>
                  </div>
                </dl>
                <Link href={`/explore?at=${at(p)}`} className="link mt-5 inline-flex items-center gap-1 text-sm">
                  View on the Earth <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PublicShell>
  );
}

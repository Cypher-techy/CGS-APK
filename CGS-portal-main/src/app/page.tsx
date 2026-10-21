import { FileCheck2, Layers, LineChart, MapPinned, Satellite, Sprout, Store, Users } from "lucide-react";
import { CtaButton, Preloader, Reveal } from "@/components/Motion";
import { PublicShell, Section } from "@/components/PublicShell";
import { formatNumber } from "@/lib/format";
import { SITE } from "@/lib/site";
import { publicFeatures } from "@/modules/geo/data";
import { Earth } from "@/modules/geo/Earth";

export const dynamic = "force-dynamic";

const LADDER = [
  ["Earth", "Start from the whole planet and rotate to any region."],
  ["Africa", "The continent CGS is built for, with every country selectable."],
  ["Kenya", "Country view with the 47 counties outlined."],
  ["County", "Projects, areas and activity inside one county."],
  ["Project", "Boundary, sites, team, documents and monitoring."],
  ["Site", "A single planting block or monitoring point and its field records."],
];

const CAPABILITIES = [
  { icon: MapPinned, title: "GIS and project boundaries", body: "Draw or import boundaries (GeoJSON, KML, shapefile). Areas are calculated from the stored geometry, never typed in by hand." },
  { icon: Sprout, title: "Field monitoring", body: "Field officers record observations with GPS, measurements and photographs, online or offline. Each record is reviewed before it counts." },
  { icon: FileCheck2, title: "MRV and evidence", body: "Monitoring schedules, carbon estimates with their method and assumptions, and a private evidence store with review status." },
  { icon: Layers, title: "Project operations", body: "Registration and approval, tasks, milestones, teams, comments and notifications, all tied to the project's place on the map." },
  { icon: LineChart, title: "Analytics and reports", body: "Progress, monitoring activity and area statistics by country and county, with PDF and CSV exports generated from recorded data." },
  { icon: Store, title: "Carbon project marketplace", body: "Approved projects can be listed for registered investors and developers to discover and enquire about. No trading or payments." },
];

const CLAIMS: [string, string][] = [
  ["Estimated", "A figure produced by a stated method and assumptions."],
  ["Projected", "An expectation about the future, not an outcome."],
  ["Under development", "The project has not yet been validated or registered."],
  ["Monitored", "Field data has been recorded and reviewed inside CGS."],
  ["Verified", "Confirmed by an independent body under a named standard, with evidence on file."],
  ["Issued", "Credits issued by a registry. Shown only when that record exists."],
];

// What the markers on the globe stand for; the colours match the map layers.
const HERO_TAGS: { label: string; color: string; position: string; line: string }[] = [
  { label: "Project boundaries", color: "#5fb37f", position: "left-[6%] top-[22%]", line: "w-16" },
  { label: "Project sites", color: "#3d9bbd", position: "right-[4%] top-[34%]", line: "w-10" },
  { label: "Field observations", color: "#f4783e", position: "left-[10%] bottom-[20%]", line: "w-12" },
];

export default async function HomePage() {
  const { features, available } = await publicFeatures();
  const projects = features.features.filter((f) => f.properties?.kind === "project");
  const countries = new Set(projects.map((f) => f.properties?.country)).size;
  const mapped = features.features.filter((f) => f.properties?.kind === "boundary").reduce((total, f) => total + Number(f.properties?.area_ha ?? 0), 0);

  return (
    <PublicShell>
      <Preloader />

      {/* Hero: the Earth is the interface, not a backdrop. */}
      <section className="earth relative overflow-hidden">
        <div className="relative mx-auto grid min-h-dvh max-w-[92rem] items-center gap-6 px-4 pb-10 pt-28 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <div className="relative z-10">
            <p className="glass inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium text-white">
              <span className="h-2 w-2 rounded-full bg-primary-green" /> {SITE.name}
            </p>
            <h1 className="mt-6 text-[clamp(3rem,7.2vw,7.5rem)] font-bold leading-[0.92] text-white">
              Environmental Intelligence <span className="text-clay">Infrastructure</span> for Africa
            </h1>
            <p className="mt-7 max-w-xl text-lg text-muted-grey sm:text-xl">
              Connect environmental projects, geographic intelligence, monitoring, MRV and project operations through one integrated platform.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <CtaButton href="/explore">Explore the Earth</CtaButton>
              <CtaButton href="/dashboard/projects/new" clear>Create a Project</CtaButton>
            </div>
            <p className="mt-8 text-xs uppercase tracking-[0.16em] text-muted-grey">{SITE.descriptor}</p>
          </div>

          <div className="relative">
            <Earth features={features} mode="explore" variant="hero" signedIn={false} basePath="/explore" height="min(76vh, 46rem)" className="[&_.earth]:bg-none" />
            {/* Callouts name what the markers on the globe are. They sit above the map without blocking it. */}
            <ul className="pointer-events-none absolute inset-0 hidden md:block" aria-label="What the Earth shows">
              {HERO_TAGS.map((tag) => (
                <li key={tag.label} className={`absolute flex items-center gap-2 ${tag.position}`}>
                  <span className="glass flex items-center gap-2 rounded-full px-3.5 py-2 text-sm text-white">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: tag.color }} /> {tag.label}
                  </span>
                  <span className={`h-px bg-white/40 ${tag.line}`} />
                  <span className="h-1.5 w-1.5 rounded-full bg-white" />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Real figures from the public project register. */}
      <section className="mx-auto max-w-[92rem] px-4 py-10 sm:px-8">
        <dl className="grid gap-3 sm:grid-cols-3">
          {[
            ["Published projects", available ? formatNumber(projects.length) : "—", "On the public Explore map"],
            ["Countries", available ? formatNumber(countries) : "—", "With at least one published project"],
            ["Mapped area", available && mapped > 0 ? `${formatNumber(mapped)} ha` : "—", "Derived from stored boundaries"],
          ].map(([label, value, hint], i) => (
            <Reveal key={label} delay={i * 90} className="card p-7">
              <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-grey">{label}</dt>
              <dd className="mt-2 font-display text-6xl font-bold tabular-nums text-white">{value}</dd>
              <dd className="mt-1 text-sm text-muted-grey">{hint}</dd>
            </Reveal>
          ))}
        </dl>
        {available && projects.length === 0 && (
          <p className="mt-4 text-sm text-muted-grey">
            No projects have been published to Explore yet. Figures appear here as soon as approved projects are published; nothing on this page is sample data.
          </p>
        )}
      </section>

      <Section kicker="One continuous map" title="From the whole Earth to a single monitoring site" lead="CGS never swaps the map for a dashboard. Each step keeps you on the same Earth, one level closer to the ground.">
        {/* A row of cards to flick through, one per level of the drill-down. */}
        <ol className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 sm:-mx-8 sm:px-8">
          {LADDER.map(([step, text], i) => (
            <li key={step} className="card relative flex h-80 w-[17rem] shrink-0 snap-start flex-col justify-between overflow-hidden p-7 sm:w-[20rem]">
              <span className="font-display text-8xl font-bold leading-none text-white/10">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <span className="glass inline-block rounded-full px-3 py-1 text-xs text-white">Level {i + 1} of {LADDER.length}</span>
                <h3 className="mt-3 font-display text-3xl font-bold text-white">{step}</h3>
                <p className="mt-2 text-sm text-muted-grey">{text}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-10">
          <CtaButton href="/explore">Open the Earth</CtaButton>
        </div>
      </Section>

      <Section tone="cream" kicker="The platform" title="Organizations, projects, sites, observations, evidence, MRV and reports in one record" lead="Everything that can have a location has one, so a document or a field record is always one step from the place it describes.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map(({ icon: Icon, title, body }, i) => (
            <Reveal key={title} delay={(i % 3) * 90} className="card p-7">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-clay text-white">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-5 font-display text-2xl font-bold text-white">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-grey">{body}</p>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section tone="dark" kicker="Carbon integrity" title="An estimate is never shown as a verified credit" lead="Every carbon figure in CGS carries one of these labels. Verified and issued appear only when the supporting record exists.">
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CLAIMS.map(([label, text], i) => (
            <Reveal key={label} delay={(i % 3) * 90} className="glass rounded-3xl p-6">
              <dt className="font-display text-2xl font-bold text-white">{label}</dt>
              <dd className="mt-1.5 text-sm text-muted-grey">{text}</dd>
            </Reveal>
          ))}
        </dl>
        <p className="mt-8 max-w-3xl text-sm text-muted-grey">
          CGS does not certify projects, verify emission reductions, issue credits or promise financial returns. Those steps belong to independent bodies under the applicable standard.
        </p>
      </Section>

      <Section kicker="Who uses CGS" title="One platform, eight roles, each with its own view of the map">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { icon: Users, title: "Owners, landowners and communities", body: "Register a project, draw its boundary, follow approval and reviewed progress, and raise feedback or grievances." },
            { icon: Satellite, title: "Managers, GIS analysts, field officers and MRV specialists", body: "Run tasks and milestones, map boundaries and sites, capture field data and keep the evidence trail in order." },
            { icon: Store, title: "Investors and project developers", body: "Discover listed projects with their stage, method and evidence status, and enquire through a tracked workflow." },
          ].map(({ icon: Icon, title, body }, i) => (
            <Reveal key={title} delay={i * 90} className="card p-8">
              <Icon className="h-7 w-7 text-clay" aria-hidden="true" />
              <h3 className="mt-5 font-display text-2xl font-bold text-white">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-grey">{body}</p>
            </Reveal>
          ))}
        </div>
      </Section>
    </PublicShell>
  );
}

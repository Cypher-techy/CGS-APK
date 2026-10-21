"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { Feature } from "geojson";
import { ArrowRight, BadgeCheck, ChevronDown, ChevronUp, MapPin } from "lucide-react";
import { StatusBadge } from "@/components/ui";
import { LIFECYCLE_STAGES, OBSERVATION_TYPES, PROJECT_STATUS, SITE_KINDS } from "@/lib/constants";
import { formatDate, formatDateTime, formatNumber, humanize } from "@/lib/format";
import { countBy, EARTH, levelOf, lngLatOf, type GeoPath, type ProjectPlace } from "@/modules/geo/geo-utils";
import { DATA_CLASS, STATUS_COLORS, type DataClass } from "@/modules/geo/layers";

export interface Insight {
  open_tasks: number;
  overdue_tasks: number;
  reports_awaiting_review: number;
  observations: number;
  last_observation: string | null;
  documents_awaiting_review: number;
  open_grievances: number;
  sites: number;
  team_members: number;
}

export interface ActivityEntry {
  id: number;
  action: string;
  created_at: string;
  project_id: string | null;
  actor: string | null;
  code: string | null;
}

/** Small label stating how far a figure can be trusted. */
export function DataTag({ kind }: { kind: DataClass }) {
  return (
    <span title={DATA_CLASS[kind].hint} className="rounded-full border border-subtle-border bg-surface px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-grey">
      {DATA_CLASS[kind].label}
    </span>
  );
}

function Stat({ label, value, tag }: { label: string; value: ReactNode; tag?: DataClass }) {
  return (
    <div className="rounded-2xl bg-surface px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-grey">{label}</p>
      <p className="mt-0.5 font-display text-xl font-semibold tabular-nums text-heading">{value}</p>
      {tag && <DataTag kind={tag} />}
    </div>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return <h3 className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-muted-grey">{children}</h3>;
}

function Row({ label, count, onClick }: { label: string; count: number; onClick?: () => void }) {
  const body = (
    <>
      <span className="truncate">{label}</span>
      <span className="flex items-center gap-1.5 tabular-nums text-muted-grey">
        {count} {onClick && <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />}
      </span>
    </>
  );
  const className = "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm text-charcoal";
  return onClick ? (
    <button type="button" onClick={onClick} className={`${className} hover:bg-sand`}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

const sumOf = (values: (number | null | undefined)[]) => values.reduce<number>((total, v) => total + Number(v ?? 0), 0);

export function ExplorerPanel({
  mode,
  variant,
  path,
  open,
  onToggle,
  scope,
  totalProjects,
  sites,
  observations,
  boundaries,
  insights,
  activity,
  note,
  placeLabel,
  signedIn,
  ownProjectIds,
  go,
  goProject,
  returnTo,
}: {
  mode: "explore" | "workspace" | "admin";
  variant: "full" | "embedded" | "hero";
  path: GeoPath;
  open: boolean;
  onToggle: () => void;
  /** Projects inside the selected place. */
  scope: ProjectPlace[];
  totalProjects: number;
  sites: Feature[];
  observations: Feature[];
  boundaries: Feature[];
  insights?: Record<string, Insight>;
  activity?: ActivityEntry[];
  note: { title: string; lines: string[]; href?: string } | null;
  placeLabel: string;
  signedIn: boolean;
  ownProjectIds?: string[];
  go: (path: GeoPath) => void;
  goProject: (id: string, site?: string | null) => void;
  returnTo: string;
}) {
  const level = levelOf(path);
  const ids = new Set(scope.map((p) => p.id));
  const scopeSites = sites.filter((f) => ids.has(String(f.properties?.project_id)));
  const scopeObservations = observations.filter((f) => ids.has(String(f.properties?.project_id)));
  const mappedArea = sumOf(boundaries.filter((f) => ids.has(String(f.properties?.project_id))).map((f) => f.properties?.area_ha));
  const declaredArea = sumOf(scope.map((p) => p.props.declared_area_ha));
  const emptyText =
    mode === "explore"
      ? "Projects appear here once CGS has approved them and their manager has published them to Explore."
      : mode === "admin"
        ? "No registered project has a location in this area."
        : "None of the projects you take part in are located here.";

  const title = level === "earth" ? (mode === "admin" ? "Global overview" : mode === "workspace" ? "Your projects on Earth" : "Explore the Earth") : placeLabel;
  const kicker = { earth: "Global", continent: "Continent", country: "Country", county: path.country === "KE" ? "County" : "Region", project: "Project", site: "Site" }[level];

  return (
    <aside
      aria-label="Location details"
      className={`absolute z-10 flex flex-col glass-strong overflow-hidden shadow-xl
        inset-x-2 bottom-2 rounded-3xl ${open ? "max-h-[58%]" : "max-h-14"}
        lg:inset-x-auto lg:bottom-3 lg:left-3 lg:top-16 lg:max-h-none ${variant === "full" ? "lg:w-[23rem]" : "lg:w-80"} ${open ? "" : "lg:bottom-auto"}`}
    >
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="min-w-0">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-clay">{kicker}</span>
          <span className="block truncate font-display text-lg font-semibold leading-tight text-heading">{title}</span>
        </span>
        {open ? <ChevronDown className="h-4 w-4 shrink-0 lg:hidden" /> : <ChevronUp className="h-4 w-4 shrink-0 lg:hidden" />}
        {open ? <ChevronUp className="hidden h-4 w-4 shrink-0 lg:block" /> : <ChevronDown className="hidden h-4 w-4 shrink-0 lg:block" />}
      </button>

      {open && (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {note && (
            <div className="mb-3 rounded-2xl border border-clay/30 bg-surface p-3 text-sm">
              <p className="font-semibold capitalize text-heading">{note.title}</p>
              {note.lines.map((line) => (
                <p key={line} className="text-xs text-muted-grey">{line}</p>
              ))}
              {note.href && signedIn && (
                <Link href={note.href} className="link mt-1 inline-block text-xs">Open field report</Link>
              )}
            </div>
          )}

          {level === "project" || level === "site" ? (
            <ProjectDetail
              place={scope[0]}
              path={path}
              sites={scopeSites}
              observations={scopeObservations}
              insight={scope[0] ? insights?.[scope[0].id] : undefined}
              canOpen={mode !== "explore" || !!ownProjectIds?.includes(scope[0]?.id ?? "")}
              signedIn={signedIn}
              goProject={goProject}
              returnTo={returnTo}
            />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Projects" value={scope.length} />
                <Stat label={level === "earth" || level === "continent" ? "Countries" : path.country === "KE" ? "Counties" : "Regions"} value={countBy(scope, (p) => (level === "earth" || level === "continent" ? p.countryName : p.county)).length} />
                <Stat label="Mapped area" value={mappedArea ? `${formatNumber(mappedArea, 0)} ha` : "—"} tag="derived" />
                <Stat label="Declared area" value={declaredArea ? `${formatNumber(declaredArea, 0)} ha` : "—"} tag="declared" />
                <Stat label="Sites" value={scopeSites.length} />
                {(signedIn || scopeObservations.length > 0) && <Stat label="Field observations" value={scopeObservations.length} tag="field" />}
              </div>

              {scope.length === 0 ? (
                <div className="mt-4 rounded-2xl bg-surface p-4 text-center">
                  <p className="text-sm font-semibold text-charcoal">No projects available</p>
                  <p className="mt-1 text-xs text-muted-grey">{totalProjects === 0 || level !== "earth" ? emptyText : ""}</p>
                  {level === "earth" && (
                    <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={() => go({ ...EARTH, continent: "Africa" })}>
                      Go to Africa
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {insights && <Alerts scope={scope} insights={insights} />}

                  <Heading>{level === "earth" ? "By continent" : level === "continent" ? "By country" : level === "country" ? (path.country === "KE" ? "By county" : "By region") : "Projects"}</Heading>
                  <div className="mt-1">
                    {level === "earth" &&
                      countBy(scope, (p) => p.continent ?? "Unplaced").map(([name, count]) => (
                        <Row key={name} label={name} count={count} onClick={name === "Unplaced" ? undefined : () => go({ ...EARTH, continent: name })} />
                      ))}
                    {level === "continent" &&
                      countBy(scope, (p) => p.countryName).map(([name, count]) => {
                        const iso2 = scope.find((p) => p.countryName === name)?.iso2;
                        return <Row key={name} label={name} count={count} onClick={iso2 ? () => go({ ...EARTH, continent: path.continent, country: iso2 }) : undefined} />;
                      })}
                    {level === "country" &&
                      countBy(scope, (p) => p.county).map(([name, count]) => (
                        <Row key={name} label={name} count={count} onClick={() => go({ ...path, county: name, project: null, site: null })} />
                      ))}
                    {level === "county" &&
                      scope.map((p) => (
                        <button key={p.id} type="button" onClick={() => goProject(p.id)} className="flex w-full items-start gap-2.5 rounded-xl px-3 py-2 text-left hover:bg-sand">
                          <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: STATUS_COLORS[p.props.status] ?? "#7a857e" }} />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-heading">{p.props.name}</span>
                            <span className="block truncate text-xs text-muted-grey">
                              {p.props.code} · {p.props.category ?? "Uncategorised"}
                            </span>
                          </span>
                        </button>
                      ))}
                  </div>

                  {level !== "county" && (
                    <>
                      <Heading>Project status</Heading>
                      <Bars rows={countBy(scope, (p) => p.props.status).map(([status, count]) => [PROJECT_STATUS[status]?.label ?? status, count, STATUS_COLORS[status]])} total={scope.length} />
                    </>
                  )}
                  <Heading>Project categories</Heading>
                  <Bars rows={countBy(scope, (p) => p.props.category ?? "Uncategorised").map(([name, count]) => [name, count, "#216b45"])} total={scope.length} />

                  {mode === "admin" && (
                    <>
                      <Heading>Organizations</Heading>
                      {countBy(scope, (p) => p.props.organization).length === 0 ? (
                        <p className="mt-1 px-3 text-xs text-muted-grey">No project here is linked to an organization.</p>
                      ) : (
                        countBy(scope, (p) => p.props.organization).map(([name, count]) => <Row key={name} label={name} count={count} />)
                      )}
                    </>
                  )}
                </>
              )}

              {activity && (
                <>
                  <Heading>Recent activity</Heading>
                  <ActivityFeed entries={level === "earth" ? activity : activity.filter((a) => a.project_id && ids.has(a.project_id))} />
                </>
              )}
            </>
          )}
        </div>
      )}
    </aside>
  );
}

function Bars({ rows, total }: { rows: [string, number, string | undefined][]; total: number }) {
  return (
    <ul className="mt-1.5 space-y-1.5 px-3">
      {rows.map(([label, count, color]) => (
        <li key={label} className="text-xs">
          <div className="flex justify-between gap-2 text-charcoal">
            <span className="truncate">{label}</span>
            <span className="tabular-nums text-muted-grey">{count}</span>
          </div>
          <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-sand">
            <div className="h-full rounded-full" style={{ width: `${(count / Math.max(total, 1)) * 100}%`, background: color ?? "#216b45" }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Alerts({ scope, insights }: { scope: ProjectPlace[]; insights: Record<string, Insight> }) {
  const rows = scope.map((p) => insights[p.id]).filter(Boolean);
  const total = (key: keyof Insight) => sumOf(rows.map((r) => Number(r[key] ?? 0)));
  const alerts: [string, number][] = [
    ["Overdue tasks", total("overdue_tasks")],
    ["Field reports awaiting review", total("reports_awaiting_review")],
    ["Documents awaiting review", total("documents_awaiting_review")],
    ["Open grievances", total("open_grievances")],
  ];
  const active = alerts.filter(([, count]) => count > 0);
  return (
    <>
      <Heading>Alerts</Heading>
      {active.length === 0 ? (
        <p className="mt-1 px-3 text-xs text-muted-grey">Nothing needs attention in this area.</p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {active.map(([label, count]) => (
            <li key={label} className="flex items-center justify-between rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-xs text-amber-200">
              {label} <span className="font-semibold tabular-nums">{count}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 px-3 text-xs text-muted-grey">
        {total("open_tasks")} open tasks · {total("observations")} field records · {total("team_members")} team members
      </p>
    </>
  );
}

function ActivityFeed({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length === 0) return <p className="mt-1 px-3 text-xs text-muted-grey">No recorded activity for this area.</p>;
  return (
    <ul className="mt-1.5 space-y-1.5 px-3">
      {entries.slice(0, 8).map((entry) => (
        <li key={entry.id} className="text-xs">
          <span className="text-charcoal">{humanize(entry.action)}</span>
          <span className="block text-muted-grey">
            {[entry.code, entry.actor, formatDateTime(entry.created_at)].filter(Boolean).join(" · ")}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ProjectDetail({
  place,
  path,
  sites,
  observations,
  insight,
  canOpen,
  signedIn,
  goProject,
  returnTo,
}: {
  place: ProjectPlace | undefined;
  path: GeoPath;
  sites: Feature[];
  observations: Feature[];
  insight?: Insight;
  canOpen: boolean;
  signedIn: boolean;
  goProject: (id: string, site?: string | null) => void;
  returnTo: string;
}) {
  if (!place) {
    return (
      <div className="rounded-2xl bg-surface p-4 text-center">
        <p className="text-sm font-semibold text-charcoal">Project not available</p>
        <p className="mt-1 text-xs text-muted-grey">This project is not published, or you are not one of its participants.</p>
      </div>
    );
  }
  const p = place.props;
  const stage = LIFECYCLE_STAGES[p.lifecycle_stage];
  const site = path.site ? sites.find((f) => f.properties?.site_id === path.site) : null;
  const siteObservations = site ? observations.filter((f) => f.properties?.site_id === path.site) : observations;
  const reviewed = p.reviewed_observations ?? null;

  return (
    <div className="text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge map={PROJECT_STATUS} value={p.status} />
        <span className="text-xs text-muted-grey">{p.code}</span>
        {p.is_public && <span className="rounded-full bg-sage/30 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-heading">Public</span>}
      </div>
      <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-grey">
        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {[p.sub_county, place.county, place.countryName].filter(Boolean).join(", ")}
        {p.position_source === "boundary" && " · position taken from the mapped boundary"}
      </p>
      {p.organization && (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-charcoal">
          {p.organization_verified && <BadgeCheck className="h-3.5 w-3.5 text-primary-green" aria-label="Verified organization" />}
          {p.organization}
          {!p.organization_verified && <span className="text-muted-grey">(organization not yet verified)</span>}
        </p>
      )}

      {site && (
        <div className="mt-3 rounded-2xl border border-subtle-border bg-surface p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-clay">{SITE_KINDS[site.properties?.site_kind] ?? "Site"}</p>
          <p className="font-display text-base font-semibold text-heading">{site.properties?.name}</p>
          {site.properties?.description && <p className="mt-1 text-xs text-muted-grey">{site.properties.description}</p>}
          <p className="mt-1 text-xs tabular-nums text-muted-grey">
            {lngLatOf(site.geometry).slice().reverse().map((c) => c.toFixed(5)).join(", ")}
            {site.properties?.area_ha ? ` · ${formatNumber(site.properties.area_ha, 2)} ha` : ""}
          </p>
          <button type="button" className="link mt-1 text-xs" onClick={() => goProject(place.id)}>
            Back to the whole project
          </button>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Stat label="Mapped area" value={p.mapped_area_ha != null ? `${formatNumber(p.mapped_area_ha, 1)} ha` : "Not mapped"} tag="derived" />
        <Stat label="Declared area" value={p.declared_area_ha != null ? `${formatNumber(p.declared_area_ha, 1)} ha` : "—"} tag="declared" />
        <Stat label="Sites" value={p.site_count ?? sites.length} />
        <Stat label={reviewed !== null ? "Reviewed field records" : "Field observations"} value={reviewed ?? insight?.observations ?? observations.length} tag="field" />
      </div>

      <dl className="mt-3 space-y-1.5 rounded-2xl bg-surface p-3 text-xs">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-grey">Category</dt>
          <dd className="text-right text-charcoal">{p.category ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-grey">Carbon project stage</dt>
          <dd className="text-right text-charcoal">{stage?.label ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-grey">Carbon credits</dt>
          <dd className="text-right text-charcoal">{stage?.evidence ?? "—"} · none verified in CGS</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-grey">Start date</dt>
          <dd className="text-right text-charcoal">{formatDate(p.start_date)}</dd>
        </div>
        {(p.last_observation || insight?.last_observation) && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-grey">Latest field record</dt>
            <dd className="text-right text-charcoal">{formatDate(p.last_observation ?? insight?.last_observation)}</dd>
          </div>
        )}
        {p.progress_percent != null && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-grey">Task progress</dt>
            <dd className="text-right text-charcoal">{p.progress_percent}%</dd>
          </div>
        )}
      </dl>

      {p.summary && <p className="mt-3 text-xs leading-relaxed text-charcoal">{p.summary}{String(p.summary).length >= 600 ? "…" : ""}</p>}

      {insight && <Alerts scope={[place]} insights={{ [place.id]: insight }} />}

      {sites.length > 0 && !site && (
        <>
          <Heading>Sites</Heading>
          <div className="mt-1">
            {sites.map((f) => (
              <button key={f.properties?.site_id} type="button" onClick={() => goProject(place.id, String(f.properties?.site_id))} className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-sand">
                <span className="truncate text-charcoal">{f.properties?.name}</span>
                <span className="shrink-0 text-xs text-muted-grey">{SITE_KINDS[f.properties?.site_kind] ?? "Site"}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {siteObservations.length > 0 && (
        <>
          <Heading>{site ? "Field observations at this site" : "Field observations"}</Heading>
          <ul className="mt-1.5 space-y-1 px-3">
            {siteObservations.slice(0, 6).map((f) => (
              <li key={f.properties?.record_id} className="flex justify-between gap-3 text-xs">
                <Link href={`/dashboard/monitoring/${f.properties?.record_id}`} className="link truncate">
                  {OBSERVATION_TYPES[f.properties?.observation_type]?.label ?? "Observation"}
                </Link>
                <span className="shrink-0 text-muted-grey">
                  {formatDate(f.properties?.observation_date)} · {f.properties?.value_basis === "estimated" ? "Estimated" : "Measured"}
                </span>
              </li>
            ))}
          </ul>
          {siteObservations.length > 6 && <p className="mt-1 px-3 text-xs text-muted-grey">and {siteObservations.length - 6} more in the project workspace.</p>}
        </>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {canOpen ? (
          <>
            <Link href={`/dashboard/projects/${place.id}?from=${encodeURIComponent(returnTo)}`} className="btn btn-primary">
              Open project workspace <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link href={`/dashboard/projects/${place.id}?tab=monitoring`} className="btn btn-secondary">Monitoring</Link>
          </>
        ) : signedIn ? (
          <p className="text-xs text-muted-grey">You are not a participant of this project, so its workspace is not open to you.</p>
        ) : (
          <Link href="/login" className="btn btn-primary">Sign in to open the workspace</Link>
        )}
      </div>
    </div>
  );
}

import type { FeatureCollection } from "geojson";
import { ActionForm } from "@/components/ActionForm";
import { MapView } from "@/components/MapView";
import { Card, DetailList, EmptyState, Field, StatusBadge } from "@/components/ui";
import {
  DEVELOPMENT_STAGES,
  SITE_KINDS,
  ESTIMATE_KINDS,
  GRIEVANCE_STATUS,
  LISTING_STATUS,
  OBSERVATION_TYPES,
  SCHEDULE_FREQUENCIES,
} from "@/lib/constants";
import { formatDate, formatDateTime, formatNumber, isOverdue } from "@/lib/format";
import { postAnnouncement, respondToGrievance, saveMeetingMinutes, scheduleMeeting, submitGrievance } from "@/modules/community/actions";
import { deleteBoundary, deleteLandCoverAnalysis, runLandCoverAnalysis, saveBoundary } from "@/modules/gis/actions";
import { LAND_COVER_CLASSES, LAND_COVER_FIRST_YEAR, LAND_COVER_SOURCE } from "@/modules/gis/landcover";
import { BOUNDARY_FILE_TYPES } from "@/modules/gis/parse-types";
import { saveListing, setDevelopmentStage, setListingStatus } from "@/modules/marketplace/actions";
import { createCarbonEstimate, createSchedule, deleteCarbonEstimate, deleteSchedule } from "@/modules/mrv/actions";
import { deleteSite, saveSite } from "@/modules/projects/actions";
import type { TabProps } from "@/modules/projects/tabs";

export interface ExtendedTabProps extends TabProps {
  /** Team role of the viewer on this project, if they are a team member. */
  memberRole: string | null;
}

const typeOptions = Object.entries(OBSERVATION_TYPES).map(([value, { label }]) => (
  <option key={value} value={value}>{label}</option>
));

/* ------------------------------------------------------------------ GIS */

export async function MapTab({ supabase, project, viewer, canManage, memberRole }: ExtendedTabProps) {
  const [{ data: features }, { data: boundary }, { data: landCover }, { data: sites }] = await Promise.all([
    supabase.rpc("gis_features", { p_project: project.id }),
    supabase.from("project_boundaries").select("area_ha, source, updated_at").eq("project_id", project.id).maybeSingle(),
    supabase.from("land_cover_analyses").select("id, year, classes, boundary_area_ha, created_at").eq("project_id", project.id).order("year"),
    supabase.from("project_sites").select("id, name, kind, description, latitude, longitude, area_ha").eq("project_id", project.id).order("name"),
  ]);
  // The owner maps the project while it is still a draft; afterwards the manager and GIS analysts do.
  const ownerDrafting = viewer.id === project.owner_id && ["draft", "revision_required"].includes(project.status);
  const canEdit = canManage || memberRole === "gis_analyst" || ownerDrafting;
  const canAnalyse = canEdit || memberRole === "mrv_specialist";
  const analyses = landCover ?? [];
  const first = analyses[0];
  const last = analyses[analyses.length - 1];
  const usedClasses = LAND_COVER_CLASSES.filter((c) => analyses.some((a) => (a.classes as Record<string, number>)[c.key] > 0));
  const thisYear = new Date().getUTCFullYear();
  const years = Array.from({ length: thisYear - LAND_COVER_FIRST_YEAR + 1 }, (_, i) => thisYear - i);
  const collection = (features ?? { type: "FeatureCollection", features: [] }) as FeatureCollection;
  const observations = collection.features.filter((f) => f.properties?.kind === "observation").length;
  const difference = boundary && project.area_ha !== null ? Number(boundary.area_ha) - Number(project.area_ha) : null;

  return (
    <div className="space-y-5">
      <Card title="Project map" actions={<a href={`/api/gis/export?project=${project.id}`} className="btn btn-secondary btn-sm">Export GeoJSON</a>}>
        <MapView features={collection} drawProjectId={canEdit ? project.id : undefined} landCoverYear={last?.year ?? (boundary ? thisYear - 1 : undefined)} />
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Land area and spatial statistics">
          <DetailList
            items={[
              ["Mapped boundary area", boundary ? `${formatNumber(boundary.area_ha, 2)} ha` : "No boundary mapped"],
              ["Declared area", project.area_ha !== null ? `${formatNumber(project.area_ha, 2)} ha` : "Not declared"],
              ["Difference (mapped − declared)", difference === null ? null : `${difference > 0 ? "+" : ""}${formatNumber(difference, 2)} ha`],
              ["Declared coordinates", project.latitude !== null && project.longitude !== null ? `${project.latitude}, ${project.longitude}` : "Not recorded"],
              ["Georeferenced observations", String(observations)],
              ["Boundary source", boundary?.source],
              ["Boundary last updated", boundary ? formatDateTime(boundary.updated_at) : null],
            ]}
          />
          <p className="mt-4 text-xs text-muted-grey">
            Mapped area is the geodesic area of the stored polygon, calculated by PostGIS. It is not a legal survey.
          </p>
          {canEdit && boundary && (
            <div className="mt-4">
              <ActionForm action={deleteBoundary} confirm="Remove the stored boundary of this project?" submitLabel="Remove boundary" submitClass="btn btn-danger btn-sm">
                <input type="hidden" name="project_id" value={project.id} />
              </ActionForm>
            </div>
          )}
        </Card>
        {canEdit && (
          <Card title="Import a boundary">
            <ActionForm action={saveBoundary} submitLabel="Import boundary" className="space-y-4">
              <input type="hidden" name="project_id" value={project.id} />
              <Field label="Boundary file" hint="GeoJSON, KML, or a zipped shapefile (.zip containing .shp, .dbf and .prj). Up to 5 MB. Importing replaces the existing boundary.">
                <input name="file" type="file" accept={BOUNDARY_FILE_TYPES} className="input" />
              </Field>
              <Field label="Or paste GeoJSON">
                <textarea name="geojson" className="input font-mono text-xs" rows={4} placeholder='{"type":"Polygon","coordinates":[[[36.8,-1.2],[36.9,-1.2],[36.9,-1.3],[36.8,-1.2]]]}' />
              </Field>
              <Field label="Source (optional)" hint="For example: GPS survey, date and surveyor.">
                <input name="source" className="input" maxLength={200} />
              </Field>
            </ActionForm>
          </Card>
        )}
      </div>

      <Card title="Project sites" pad={false}>
        {(sites ?? []).length === 0 ? (
          <EmptyState title="No sites recorded for this project.">
            Sites are named locations inside the project, such as planting blocks, monitoring points or nurseries. Field reports can be tied to a site.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Site</th>
                  <th>Type</th>
                  <th>Coordinates</th>
                  <th>Area (ha)</th>
                  {canEdit && <th />}
                </tr>
              </thead>
              <tbody>
                {(sites ?? []).map((site) => (
                  <tr key={site.id}>
                    <td>
                      {site.name}
                      {site.description && <div className="text-xs text-muted-grey">{site.description}</div>}
                    </td>
                    <td>{SITE_KINDS[site.kind] ?? site.kind}</td>
                    <td className="tabular-nums">{site.latitude}, {site.longitude}</td>
                    <td className="tabular-nums">{formatNumber(site.area_ha, 2)}</td>
                    {canEdit && (
                      <td>
                        <ActionForm action={deleteSite} confirm={`Remove the site "${site.name}"? Field reports tied to it are kept.`} submitLabel="Remove" submitClass="btn btn-danger btn-sm">
                          <input type="hidden" name="site_id" value={site.id} />
                        </ActionForm>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canEdit && (
          <div className="border-t border-subtle-border p-4 sm:p-5">
            <ActionForm action={saveSite} submitLabel="Add site" className="space-y-4">
              <input type="hidden" name="project_id" value={project.id} />
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Site name">
                  <input name="name" className="input" required minLength={2} maxLength={120} />
                </Field>
                <Field label="Type">
                  <select name="kind" className="input" defaultValue="site">
                    {Object.entries(SITE_KINDS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Area (ha, optional)">
                  <input name="area_ha" type="number" step="0.01" min="0" className="input" />
                </Field>
                <Field label="Latitude" hint="Decimal degrees">
                  <input name="latitude" type="number" step="0.000001" min="-90" max="90" className="input" required />
                </Field>
                <Field label="Longitude" hint="Decimal degrees">
                  <input name="longitude" type="number" step="0.000001" min="-180" max="180" className="input" required />
                </Field>
                <Field label="Description (optional)">
                  <input name="description" className="input" maxLength={1000} />
                </Field>
              </div>
            </ActionForm>
          </div>
        )}
      </Card>

      <Card title="Land use and land cover (satellite classification)" pad={false}>
        <div className="space-y-3 p-4 sm:p-5">
          <p className="text-sm text-muted-grey">
            Area of each land-cover class inside the mapped boundary, per year. Run two or more years to see the change.
            Source: {LAND_COVER_SOURCE}, annual maps at 10 m resolution.
          </p>
          {!boundary && <p className="alert alert-warning">Map the project boundary first. Land cover is calculated inside the boundary.</p>}
          {canAnalyse && boundary && (
            <ActionForm action={runLandCoverAnalysis} submitLabel="Calculate land cover" submitClass="btn btn-secondary" className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="project_id" value={project.id} />
              <Field label="Year">
                <select name="year" className="input" defaultValue={thisYear - 1}>
                  {years.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </Field>
            </ActionForm>
          )}
        </div>
        {analyses.length === 0 ? (
          <EmptyState title="No land-cover analysis has been run for this project." />
        ) : (
          <div className="table-wrap border-t border-subtle-border">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Land-cover class</th>
                  {analyses.map((a) => (
                    <th key={a.id}>{a.year} (ha)</th>
                  ))}
                  {analyses.length > 1 && <th>Change {first.year} to {last.year}</th>}
                </tr>
              </thead>
              <tbody>
                {usedClasses.map((c) => {
                  const value = (a: (typeof analyses)[number]) => Number((a.classes as Record<string, number>)[c.key] ?? 0);
                  const change = value(last) - value(first);
                  return (
                    <tr key={c.key}>
                      <td>
                        <span className="mr-2 inline-block h-3 w-3 border border-subtle-border align-middle" style={{ background: c.color }} />
                        {c.label}
                      </td>
                      {analyses.map((a) => (
                        <td key={a.id} className="tabular-nums">
                          {formatNumber(value(a), 2)}
                          <span className="ml-1 text-xs text-muted-grey">({formatNumber((100 * value(a)) / Number(a.boundary_area_ha), 0)}%)</span>
                        </td>
                      ))}
                      {analyses.length > 1 && (
                        <td className="tabular-nums">{change === 0 ? "No change" : `${change > 0 ? "+" : "−"}${formatNumber(Math.abs(change), 2)} ha`}</td>
                      )}
                    </tr>
                  );
                })}
                {canEdit && (
                  <tr>
                    <td className="text-xs text-muted-grey">Remove a year</td>
                    {analyses.map((a) => (
                      <td key={a.id}>
                        <ActionForm action={deleteLandCoverAnalysis} confirm={`Remove the ${a.year} result?`} submitLabel="Remove" submitClass="btn btn-danger btn-sm">
                          <input type="hidden" name="analysis_id" value={a.id} />
                        </ActionForm>
                      </td>
                    ))}
                    {analyses.length > 1 && <td />}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-subtle-border px-4 py-3 text-xs text-muted-grey sm:px-5">
          This is a third-party, model-based classification of satellite imagery. It has not been checked on the ground by CGS,
          small parcels are affected by the 10 m pixel size, and year-to-year differences can reflect classification noise as
          well as real change. It is supporting information, not a measurement of carbon stock and not verification.
        </p>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ MRV */
// (land-cover card is rendered by MapTab above)

export async function MrvTab({ supabase, project, canManage, memberRole }: ExtendedTabProps) {
  const [{ data: estimates }, { data: schedules }, { data: records }] = await Promise.all([
    supabase.from("carbon_estimates").select("*, author:profiles!carbon_estimates_created_by_fkey(full_name)").eq("project_id", project.id).order("created_at", { ascending: false }),
    supabase.from("monitoring_schedules").select("*").eq("project_id", project.id).order("next_due"),
    supabase
      .from("monitoring_records")
      .select("id, observation_type, observation_date, measurements, value_basis, review_status, latitude, methodology")
      .eq("project_id", project.id)
      .order("observation_date"),
  ]);
  const canEdit = canManage || memberRole === "mrv_specialist";
  const all = records ?? [];
  const approved = all.filter((r) => r.review_status === "approved");
  // Measurement history: numeric values of approved records, oldest first, for comparison over time.
  const history = approved.flatMap((r) =>
    (OBSERVATION_TYPES[r.observation_type]?.fields ?? [])
      .filter((f) => f.type === "number" && r.measurements?.[f.key] !== undefined)
      .map((f) => ({ id: `${r.id}-${f.key}`, date: r.observation_date, type: OBSERVATION_TYPES[r.observation_type].label, label: f.label, value: r.measurements[f.key] as number, unit: f.unit ?? "", basis: r.value_basis })),
  );

  return (
    <div className="space-y-5">
      <p className="alert alert-info">
        Everything on this tab is project-level monitoring and estimation. Estimates are not verified emission reductions,
        and review in the portal is not independent validation or verification.
      </p>

      <Card title="Data quality checks">
        <DetailList
          items={[
            ["Field reports", String(all.length)],
            ["Reviewed and approved", String(approved.length)],
            ["Awaiting review or correction", String(all.length - approved.length)],
            ["Without GPS coordinates", String(all.filter((r) => r.latitude === null).length)],
            ["Based on estimates, not measurement", String(all.filter((r) => r.value_basis === "estimated").length)],
            ["Without a stated method", String(all.filter((r) => !r.methodology).length)],
          ]}
        />
      </Card>

      <Card title="Carbon estimation records" pad={false}>
        {(estimates ?? []).length === 0 ? (
          <EmptyState title="No carbon estimates have been recorded." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Period</th>
                  <th>Estimate (tCO₂e)</th>
                  <th>Method and assumptions</th>
                  <th>Recorded</th>
                  {canEdit && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {(estimates ?? []).map((e) => (
                  <tr key={e.id}>
                    <td>{ESTIMATE_KINDS[e.kind]}</td>
                    <td>{e.period_start || e.period_end ? `${formatDate(e.period_start)} to ${formatDate(e.period_end)}` : "—"}</td>
                    <td className="tabular-nums">
                      {formatNumber(e.estimated_tco2e, 2)}
                      <div className="text-xs text-muted-grey">Estimate, not verified</div>
                    </td>
                    <td className="max-w-sm text-xs">
                      {e.methodology}
                      {e.assumptions && <div className="mt-1 text-muted-grey">Assumptions: {e.assumptions}</div>}
                    </td>
                    <td className="text-xs text-muted-grey">
                      {e.author?.full_name ?? "—"}
                      <div>{formatDate(e.created_at)}</div>
                    </td>
                    {canEdit && (
                      <td>
                        <ActionForm action={deleteCarbonEstimate} confirm="Delete this estimate?" submitLabel="Delete" submitClass="btn btn-danger btn-sm">
                          <input type="hidden" name="estimate_id" value={e.id} />
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

      {canEdit && (
        <Card title="Record a carbon estimate">
          <ActionForm action={createCarbonEstimate} submitLabel="Record estimate" className="space-y-4">
            <input type="hidden" name="project_id" value={project.id} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Type">
                <select name="kind" className="input" defaultValue="potential">
                  {Object.entries(ESTIMATE_KINDS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Estimate (tCO₂e)">
                <input name="estimated_tco2e" type="number" step="0.01" min="0" required className="input" />
              </Field>
              <Field label="Period start (optional)">
                <input name="period_start" type="date" className="input" />
              </Field>
              <Field label="Period end (optional)">
                <input name="period_end" type="date" className="input" />
              </Field>
            </div>
            <Field label="Methodology" hint="Required: how the figure was derived (standard or tool, emission factors, sample data).">
              <textarea name="methodology" className="input" rows={2} required minLength={10} maxLength={2000} />
            </Field>
            <Field label="Assumptions (optional)">
              <textarea name="assumptions" className="input" rows={2} maxLength={4000} />
            </Field>
          </ActionForm>
        </Card>
      )}

      <Card title="Monitoring schedule" pad={false}>
        {(schedules ?? []).length === 0 ? (
          <EmptyState title="No monitoring schedule has been set." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Observation type</th>
                  <th>Frequency</th>
                  <th>Next due</th>
                  <th>Notes</th>
                  {canEdit && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {(schedules ?? []).map((s) => (
                  <tr key={s.id}>
                    <td>{OBSERVATION_TYPES[s.observation_type]?.label}</td>
                    <td>{SCHEDULE_FREQUENCIES[s.frequency]}</td>
                    <td className={isOverdue(s.next_due, false) ? "font-medium text-red-300" : ""}>
                      {formatDate(s.next_due)}
                      {isOverdue(s.next_due, false) && <span className="block text-xs">Overdue</span>}
                    </td>
                    <td className="max-w-xs text-xs text-muted-grey">{s.notes ?? "—"}</td>
                    {canEdit && (
                      <td>
                        <ActionForm action={deleteSchedule} confirm="Remove this schedule entry?" submitLabel="Remove" submitClass="btn btn-danger btn-sm">
                          <input type="hidden" name="schedule_id" value={s.id} />
                        </ActionForm>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canEdit && (
          <div className="border-t border-subtle-border p-4 sm:p-5">
            <ActionForm action={createSchedule} submitLabel="Add to schedule" submitClass="btn btn-secondary" className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <input type="hidden" name="project_id" value={project.id} />
              <Field label="Observation type">
                <select name="observation_type" className="input">{typeOptions}</select>
              </Field>
              <Field label="Frequency">
                <select name="frequency" className="input" defaultValue="quarterly">
                  {Object.entries(SCHEDULE_FREQUENCIES).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Next due">
                <input name="next_due" type="date" required className="input" />
              </Field>
              <Field label="Notes (optional)">
                <input name="notes" className="input" maxLength={1000} />
              </Field>
            </ActionForm>
          </div>
        )}
      </Card>

      <Card title="Measurement history (approved field reports)" pad={false}>
        {history.length === 0 ? (
          <EmptyState title="No approved numeric measurements yet." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Observation</th>
                  <th>Measurement</th>
                  <th>Value</th>
                  <th>Basis</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{formatDate(h.date)}</td>
                    <td>{h.type}</td>
                    <td>{h.label}</td>
                    <td className="tabular-nums">{formatNumber(h.value, 2)} {h.unit}</td>
                    <td className="capitalize">{h.basis}</td>
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

/* ------------------------------------------------------------ Community */

export async function CommunityTab({ supabase, project, canManage, viewer }: ExtendedTabProps) {
  const [{ data: announcements }, { data: meetings }, { data: grievances }] = await Promise.all([
    supabase.from("project_announcements").select("id, title, body, created_at").eq("project_id", project.id).order("created_at", { ascending: false }),
    supabase.from("project_meetings").select("id, title, scheduled_at, location, agenda, minutes").eq("project_id", project.id).order("scheduled_at", { ascending: false }),
    supabase
      .from("grievances")
      .select("id, kind, subject, description, status, response, created_at, submitted_by, sender:profiles!grievances_submitted_by_fkey(full_name)")
      .eq("project_id", project.id)
      .order("created_at", { ascending: false }),
  ]);
  const now = new Date().toISOString();

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-5">
        <Card title="Announcements">
          {(announcements ?? []).length === 0 ? (
            <p className="text-sm text-muted-grey">No announcements have been posted.</p>
          ) : (
            <ul className="space-y-4">
              {(announcements ?? []).map((a) => (
                <li key={a.id}>
                  <p className="text-sm font-semibold text-heading">{a.title}</p>
                  <p className="text-xs text-muted-grey">{formatDateTime(a.created_at)}</p>
                  <p className="prose-block mt-1">{a.body}</p>
                </li>
              ))}
            </ul>
          )}
          {canManage && (
            <ActionForm action={postAnnouncement} submitLabel="Post announcement" className="mt-5 space-y-3 border-t border-subtle-border pt-4">
              <input type="hidden" name="project_id" value={project.id} />
              <Field label="Title">
                <input name="title" className="input" required minLength={3} maxLength={160} />
              </Field>
              <Field label="Message" hint="Sent as a notification to every participant of this project.">
                <textarea name="body" className="input" rows={3} required minLength={5} maxLength={4000} />
              </Field>
            </ActionForm>
          )}
        </Card>

        <Card title="Meetings">
          {(meetings ?? []).length === 0 ? (
            <p className="text-sm text-muted-grey">No meetings have been scheduled.</p>
          ) : (
            <ul className="space-y-4">
              {(meetings ?? []).map((m) => (
                <li key={m.id} className="rounded-md border border-subtle-border p-3">
                  <p className="text-sm font-semibold text-heading">{m.title}</p>
                  <p className="text-xs text-muted-grey">
                    {formatDateTime(m.scheduled_at)} (EAT){m.location ? ` · ${m.location}` : ""} · {m.scheduled_at > now ? "Upcoming" : "Held"}
                  </p>
                  {m.agenda && <p className="prose-block mt-2"><span className="font-medium">Agenda: </span>{m.agenda}</p>}
                  {m.minutes && <p className="prose-block mt-2"><span className="font-medium">Record: </span>{m.minutes}</p>}
                  {canManage && (
                    <ActionForm action={saveMeetingMinutes} submitLabel="Save meeting record" submitClass="btn btn-secondary btn-sm" className="mt-3 space-y-2" resetOnSuccess={false}>
                      <input type="hidden" name="meeting_id" value={m.id} />
                      <textarea name="minutes" className="input text-xs" rows={2} maxLength={8000} defaultValue={m.minutes ?? ""} placeholder="Attendance, decisions and consultation record" aria-label="Meeting record" />
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canManage && (
            <ActionForm action={scheduleMeeting} submitLabel="Schedule meeting" className="mt-5 space-y-3 border-t border-subtle-border pt-4">
              <input type="hidden" name="project_id" value={project.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Title">
                  <input name="title" className="input" required minLength={3} maxLength={160} />
                </Field>
                <Field label="Date and time (EAT)">
                  <input name="scheduled_at" type="datetime-local" className="input" required />
                </Field>
              </div>
              <Field label="Location (optional)">
                <input name="location" className="input" maxLength={300} />
              </Field>
              <Field label="Agenda (optional)">
                <textarea name="agenda" className="input" rows={2} maxLength={4000} />
              </Field>
            </ActionForm>
          )}
        </Card>
      </div>

      <div className="space-y-5">
        <Card title={canManage ? "Feedback and grievances" : "My feedback and grievances"}>
          <p className="mb-4 text-xs text-muted-grey">
            A submission is visible only to the person who sent it, the project manager and CGS administrators.
          </p>
          {(grievances ?? []).length === 0 ? (
            <p className="text-sm text-muted-grey">Nothing has been submitted.</p>
          ) : (
            <ul className="space-y-4">
              {(grievances ?? []).map((g) => (
                <li key={g.id} className="rounded-md border border-subtle-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-heading">{g.subject}</p>
                    <StatusBadge map={GRIEVANCE_STATUS} value={g.status} />
                  </div>
                  <p className="text-xs capitalize text-muted-grey">
                    {g.kind} · {g.submitted_by === viewer.id ? "You" : ((g.sender as unknown as { full_name: string } | null)?.full_name ?? "Participant")} · {formatDateTime(g.created_at)}
                  </p>
                  <p className="prose-block mt-2">{g.description}</p>
                  {g.response && <p className="prose-block mt-2"><span className="font-medium">Response: </span>{g.response}</p>}
                  {canManage && (
                    <ActionForm action={respondToGrievance} submitLabel="Save response" submitClass="btn btn-secondary btn-sm" className="mt-3 space-y-2" resetOnSuccess={false}>
                      <input type="hidden" name="grievance_id" value={g.id} />
                      <textarea name="response" className="input text-xs" rows={2} maxLength={4000} defaultValue={g.response ?? ""} placeholder="Response to the sender" aria-label="Response" />
                      <select name="status" className="input w-auto py-1 text-xs" defaultValue={g.status} aria-label="Status">
                        {Object.entries(GRIEVANCE_STATUS).map(([value, { label }]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Send feedback or raise a grievance">
          <ActionForm action={submitGrievance} submitLabel="Submit" className="space-y-3">
            <input type="hidden" name="project_id" value={project.id} />
            <Field label="Type">
              <select name="kind" className="input" defaultValue="feedback">
                <option value="feedback">Feedback</option>
                <option value="grievance">Grievance</option>
              </select>
            </Field>
            <Field label="Subject">
              <input name="subject" className="input" required minLength={3} maxLength={160} />
            </Field>
            <Field label="Details">
              <textarea name="description" className="input" rows={4} required minLength={10} maxLength={4000} />
            </Field>
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- Marketplace */

export async function MarketplaceTab({ supabase, project, viewer, canManage, memberRole }: ExtendedTabProps) {
  const [{ data: listing }, { data: documents }, { count: interestCount }] = await Promise.all([
    supabase.from("marketplace_listings").select("*").eq("project_id", project.id).maybeSingle(),
    supabase.from("documents").select("id, title").eq("project_id", project.id).eq("review_status", "approved").is("monitoring_record_id", null).order("title"),
    supabase.from("marketplace_interests").select("id", { count: "exact", head: true }).eq("project_id", project.id),
  ]);
  const isAdmin = viewer.role === "super_admin";
  const isOwner = project.owner_id === viewer.id;
  const canEditText = isAdmin || isOwner;
  const canSetStage = isAdmin || memberRole === "mrv_specialist";
  const listable = ["approved", "active", "on_hold", "completed"].includes(project.status);

  const moves: { status: string; label: string; primary?: boolean }[] = [];
  if (listing) {
    if ((isOwner || canManage) && ["draft", "withdrawn"].includes(listing.status)) moves.push({ status: "pending_review", label: "Submit for CGS review", primary: true });
    if ((isOwner || canManage) && ["pending_review", "published"].includes(listing.status)) moves.push({ status: "withdrawn", label: "Withdraw listing" });
    if (isAdmin && listing.status !== "published") moves.push({ status: "published", label: "Publish to marketplace", primary: listing.status === "pending_review" });
    if (isAdmin && listing.status === "pending_review") moves.push({ status: "draft", label: "Return to draft" });
  }

  return (
    <div className="space-y-5">
      <p className="alert alert-info">
        A published listing lets approved investors and project developers discover this project and send an enquiry.
        They see the summary, category, county, areas, development stage and the latest carbon potential estimate — not
        the owner&apos;s identity, exact coordinates or documents. The portal does not trade carbon credits or process payments.
      </p>
      {!listable && <p className="alert alert-warning">Only approved projects can be listed on the marketplace.</p>}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Listing">
          {listing ? (
            <DetailList
              items={[
                ["Status", <StatusBadge key="s" map={LISTING_STATUS} value={listing.status} />],
                ["Development stage", <StatusBadge key="d" map={DEVELOPMENT_STAGES} value={listing.development_stage} />],
                ["Standard", listing.standard],
                ["Published", formatDateTime(listing.published_at)],
                ["Enquiries received", String(interestCount ?? 0)],
              ]}
            />
          ) : (
            <p className="text-sm text-muted-grey">This project has no marketplace listing yet.</p>
          )}
          {moves.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-subtle-border pt-4">
              {moves.map((move) => (
                <ActionForm key={move.status} action={setListingStatus} submitLabel={move.label} submitClass={`btn ${move.primary ? "btn-primary" : "btn-secondary"}`}>
                  <input type="hidden" name="project_id" value={project.id} />
                  <input type="hidden" name="status" value={move.status} />
                </ActionForm>
              ))}
            </div>
          )}
        </Card>

        {canEditText && listable && (
          <Card title={listing ? "Edit listing text" : "Create a listing"}>
            <ActionForm action={saveListing} submitLabel="Save listing" className="space-y-4" resetOnSuccess={false}>
              <input type="hidden" name="project_id" value={project.id} />
              <Field label="Summary for investors and developers" hint="20 to 2,000 characters. Do not include personal contact details.">
                <textarea name="summary" className="input" rows={5} required minLength={20} maxLength={2000} defaultValue={listing?.summary ?? ""} />
              </Field>
              <Field label="Eligibility information (optional)" hint="Land tenure status, community consent, applicable methodology, known constraints.">
                <textarea name="eligibility_notes" className="input" rows={3} maxLength={2000} defaultValue={listing?.eligibility_notes ?? ""} />
              </Field>
            </ActionForm>
            {listing?.status === "published" && !isAdmin && (
              <p className="hint">Changing the text of a published listing sends it back for CGS review.</p>
            )}
          </Card>
        )}
      </div>

      {listing && canSetStage && (
        <Card title="Development stage">
          <ActionForm action={setDevelopmentStage} submitLabel="Update stage" submitClass="btn btn-secondary" className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-4" resetOnSuccess={false}>
            <input type="hidden" name="project_id" value={project.id} />
            <Field label="Stage">
              <select name="development_stage" className="input" defaultValue={listing.development_stage}>
                {Object.entries(DEVELOPMENT_STAGES).map(([value, { label }]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </Field>
            <Field label="Standard">
              <input name="standard" className="input" maxLength={120} defaultValue={listing.standard ?? ""} placeholder="e.g. Verra VCS, Gold Standard" />
            </Field>
            <Field label="Supporting evidence (approved document)">
              <select name="stage_evidence_document_id" className="input" defaultValue={listing.stage_evidence_document_id ?? ""}>
                <option value="">None</option>
                {(documents ?? []).map((d) => (
                  <option key={d.id} value={d.id}>{d.title}</option>
                ))}
              </select>
            </Field>
          </ActionForm>
          <p className="hint">
            A project can only be shown as validated, verified or issued when a standard is named and an approved document from the
            validation or verification body is attached. Upload that document on the Documents tab first.
          </p>
        </Card>
      )}
    </div>
  );
}

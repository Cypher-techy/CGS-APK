import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { Card, DetailList, EmptyState, Field, PageHeader, ProgressBar, StatusBadge } from "@/components/ui";
import { requireActive } from "@/lib/auth";
import { Globe2 } from "lucide-react";
import { LIFECYCLE_STAGES, PROJECT_STATUS, STAFF_MEMBER_ROLES } from "@/lib/constants";
import { encodePath, type GeoPath } from "@/modules/geo/geo-utils";
import { COUNTRIES } from "@/modules/geo/places";
import { formatDate, formatDateTime, formatNumber, humanize } from "@/lib/format";
import type { Project } from "@/lib/types";
import { addComment, assignManager, changeProjectStatus, deleteProject, setLifecycleStage, setProjectVisibility, submitProject } from "@/modules/projects/actions";
import { ReviewForm } from "@/modules/projects/ReviewForm";
import { ActivityTab, DocumentsTab, MilestonesTab, MonitoringTab, TasksTab, TeamTab, type TabProps } from "@/modules/projects/tabs";
import { FinanceTab } from "@/modules/finance/FinanceTab";
import { CommunityTab, MapTab, MarketplaceTab, MrvTab } from "@/modules/projects/tabs-extended";

const TABS = ["overview", "tasks", "milestones", "documents", "monitoring", "map", "mrv", "community", "finance", "marketplace", "team", "activity"] as const;
/** Sections open to community members and observers; everything else is for the working team. */
const PARTICIPANT_TABS: readonly string[] = ["overview", "milestones", "documents", "monitoring", "map", "community", "finance"];
const TAB_LABELS: Record<string, string> = { mrv: "MRV", map: "Map", finance: "Finance and benefits" };
type Tab = (typeof TABS)[number];
type ProjectDetail = Project & {
  category: { name: string } | null;
  organization: { name: string; is_verified: boolean } | null;
  owner: { full_name: string } | null;
  manager: { full_name: string } | null;
};

/** Status changes a manager or administrator may make directly (approval decisions go through review). */
const TRANSITIONS: Record<string, { status: string; label: string }[]> = {
  approved: [{ status: "active", label: "Start project" }],
  active: [
    { status: "on_hold", label: "Put on hold" },
    { status: "completed", label: "Mark completed" },
  ],
  on_hold: [{ status: "active", label: "Resume project" }],
  completed: [{ status: "active", label: "Reopen project" }],
};

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; from?: string; notice?: string }>;
}) {
  const { id } = await params;
  const { tab: requested, from, notice } = await searchParams;
  let tab: Tab = TABS.includes(requested as Tab) ? (requested as Tab) : "overview";
  const { supabase, profile } = await requireActive();

  const { data } = await supabase
    .from("projects")
    .select("*, category:project_categories(name), organization:organizations(name, is_verified), owner:profiles!projects_owner_id_fkey(full_name), manager:profiles!projects_manager_id_fkey(full_name)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const project = data as ProjectDetail;

  // Geographic context: Earth / continent / country / county / project. Each step opens the Earth at that level.
  const place = COUNTRIES.find((c) => c.name.toLowerCase() === project.country.toLowerCase());
  const geo: GeoPath = { continent: place?.continent ?? null, country: place?.iso2 ?? null, county: project.county, project: project.id, site: null };
  // Only a same-site Earth page is accepted as the way back, never an external address.
  const back = from && /^\/(explore|dashboard\/(gis|command))(\?|$)/.test(from) ? from : `/dashboard/gis?at=${encodePath(geo)}`;
  const earth = (path: GeoPath) => `${back.split("?")[0]}?at=${encodePath(path)}`;
  const trail: [string, string][] = [["Earth", earth({ ...geo, continent: null, country: null, county: null, project: null })]];
  if (geo.continent) trail.push([geo.continent, earth({ ...geo, country: null, county: null, project: null })]);
  if (geo.country) trail.push([project.country, earth({ ...geo, county: null, project: null })]);
  if (geo.country) trail.push([geo.country === "KE" ? `${project.county} County` : project.county, earth({ ...geo, project: null })]);

  const isAdmin = profile.role === "super_admin";
  const isOwner = project.owner_id === profile.id;
  const canManage = isAdmin || (profile.role === "project_manager" && project.manager_id === profile.id);
  const ownerEditable = isOwner && ["draft", "revision_required"].includes(project.status);
  const { data: membership } = await supabase.from("project_members").select("member_role").eq("project_id", id).eq("user_id", profile.id).maybeSingle();
  const memberRole: string | null = membership?.member_role ?? null;
  const isStaff = canManage || isOwner || (memberRole !== null && STAFF_MEMBER_ROLES.includes(memberRole));
  const tabs = TABS.filter((name) => isStaff || PARTICIPANT_TABS.includes(name));
  if (!tabs.includes(tab)) tab = "overview";
  const tabProps: TabProps = { supabase, project, viewer: profile, canManage };
  const extendedProps = { ...tabProps, memberRole };

  return (
    <>
      <PageHeader
        title={project.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{project.code}</span>
            <StatusBadge map={PROJECT_STATUS} value={project.status} />
            <ProgressBar value={project.progress_percent} />
          </span>
        }
        crumbs={[{ label: "Projects", href: "/dashboard/projects" }, { label: project.code }]}
        actions={(ownerEditable || canManage) && <Link href={`/dashboard/projects/${id}/edit`} className="btn btn-secondary">Edit details</Link>}
      />

      <nav aria-label="Geographic location" className="mb-4 flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-2xl border border-subtle-border bg-cream px-3 py-2 text-xs">
        <Globe2 className="h-4 w-4 text-primary-green" aria-hidden="true" />
        {trail.map(([label, href]) => (
          <span key={href} className="flex items-center gap-1.5">
            <Link href={href} className="text-muted-grey hover:text-primary-green">{label}</Link>
            <span aria-hidden="true" className="text-sage">/</span>
          </span>
        ))}
        <span className="font-semibold text-heading">{project.name}</span>
        <Link href={back} className="btn btn-secondary btn-sm ml-auto">
          <Globe2 className="h-3.5 w-3.5" aria-hidden="true" /> View on the Earth
        </Link>
      </nav>
      {notice === "boundary" && (
        <p className="alert alert-warning mb-4" role="status">
          The project was saved, but its boundary could not be stored. Draw or import it again below.
        </p>
      )}

      <nav aria-label="Project sections" className="mb-5 flex gap-1 overflow-x-auto border-b border-subtle-border">
        {tabs.map((name) => (
          <Link
            key={name}
            href={name === "overview" ? `/dashboard/projects/${id}` : `/dashboard/projects/${id}?tab=${name}`}
            aria-current={tab === name ? "page" : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
              tab === name ? "border-primary-green font-medium text-heading" : "border-transparent text-muted-grey hover:text-charcoal"
            }`}
          >
            {TAB_LABELS[name] ?? humanize(name)}
          </Link>
        ))}
      </nav>

      {tab === "overview" && <Overview {...tabProps} project={project} isAdmin={isAdmin} ownerEditable={ownerEditable} isStaff={isStaff} />}
      {tab === "map" && <MapTab {...extendedProps} />}
      {tab === "mrv" && <MrvTab {...extendedProps} />}
      {tab === "community" && <CommunityTab {...extendedProps} />}
      {tab === "marketplace" && <MarketplaceTab {...extendedProps} />}
      {tab === "finance" && <FinanceTab {...extendedProps} />}
      {tab === "tasks" && <TasksTab {...tabProps} />}
      {tab === "milestones" && <MilestonesTab {...tabProps} />}
      {tab === "documents" && <DocumentsTab {...tabProps} canUpload={isStaff} />}
      {tab === "monitoring" && <MonitoringTab {...tabProps} />}
      {tab === "team" && <TeamTab {...tabProps} />}
      {tab === "activity" && <ActivityTab {...tabProps} />}
    </>
  );
}

async function Overview({
  supabase,
  project,
  canManage,
  isAdmin,
  ownerEditable,
  isStaff,
}: TabProps & {
  isStaff: boolean;
  project: ProjectDetail;
  isAdmin: boolean;
  ownerEditable: boolean;
}) {
  const [{ data: approvals }, { data: comments }, { data: managers }] = await Promise.all([
    supabase.from("approvals").select("id, decision, comments, created_at").eq("project_id", project.id).order("created_at", { ascending: false }),
    isStaff
      ? supabase
          .from("project_comments")
          .select("id, body, created_at, author:profiles!project_comments_author_id_fkey(full_name)")
          .eq("project_id", project.id)
          .is("task_id", null)
          .order("created_at")
      : Promise.resolve({ data: [] }),
    isAdmin
      ? supabase.from("profiles").select("id, full_name").eq("role", "project_manager").eq("status", "active").order("full_name")
      : Promise.resolve({ data: [] }),
  ]);
  const transitions = canManage ? (TRANSITIONS[project.status] ?? []) : [];
  const coordinates = project.latitude !== null && project.longitude !== null ? `${project.latitude}, ${project.longitude}` : null;

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <Card title="Project overview">
          <DetailList
            items={[
              ["Category", project.category?.name],
              ["Organization", project.organization ? `${project.organization.name}${project.organization.is_verified ? " (verified by CGS)" : " (not yet verified)"}` : "None"],
              ["Carbon project stage", `${LIFECYCLE_STAGES[project.lifecycle_stage]?.label ?? project.lifecycle_stage} · credits: ${(LIFECYCLE_STAGES[project.lifecycle_stage]?.evidence ?? "").toLowerCase()}, none verified in CGS`],
              ["Project owner", project.owner?.full_name],
              ["Project manager", project.manager?.full_name ?? "Not assigned"],
              ["Country", project.country],
              ["County", project.sub_county ? `${project.county} · ${project.sub_county}` : project.county],
              ["Location", project.location_description],
              ["GPS coordinates", coordinates],
              ["Declared land area", project.area_ha !== null ? `${formatNumber(project.area_ha, 2)} ha` : null],
              ["Start date", formatDate(project.start_date)],
              ["Expected completion", formatDate(project.expected_end_date)],
              ["Submitted", formatDateTime(project.submitted_at)],
              ["Progress", `${project.progress_percent}% of tasks completed`],
              ["Last updated", formatDateTime(project.updated_at)],
            ]}
          />
          <h3 className="section-title mt-6">Description</h3>
          <p className="prose-block mt-1">{project.description}</p>
          {project.objectives && (
            <>
              <h3 className="section-title mt-5">Objectives</h3>
              <p className="prose-block mt-1">{project.objectives}</p>
            </>
          )}
        </Card>

        {isStaff && <Card title="Project discussion">
          {(comments ?? []).length === 0 ? (
            <p className="text-sm text-muted-grey">No comments yet.</p>
          ) : (
            <ul className="space-y-3">
              {((comments ?? []) as any[]).map((c) => (
                <li key={c.id} className="rounded-md border border-subtle-border p-3">
                  <p className="text-xs text-muted-grey">
                    {c.author?.full_name ?? "Former user"} · {formatDateTime(c.created_at)}
                  </p>
                  <p className="prose-block mt-1">{c.body}</p>
                </li>
              ))}
            </ul>
          )}
          <ActionForm action={addComment} submitLabel="Post comment" className="mt-4 space-y-3">
            <input type="hidden" name="project_id" value={project.id} />
            <Field label="Add a comment">
              <textarea name="body" className="input" rows={2} required maxLength={2000} />
            </Field>
          </ActionForm>
        </Card>}
      </div>

      <div className="space-y-5">
        {ownerEditable && (
          <Card title={project.status === "draft" ? "Draft project" : "Revision required"}>
            <p className="text-sm text-muted-grey">
              {project.status === "draft"
                ? "This project has not been submitted. Upload supporting documents on the Documents tab, then submit it for review."
                : "CGS has asked for changes. See the review comments below, edit the project and submit it again."}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <ActionForm action={submitProject} submitLabel="Submit for approval">
                <input type="hidden" name="project_id" value={project.id} />
              </ActionForm>
              {project.status === "draft" && (
                <ActionForm action={deleteProject} confirm="Delete this draft project? This cannot be undone." submitLabel="Delete draft" submitClass="btn btn-danger">
                  <input type="hidden" name="project_id" value={project.id} />
                </ActionForm>
              )}
            </div>
          </Card>
        )}

        {canManage && (
          <Card title="Public Explore map">
            <p className="text-sm text-muted-grey">
              {project.is_public
                ? "This project is public. Its name, category, location, boundary, sites and area are visible to everyone on the Explore map."
                : "This project is private. Publishing shows its name, category, location, boundary, sites and area to everyone. Owner identity, documents and field records stay private."}
            </p>
            {["approved", "active", "on_hold", "completed"].includes(project.status) ? (
              <ActionForm
                action={setProjectVisibility}
                submitLabel={project.is_public ? "Remove from Explore" : "Publish to Explore"}
                submitClass={project.is_public ? "btn btn-secondary" : "btn btn-primary"}
                confirm={project.is_public ? undefined : "Show this project on the public Explore map?"}
                className="mt-3"
              >
                <input type="hidden" name="project_id" value={project.id} />
                <input type="hidden" name="is_public" value={project.is_public ? "false" : "true"} />
              </ActionForm>
            ) : (
              <p className="mt-2 text-xs text-muted-grey">Only an approved project can be published.</p>
            )}
          </Card>
        )}

        {canManage && (
          <Card title="Carbon project stage">
            <ActionForm action={setLifecycleStage} submitLabel="Update stage" submitClass="btn btn-secondary" className="space-y-3" resetOnSuccess={false}>
              <input type="hidden" name="project_id" value={project.id} />
              <select name="lifecycle_stage" className="input" defaultValue={project.lifecycle_stage} aria-label="Carbon project stage">
                {Object.entries(LIFECYCLE_STAGES).map(([key, stage], i) => (
                  <option key={key} value={key}>{i + 1}. {stage.label}</option>
                ))}
              </select>
            </ActionForm>
            <p className="mt-3 text-xs text-muted-grey">
              A stage records the work in progress. It does not create or verify credits; carbon figures remain estimates unless verification evidence is on file.
            </p>
          </Card>
        )}

        {isAdmin && project.status === "pending_approval" && (
          <Card title="Review submission">
            <ReviewForm projectId={project.id} managers={managers ?? []} currentManagerId={project.manager_id} />
          </Card>
        )}

        {transitions.length > 0 && (
          <Card title="Project status">
            <div className="flex flex-wrap gap-2">
              {transitions.map((t) => (
                <ActionForm key={t.status} action={changeProjectStatus} submitLabel={t.label} submitClass="btn btn-secondary">
                  <input type="hidden" name="project_id" value={project.id} />
                  <input type="hidden" name="status" value={t.status} />
                </ActionForm>
              ))}
            </div>
          </Card>
        )}

        {isAdmin && project.status !== "pending_approval" && (
          <Card title="Project manager">
            <ActionForm action={assignManager} submitLabel="Assign manager" submitClass="btn btn-secondary" className="space-y-3" resetOnSuccess={false}>
              <input type="hidden" name="project_id" value={project.id} />
              <select name="manager_id" className="input" required defaultValue={project.manager_id ?? ""} aria-label="Project manager">
                <option value="" disabled>Select a manager</option>
                {(managers ?? []).map((m) => (
                  <option key={m.id} value={m.id}>{m.full_name}</option>
                ))}
              </select>
            </ActionForm>
          </Card>
        )}

        <Card title="Approval history" pad={false}>
          {(approvals ?? []).length === 0 ? (
            <EmptyState title="No review decisions yet." />
          ) : (
            <ul className="divide-y divide-subtle-border">
              {(approvals ?? []).map((a) => (
                <li key={a.id} className="px-4 py-3 text-sm sm:px-5">
                  <p className="font-medium">{humanize(a.decision)}</p>
                  <p className="text-xs text-muted-grey">CGS administrator · {formatDateTime(a.created_at)}</p>
                  {a.comments && <p className="prose-block mt-1">{a.comments}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

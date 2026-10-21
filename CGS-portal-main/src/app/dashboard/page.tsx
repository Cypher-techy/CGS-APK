import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { CountBarChart } from "@/components/CountBarChart";
import { ActivityList, ACTIVITY_COLUMNS, MONITORING_LIST_COLUMNS, MonitoringTable, PROJECT_LIST_COLUMNS, ProjectTable, TASK_LIST_COLUMNS, TaskTable } from "@/components/lists";
import { Card, PageHeader, StatCard, StatGrid } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { ACCOUNT_STATUS, PROJECT_STATUS, ROLE_LABELS, TASK_STATUS } from "@/lib/constants";
import { today } from "@/lib/format";
import type { Supabase } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import { acceptTerms } from "@/modules/auth/actions";
import { countBy, countOverdueTasks, sum } from "@/modules/dashboard/queries";
import { CommunityDashboard, GisDashboard, InvestorDashboard, MrvDashboard } from "@/modules/dashboard/role-dashboards";
import { WorkspaceEarth } from "@/modules/geo/WorkspaceEarth";

const PROJECT_STATUSES = Object.keys(PROJECT_STATUS);
const TASK_STATUSES = Object.keys(TASK_STATUS);
const chartData = (map: Record<string, { label: string }>, counts: Record<string, number>) =>
  Object.keys(map).map((key) => ({ label: map[key].label, value: counts[key] ?? 0 }));

export default async function DashboardPage() {
  const { supabase, profile } = await requireSession();

  if (!profile.terms_accepted_at) return <TermsGate profile={profile} />;
  if (profile.status !== "active") return <AccountNotice profile={profile} />;

  switch (profile.role) {
    case "super_admin":
      return <AdminDashboard supabase={supabase} />;
    case "project_manager":
      return <ManagerDashboard supabase={supabase} />;
    case "project_owner":
      return <OwnerDashboard supabase={supabase} />;
    case "field_officer":
      return <FieldOfficerDashboard supabase={supabase} profile={profile} />;
    case "gis_analyst":
      return <GisDashboard supabase={supabase} />;
    case "mrv_specialist":
      return <MrvDashboard supabase={supabase} />;
    case "investor":
      return <InvestorDashboard supabase={supabase} profile={profile} />;
    case "community_member":
      return <CommunityDashboard supabase={supabase} profile={profile} />;
  }
}

/** First visit of an account created through Google sign-in: consent is recorded before anything else. */
function TermsGate({ profile }: { profile: Profile }) {
  return (
    <>
      <PageHeader title={`Welcome, ${profile.full_name}`} description="One step before you continue." />
      <div className="card card-pad max-w-2xl">
        <p className="text-sm text-charcoal">
          Your account ({profile.email}) was created as <strong>{ROLE_LABELS[profile.role]}</strong>. If you need a different role,
          a CGS administrator can change it after reviewing your account.
        </p>
        <ActionForm action={acceptTerms} submitLabel="Accept and continue" className="mt-4 space-y-4" resetOnSuccess={false}>
          <label className="flex items-start gap-2 text-sm">
            <input name="accepted_terms" type="checkbox" required className="mt-0.5" />
            <span>
              I have read and accept the <Link href="/terms" className="link" target="_blank">Terms and Conditions</Link> and consent to the
              processing of my personal data as described in the <Link href="/privacy" className="link" target="_blank">Privacy Policy</Link>.
            </span>
          </label>
        </ActionForm>
      </div>
    </>
  );
}

function AccountNotice({ profile }: { profile: Profile }) {
  const messages: Record<string, string> = {
    pending:
      "Your account has been created and is waiting for activation by a CGS administrator. You will be able to use the portal as soon as it is approved.",
    suspended: "Your account has been suspended. Contact CGS support if you believe this is a mistake.",
    terminated: "Your account has been closed. Contact CGS support for further information.",
  };
  return (
    <>
      <PageHeader title={`Welcome, ${profile.full_name}`} />
      <div className={`alert ${profile.status === "pending" ? "alert-warning" : "alert-error"} max-w-2xl`}>
        <p className="font-medium">Account status: {ACCOUNT_STATUS[profile.status].label}</p>
        <p className="mt-1">{messages[profile.status]}</p>
        <p className="mt-2">
          Requested role: {ROLE_LABELS[profile.role]}. <Link href="/contact" className="link">Contact support</Link>
        </p>
      </div>
    </>
  );
}

async function AdminDashboard({ supabase }: { supabase: Supabase }) {
  const ferdCount = (table: "ferd_students" | "ferd_payments" | "ferd_content", status?: string) => {
    const query = supabase.from(table).select("*", { count: "exact", head: true });
    return status ? query.eq("status", status) : query;
  };
  const [users, projects, queue, logs, pendingListings, openEnquiries, ferdStudents, ferdPending, ferdVerified, ferdPublished, ferdPaid] = await Promise.all([
    countBy(supabase, "profiles", "status", Object.keys(ACCOUNT_STATUS)),
    countBy(supabase, "projects", "status", PROJECT_STATUSES),
    supabase.from("projects").select(PROJECT_LIST_COLUMNS).eq("status", "pending_approval").order("submitted_at").limit(5),
    supabase.from("activity_logs").select(ACTIVITY_COLUMNS).order("created_at", { ascending: false }).limit(8),
    supabase.from("marketplace_listings").select("project_id", { count: "exact", head: true }).eq("status", "pending_review"),
    supabase.from("marketplace_interests").select("id", { count: "exact", head: true }).in("status", ["submitted", "under_review", "due_diligence", "negotiation"]),
    ferdCount("ferd_students"),
    ferdCount("ferd_students", "pending"),
    ferdCount("ferd_students", "verified"),
    ferdCount("ferd_content", "published"),
    ferdCount("ferd_payments", "success"),
  ]);
  // A count that could not be read is shown as unavailable, never as zero.
  const ferdValue = (result: { count: number | null; error: unknown }) => (result.error ? "Unavailable" : (result.count ?? 0));
  return (
    <div className="space-y-5">
      <PageHeader
        title="Administration dashboard"
        description="Platform-wide accounts, projects and activity."
        actions={<Link href="/dashboard/command" className="btn btn-primary">Global Command Center</Link>}
      />
      <WorkspaceEarth supabase={supabase} admin />
      <StatGrid>
        <StatCard label="Registered users" value={sum(users)} href="/dashboard/admin/users" />
        <StatCard label="Active accounts" value={users.active} />
        <StatCard label="Pending accounts" value={users.pending} hint="Awaiting activation" href="/dashboard/admin/users?status=pending" />
        <StatCard label="Suspended or terminated" value={users.suspended + users.terminated} />
        <StatCard label="Registered projects" value={sum(projects)} href="/dashboard/projects" />
        <StatCard label="Pending approval" value={projects.pending_approval} href="/dashboard/admin/approvals" />
        <StatCard label="Active projects" value={projects.active} />
        <StatCard label="Completed / rejected" value={`${projects.completed} / ${projects.rejected}`} />
        <StatCard label="Listings awaiting review" value={pendingListings.count ?? 0} hint="Marketplace" />
        <StatCard label="Open investor enquiries" value={openEnquiries.count ?? 0} href="/dashboard/marketplace/enquiries" />
      </StatGrid>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Projects by status">
          <CountBarChart data={chartData(PROJECT_STATUS, projects)} unit="Projects" />
        </Card>
        <Card title="Recent activity" pad={false} actions={<Link href="/dashboard/admin/activity" className="link text-xs">View all</Link>}>
          <ActivityList logs={logs.data ?? []} />
        </Card>
      </div>
      <Card title="FERD Student Portal" actions={<Link href="/ferd/admin" className="link text-xs">Open FERD administration</Link>}>
        <StatGrid>
          <StatCard label="Registered students" value={ferdValue(ferdStudents)} href="/ferd/admin/students" />
          <StatCard label="Students awaiting review" value={ferdValue(ferdPending)} href="/ferd/admin/students?status=pending" />
          <StatCard label="Verified students" value={ferdValue(ferdVerified)} href="/ferd/admin/students?status=verified" />
          <StatCard label="Published content" value={ferdValue(ferdPublished)} href="/ferd/admin/content" />
          <StatCard label="Successful payments" value={ferdValue(ferdPaid)} href="/ferd/admin/payments" />
        </StatGrid>
      </Card>
      <Card title="Approval queue" pad={false} actions={<Link href="/dashboard/admin/approvals" className="link text-xs">Review submissions</Link>}>
        <ProjectTable projects={queue.data ?? []} empty="No projects are waiting for approval." />
      </Card>
    </div>
  );
}

async function ManagerDashboard({ supabase }: { supabase: Supabase }) {
  const day = today();
  const [projects, tasks, overdue, pendingReports, pendingDocs, upcoming, milestones, logs] = await Promise.all([
    countBy(supabase, "projects", "status", PROJECT_STATUSES),
    countBy(supabase, "tasks", "status", TASK_STATUSES),
    countOverdueTasks(supabase, day),
    supabase.from("monitoring_records").select("id", { count: "exact", head: true }).eq("review_status", "submitted"),
    supabase.from("documents").select("id", { count: "exact", head: true }).eq("review_status", "pending").is("monitoring_record_id", null),
    supabase.from("tasks").select(TASK_LIST_COLUMNS).neq("status", "completed").not("due_date", "is", null).order("due_date").limit(8),
    supabase.from("milestones").select("id, title, due_date, project_id, project:projects(name)").eq("status", "pending").order("due_date").limit(5),
    supabase.from("activity_logs").select(ACTIVITY_COLUMNS).order("created_at", { ascending: false }).limit(8),
  ]);
  return (
    <div className="space-y-5">
      <PageHeader title="Project manager dashboard" description="Projects you manage, their tasks and items waiting for your review." />
      <WorkspaceEarth supabase={supabase} />
      <StatGrid>
        <StatCard label="Projects managed" value={sum(projects)} href="/dashboard/projects" />
        <StatCard label="Active projects" value={projects.active} />
        <StatCard label="Completed projects" value={projects.completed} />
        <StatCard label="Awaiting activation" value={projects.approved} hint="Approved, not yet started" />
        <StatCard label="Open tasks" value={tasks.todo + tasks.in_progress} href="/dashboard/tasks" />
        <StatCard label="Tasks to review" value={tasks.under_review} href="/dashboard/tasks?status=under_review" />
        <StatCard label="Overdue tasks" value={overdue} href="/dashboard/tasks?overdue=1" />
        <StatCard label="Completed tasks" value={tasks.completed} />
        <StatCard label="Field reports to review" value={pendingReports.count ?? 0} href="/dashboard/monitoring?status=submitted" />
        <StatCard label="Documents to review" value={pendingDocs.count ?? 0} href="/dashboard/documents?status=pending" />
      </StatGrid>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Tasks by status">
          <CountBarChart data={chartData(TASK_STATUS, tasks)} unit="Tasks" />
        </Card>
        <Card title="Upcoming milestones" pad={false} actions={<Link href="/dashboard/milestones" className="link text-xs">All milestones</Link>}>
          {(milestones.data ?? []).length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-grey">No pending milestones.</p>
          ) : (
            <ul className="divide-y divide-subtle-border">
              {(milestones.data ?? []).map((m) => (
                <li key={m.id} className="flex justify-between gap-3 px-4 py-2.5 text-sm sm:px-5">
                  <Link href={`/dashboard/projects/${m.project_id}?tab=milestones`} className="link">{m.title}</Link>
                  <span className={m.due_date && m.due_date < day ? "font-medium text-red-300" : "text-muted-grey"}>
                    {m.due_date ?? "No date"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card title="Upcoming deadlines" pad={false}>
        <TaskTable tasks={upcoming.data ?? []} empty="No open tasks with a due date." />
      </Card>
      <Card title="Recent project activity" pad={false}>
        <ActivityList logs={logs.data ?? []} />
      </Card>
    </div>
  );
}

async function OwnerDashboard({ supabase }: { supabase: Supabase }) {
  const [counts, projects, monitoring, milestones] = await Promise.all([
    countBy(supabase, "projects", "status", PROJECT_STATUSES),
    supabase.from("projects").select(PROJECT_LIST_COLUMNS).order("created_at", { ascending: false }).limit(10),
    supabase.from("monitoring_records").select(MONITORING_LIST_COLUMNS).order("observation_date", { ascending: false }).limit(5),
    supabase.from("milestones").select("id", { count: "exact", head: true }).eq("status", "completed"),
  ]);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Project owner dashboard"
        description="Your registered projects, their approval status and reviewed progress updates."
        actions={<Link href="/dashboard/projects/new" className="btn btn-primary">Submit a project</Link>}
      />
      <WorkspaceEarth supabase={supabase} />
      <StatGrid>
        <StatCard label="Registered projects" value={sum(counts)} href="/dashboard/projects" />
        <StatCard label="Pending approval" value={counts.pending_approval} />
        <StatCard label="Revision required" value={counts.revision_required} hint="Needs your attention" />
        <StatCard label="Approved / active" value={counts.approved + counts.active} />
        <StatCard label="Drafts" value={counts.draft} />
        <StatCard label="Completed" value={counts.completed} />
        <StatCard label="Rejected" value={counts.rejected} />
        <StatCard label="Milestones completed" value={milestones.count ?? 0} />
      </StatGrid>
      <Card title="My projects" pad={false}>
        <ProjectTable projects={projects.data ?? []} empty="You have not registered a project yet. Use “Submit a project” to start." />
      </Card>
      <Card title="Latest monitoring updates" pad={false} actions={<Link href="/dashboard/monitoring" className="link text-xs">All updates</Link>}>
        <MonitoringTable records={monitoring.data ?? []} empty="No reviewed monitoring reports are available yet." />
      </Card>
    </div>
  );
}

async function FieldOfficerDashboard({ supabase, profile }: { supabase: Supabase; profile: Profile }) {
  const day = today();
  const mine = () => supabase.from("tasks").select("id", { count: "exact", head: true }).eq("assigned_to", profile.id);
  const reports = (status: string) =>
    supabase.from("monitoring_records").select("id", { count: "exact", head: true }).eq("recorded_by", profile.id).eq("review_status", status);
  const [projects, open, review, done, overdue, submitted, corrections, approved, tasks, toCorrect] = await Promise.all([
    supabase.from("projects").select("id", { count: "exact", head: true }),
    mine().in("status", ["todo", "in_progress"]),
    mine().eq("status", "under_review"),
    mine().eq("status", "completed"),
    countOverdueTasks(supabase, day, profile.id),
    reports("submitted"),
    reports("revision_required"),
    reports("approved"),
    supabase.from("tasks").select(TASK_LIST_COLUMNS).eq("assigned_to", profile.id).neq("status", "completed").order("due_date").limit(8),
    supabase.from("monitoring_records").select(MONITORING_LIST_COLUMNS).eq("recorded_by", profile.id).eq("review_status", "revision_required").limit(5),
  ]);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Field officer dashboard"
        description="Your assigned projects, field tasks and monitoring reports."
        actions={<Link href="/dashboard/monitoring/new" className="btn btn-primary">New field report</Link>}
      />
      <WorkspaceEarth supabase={supabase} />
      <StatGrid>
        <StatCard label="Assigned projects" value={projects.count ?? 0} href="/dashboard/projects" />
        <StatCard label="Pending tasks" value={open.count ?? 0} href="/dashboard/tasks" />
        <StatCard label="Overdue tasks" value={overdue} href="/dashboard/tasks?overdue=1" />
        <StatCard label="Tasks under review" value={review.count ?? 0} />
        <StatCard label="Completed tasks" value={done.count ?? 0} />
        <StatCard label="Reports awaiting review" value={submitted.count ?? 0} />
        <StatCard label="Reports to correct" value={corrections.count ?? 0} hint="Returned by the reviewer" />
        <StatCard label="Reports approved" value={approved.count ?? 0} />
      </StatGrid>
      {(toCorrect.data ?? []).length > 0 && (
        <Card title="Reports returned for correction" pad={false}>
          <MonitoringTable records={toCorrect.data ?? []} empty="" />
        </Card>
      )}
      <Card title="My open tasks" pad={false} actions={<Link href="/dashboard/tasks" className="link text-xs">All tasks</Link>}>
        <TaskTable tasks={tasks.data ?? []} empty="You have no open tasks." />
      </Card>
    </div>
  );
}

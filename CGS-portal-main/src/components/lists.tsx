import Link from "next/link";
import { EmptyState, ProgressBar, StatusBadge } from "@/components/ui";
import { MONITORING_STATUS, OBSERVATION_TYPES, PROJECT_STATUS, TASK_PRIORITY, TASK_STATUS } from "@/lib/constants";
import { formatDate, formatDateTime, humanize, isOverdue } from "@/lib/format";

/* Table renderers shared by the dashboards, list pages and the project workspace. */


type Row = Record<string, any>;

export function ProjectTable({ projects, empty }: { projects: Row[]; empty: string }) {
  if (!projects.length) return <EmptyState title={empty} />;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Project</th>
            <th>Category</th>
            <th>County</th>
            <th>Status</th>
            <th>Progress</th>
            <th>Manager</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id}>
              <td>
                <Link href={`/dashboard/projects/${p.id}`} className="link">
                  {p.name}
                </Link>
                <div className="text-xs text-muted-grey">{p.code}</div>
              </td>
              <td>{p.category?.name ?? "—"}</td>
              <td>{p.county}</td>
              <td>
                <StatusBadge map={PROJECT_STATUS} value={p.status} />
              </td>
              <td>
                <ProgressBar value={p.progress_percent} />
              </td>
              <td>{p.manager?.full_name ?? "Not assigned"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TaskTable({ tasks, empty, showProject = true }: { tasks: Row[]; empty: string; showProject?: boolean }) {
  if (!tasks.length) return <EmptyState title={empty} />;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Task</th>
            {showProject && <th>Project</th>}
            <th>Assigned to</th>
            <th>Priority</th>
            <th>Due</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const overdue = isOverdue(t.due_date, t.status === "completed");
            return (
              <tr key={t.id}>
                <td>
                  <Link href={`/dashboard/tasks/${t.id}`} className="link">
                    {t.title}
                  </Link>
                </td>
                {showProject && <td>{t.project?.name ?? "—"}</td>}
                <td>{t.assignee?.full_name ?? "Unassigned"}</td>
                <td>
                  <StatusBadge map={TASK_PRIORITY} value={t.priority} />
                </td>
                <td className={overdue ? "font-medium text-red-300" : ""}>
                  {formatDate(t.due_date)}
                  {overdue && <span className="block text-xs">Overdue</span>}
                </td>
                <td>
                  <StatusBadge map={TASK_STATUS} value={t.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function MonitoringTable({ records, empty, showProject = true }: { records: Row[]; empty: string; showProject?: boolean }) {
  if (!records.length) return <EmptyState title={empty} />;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Observation</th>
            {showProject && <th>Project</th>}
            <th>Date</th>
            <th>Recorded by</th>
            <th>Basis</th>
            <th>Review</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id}>
              <td>
                <Link href={`/dashboard/monitoring/${r.id}`} className="link">
                  {OBSERVATION_TYPES[r.observation_type]?.label ?? r.observation_type}
                </Link>
              </td>
              {showProject && <td>{r.project?.name ?? "—"}</td>}
              <td>{formatDate(r.observation_date)}</td>
              <td>{r.recorder?.full_name ?? "—"}</td>
              <td className="capitalize">{r.value_basis}</td>
              <td>
                <StatusBadge map={MONITORING_STATUS} value={r.review_status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Describes an audit-log row in plain words. */
function describe(log: Row): string {
  const d = log.details ?? {};
  const subject = d.title ?? d.name ?? d.user ?? "";
  const change = d.from && d.to ? ` (${humanize(String(d.from))} → ${humanize(String(d.to))})` : d.decision ? ` (${humanize(String(d.decision))})` : "";
  return `${humanize(log.action)}${subject ? `: ${subject}` : ""}${change}`;
}

export function ActivityList({ logs, empty = "No activity recorded yet." }: { logs: Row[]; empty?: string }) {
  if (!logs.length) return <EmptyState title={empty} />;
  return (
    <ul className="divide-y divide-subtle-border">
      {logs.map((log) => (
        <li key={log.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-2.5 text-sm sm:px-5">
          <span>
            {describe(log)}
            {log.project && <span className="text-muted-grey"> · {log.project.code}</span>}
          </span>
          <span className="text-xs text-muted-grey">
            {log.actor?.full_name ?? "System"} · {formatDateTime(log.created_at)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export const PROJECT_LIST_COLUMNS =
  "id, code, name, county, status, progress_percent, created_at, category:project_categories(name), manager:profiles!projects_manager_id_fkey(full_name), owner:profiles!projects_owner_id_fkey(full_name)";
export const TASK_LIST_COLUMNS =
  "id, title, priority, status, due_date, project_id, assigned_to, project:projects(name, code), assignee:profiles!tasks_assigned_to_fkey(full_name)";
export const MONITORING_LIST_COLUMNS =
  "id, observation_type, observation_date, value_basis, review_status, project_id, project:projects(name, code), recorder:profiles!monitoring_records_recorded_by_fkey(full_name)";
export const ACTIVITY_COLUMNS =
  "id, action, entity_type, details, created_at, actor:profiles!activity_logs_actor_id_fkey(full_name), project:projects(code)";

import Link from "next/link";
import { Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { requireActive } from "@/lib/auth";
import { MILESTONE_STATUS } from "@/lib/constants";
import { formatDate, isOverdue } from "@/lib/format";

export default async function MilestonesPage() {
  const { supabase } = await requireActive();
  const { data: milestones, error } = await supabase
    .from("milestones")
    .select("id, title, due_date, status, completed_at, project_id, project:projects(name, code)")
    .order("due_date", { nullsFirst: false })
    .limit(300);
  if (error) throw new Error(error.message);

  return (
    <>
      <PageHeader title="Milestones" description="Milestones across your projects. Milestones are added and completed from the Milestones tab of a project." />
      <Card pad={false}>
        {milestones.length === 0 ? (
          <EmptyState title="No milestones have been defined yet.">
            Open a project and use its Milestones tab to add one.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Milestone</th>
                  <th>Project</th>
                  <th>Target date</th>
                  <th>Status</th>
                  <th>Completed</th>
                </tr>
              </thead>
              <tbody>
                {(milestones as any[]).map((m) => {
                  const overdue = isOverdue(m.due_date, m.status === "completed");
                  return (
                    <tr key={m.id}>
                      <td>
                        <Link href={`/dashboard/projects/${m.project_id}?tab=milestones`} className="link">{m.title}</Link>
                      </td>
                      <td>{m.project?.name ?? "—"}</td>
                      <td className={overdue ? "font-medium text-red-300" : ""}>
                        {formatDate(m.due_date)}
                        {overdue && <span className="block text-xs">Overdue</span>}
                      </td>
                      <td>
                        <StatusBadge map={MILESTONE_STATUS} value={m.status} />
                      </td>
                      <td>{formatDate(m.completed_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

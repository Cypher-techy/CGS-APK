import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { ActivityList, ACTIVITY_COLUMNS } from "@/components/lists";
import { Card, DetailList, Field, PageHeader, StatusBadge } from "@/components/ui";
import { requireActive } from "@/lib/auth";
import { TASK_PRIORITY, TASK_STATUS } from "@/lib/constants";
import { formatDate, formatDateTime, isOverdue } from "@/lib/format";
import { addComment } from "@/modules/projects/actions";
import { deleteTask, setTaskStatus, updateTask } from "@/modules/tasks/actions";

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await requireActive();

  const { data: task } = await supabase
    .from("tasks")
    .select(
      "*, project:projects(id, name, code, owner_id, manager_id), assignee:profiles!tasks_assigned_to_fkey(full_name), milestone:milestones(title)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!task) notFound();

  const canManage = profile.role === "super_admin" || (profile.role === "project_manager" && task.project.manager_id === profile.id);
  const isAssignee = task.assigned_to === profile.id;

  const [{ data: comments }, { data: logs }, { data: members }, { data: leads }, { data: milestones }] = await Promise.all([
    supabase
      .from("project_comments")
      .select("id, body, created_at, author:profiles!project_comments_author_id_fkey(full_name)")
      .eq("task_id", id)
      .order("created_at"),
    supabase.from("activity_logs").select(ACTIVITY_COLUMNS).eq("entity_type", "task").eq("entity_id", id).order("created_at", { ascending: false }),
    canManage
      ? supabase.from("project_members").select("user:profiles!project_members_user_id_fkey(id, full_name)").eq("project_id", task.project_id)
      : Promise.resolve({ data: [] }),
    canManage
      ? supabase.from("profiles").select("id, full_name").in("id", [task.project.owner_id, task.project.manager_id].filter(Boolean))
      : Promise.resolve({ data: [] }),
    canManage ? supabase.from("milestones").select("id, title").eq("project_id", task.project_id) : Promise.resolve({ data: [] }),
  ]);
  const people = new Map<string, string>();

  for (const m of (members ?? []) as any[]) if (m.user) people.set(m.user.id, m.user.full_name);
  for (const p of leads ?? []) people.set(p.id, p.full_name);

  // Workflow: assignee starts the task and submits it for review; the manager completes or returns it.
  const steps: { status: string; label: string; primary?: boolean }[] = [];
  if (isAssignee || canManage) {
    if (task.status === "todo") steps.push({ status: "in_progress", label: "Start task", primary: true });
    if (task.status === "in_progress") steps.push({ status: "under_review", label: "Submit for review", primary: true });
  }
  if (canManage) {
    if (task.status !== "completed") steps.push({ status: "completed", label: "Mark completed", primary: task.status === "under_review" });
    if (task.status === "under_review") steps.push({ status: "in_progress", label: "Return for further work" });
    if (task.status === "completed") steps.push({ status: "in_progress", label: "Reopen task" });
  }
  const overdue = isOverdue(task.due_date, task.status === "completed");

  return (
    <>
      <PageHeader
        title={task.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge map={TASK_STATUS} value={task.status} />
            <StatusBadge map={TASK_PRIORITY} value={task.priority} />
            {overdue && <span className="font-medium text-red-300">Overdue</span>}
          </span>
        }
        crumbs={[
          { label: task.project.name, href: `/dashboard/projects/${task.project_id}?tab=tasks` },
          { label: "Task" },
        ]}
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Task details">
            <DetailList
              items={[
                ["Project", <Link key="p" href={`/dashboard/projects/${task.project_id}`} className="link">{task.project.name}</Link>],
                ["Assigned to", task.assignee?.full_name ?? "Unassigned"],
                ["Due date", formatDate(task.due_date)],
                ["Milestone", task.milestone?.title],
                ["Created", formatDateTime(task.created_at)],
                ["Completed", formatDateTime(task.completed_at)],
              ]}
            />
            <h3 className="section-title mt-5">Description and instructions</h3>
            <p className="prose-block mt-1">{task.description || "No description provided."}</p>
          </Card>

          <Card title="Comments">
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
              <input type="hidden" name="project_id" value={task.project_id} />
              <input type="hidden" name="task_id" value={task.id} />
              <Field label="Add a comment or progress update">
                <textarea name="body" className="input" rows={2} required maxLength={2000} />
              </Field>
            </ActionForm>
          </Card>

          {canManage && (
            <Card title="Edit task">
              <ActionForm action={updateTask} submitLabel="Save changes" className="space-y-4" resetOnSuccess={false}>
                <input type="hidden" name="task_id" value={task.id} />
                <Field label="Title">
                  <input name="title" className="input" required minLength={3} maxLength={160} defaultValue={task.title} />
                </Field>
                <Field label="Description and instructions">
                  <textarea name="description" className="input" rows={3} maxLength={4000} defaultValue={task.description ?? ""} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Assign to">
                    <select name="assigned_to" className="input" defaultValue={task.assigned_to ?? ""}>
                      <option value="">Unassigned</option>
                      {[...people].map(([value, name]) => (
                        <option key={value} value={value}>{name}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Priority">
                    <select name="priority" className="input" defaultValue={task.priority}>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </Field>
                  <Field label="Due date">
                    <input name="due_date" type="date" className="input" defaultValue={task.due_date ?? ""} />
                  </Field>
                  <Field label="Milestone">
                    <select name="milestone_id" className="input" defaultValue={task.milestone_id ?? ""}>
                      <option value="">None</option>
                      {(milestones ?? []).map((m) => (
                        <option key={m.id} value={m.id}>{m.title}</option>
                      ))}
                    </select>
                  </Field>
                </div>
              </ActionForm>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <Card title="Update status">
            {steps.length === 0 ? (
              <p className="text-sm text-muted-grey">
                {task.status === "under_review" ? "Waiting for the project manager's review." : "No status change is available to you for this task."}
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {steps.map((step) => (
                  <ActionForm key={step.label} action={setTaskStatus} submitLabel={step.label} submitClass={`btn ${step.primary ? "btn-primary" : "btn-secondary"}`}>
                    <input type="hidden" name="task_id" value={task.id} />
                    <input type="hidden" name="status" value={step.status} />
                  </ActionForm>
                ))}
              </div>
            )}
            {canManage && (
              <div className="mt-4 border-t border-subtle-border pt-4">
                <ActionForm action={deleteTask} confirm="Delete this task and its comments?" submitLabel="Delete task" submitClass="btn btn-danger btn-sm">
                  <input type="hidden" name="task_id" value={task.id} />
                </ActionForm>
              </div>
            )}
          </Card>
          <Card title="Task history" pad={false}>
            <ActivityList logs={logs ?? []} empty="No history recorded." />
          </Card>
        </div>
      </div>
    </>
  );
}

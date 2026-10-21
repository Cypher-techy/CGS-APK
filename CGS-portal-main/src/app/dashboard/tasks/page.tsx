import Link from "next/link";
import { TASK_LIST_COLUMNS, TaskTable } from "@/components/lists";
import { Card, PageHeader } from "@/components/ui";
import { requireActive } from "@/lib/auth";
import { TASK_STATUS } from "@/lib/constants";
import { today } from "@/lib/format";

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ status?: string; overdue?: string }> }) {
  const { supabase, profile } = await requireActive();
  const { status = "", overdue } = await searchParams;
  const mineOnly = profile.role === "field_officer";

  let query = supabase.from("tasks").select(TASK_LIST_COLUMNS).order("due_date", { nullsFirst: false }).limit(300);
  if (mineOnly) query = query.eq("assigned_to", profile.id);
  if (status in TASK_STATUS) query = query.eq("status", status);
  if (overdue) query = query.neq("status", "completed").lt("due_date", today());
  const { data: tasks, error } = await query;
  if (error) throw new Error(error.message);

  const filters = [{ label: "All", href: "/dashboard/tasks", active: !status && !overdue }]
    .concat(Object.entries(TASK_STATUS).map(([value, { label }]) => ({ label, href: `/dashboard/tasks?status=${value}`, active: status === value })))
    .concat([{ label: "Overdue", href: "/dashboard/tasks?overdue=1", active: !!overdue }]);

  return (
    <>
      <PageHeader
        title={mineOnly ? "My Tasks" : "Tasks"}
        description={
          mineOnly
            ? "Tasks assigned to you. Open a task to update its status or add a comment."
            : "Tasks across your projects. New tasks are created from the Tasks tab of a project."
        }
        actions={!mineOnly && <Link href="/dashboard/projects" className="btn btn-secondary">Choose a project</Link>}
      />
      <Card pad={false}>
        <div className="flex flex-wrap gap-1.5 border-b border-subtle-border p-3">
          {filters.map((f) => (
            <Link key={f.label} href={f.href} className={`btn btn-sm ${f.active ? "btn-primary" : "btn-secondary"}`}>
              {f.label}
            </Link>
          ))}
        </div>
        <TaskTable tasks={tasks} empty="No tasks match this view." />
      </Card>
    </>
  );
}

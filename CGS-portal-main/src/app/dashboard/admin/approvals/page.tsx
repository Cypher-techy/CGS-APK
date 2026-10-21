import Link from "next/link";
import { Card, DetailList, EmptyState, PageHeader } from "@/components/ui";
import { requireActive } from "@/lib/auth";
import { formatDate, formatDateTime, formatNumber, humanize } from "@/lib/format";
import { ReviewForm } from "@/modules/projects/ReviewForm";

export default async function ApprovalsPage() {
  const { supabase } = await requireActive(["super_admin"]);
  const [{ data: queue, error }, { data: managers }, { data: recent }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, code, name, county, area_ha, description, submitted_at, start_date, manager_id, category:project_categories(name), owner:profiles!projects_owner_id_fkey(full_name, email)")
      .eq("status", "pending_approval")
      .order("submitted_at"),
    supabase.from("profiles").select("id, full_name").eq("role", "project_manager").eq("status", "active").order("full_name"),
    supabase.from("approvals").select("id, decision, created_at, project:projects(id, name, code)").order("created_at", { ascending: false }).limit(10),
  ]);
  if (error) throw new Error(error.message);

  return (
    <>
      <PageHeader
        title="Project approvals"
        description="Review submitted projects. Approve, reject or ask the owner for a revision; the owner is notified of each decision."
      />
      <div className="space-y-5">
        {queue.length === 0 && (
          <Card>
            <EmptyState title="No projects are waiting for approval." />
          </Card>
        )}
        {(queue as any[]).map((project) => (
          <Card
            key={project.id}
            title={`${project.name} (${project.code})`}
            actions={<Link href={`/dashboard/projects/${project.id}?tab=documents`} className="link text-xs">Open project and documents</Link>}
          >
            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <DetailList
                  items={[
                    ["Owner", `${project.owner?.full_name ?? "—"} (${project.owner?.email ?? ""})`],
                    ["Category", project.category?.name],
                    ["County", project.county],
                    ["Land area", project.area_ha !== null ? `${formatNumber(project.area_ha, 2)} ha` : null],
                    ["Planned start", formatDate(project.start_date)],
                    ["Submitted", formatDateTime(project.submitted_at)],
                  ]}
                />
                <p className="prose-block mt-4 line-clamp-6">{project.description}</p>
              </div>
              <ReviewForm projectId={project.id} managers={managers ?? []} currentManagerId={project.manager_id} />
            </div>
          </Card>
        ))}

        <Card title="Recent decisions" pad={false}>
          {(recent ?? []).length === 0 ? (
            <EmptyState title="No decisions have been recorded yet." />
          ) : (
            <ul className="divide-y divide-subtle-border">
              {((recent ?? []) as any[]).map((a) => (
                <li key={a.id} className="flex flex-wrap justify-between gap-2 px-4 py-2.5 text-sm sm:px-5">
                  <span>
                    {humanize(a.decision)}:{" "}
                    <Link href={`/dashboard/projects/${a.project?.id}`} className="link">{a.project?.name}</Link>
                  </span>
                  <span className="text-xs text-muted-grey">{formatDateTime(a.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

import { Card, EmptyState, PageHeader } from "@/components/ui";
import { requireActive } from "@/lib/auth";
import { today } from "@/lib/format";
import { MonitoringForm } from "@/modules/monitoring/MonitoringForm";

export default async function NewMonitoringPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { supabase } = await requireActive(["field_officer", "project_manager", "super_admin"]);
  const { project } = await searchParams;
  // Reports are recorded against projects that are being implemented.
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, code")
    .in("status", ["approved", "active", "on_hold", "completed"])
    .order("name");
  const { data: sites } = await supabase.from("project_sites").select("id, project_id, name, latitude, longitude").order("name");

  return (
    <>
      <PageHeader
        title="New field report"
        description="Record an environmental observation. The project manager reviews each report before the project owner can see it."
        crumbs={[{ label: "Monitoring", href: "/dashboard/monitoring" }, { label: "New field report" }]}
      />
      <Card>
        {(projects ?? []).length === 0 ? (
          <EmptyState title="You are not assigned to an approved project yet.">
            A project manager must add you to a project team before you can submit field reports.
          </EmptyState>
        ) : (
          <MonitoringForm projects={projects ?? []} sites={sites ?? []} defaultProjectId={(projects ?? []).some((p) => p.id === project) ? project : undefined} maxDate={today()} />
        )}
      </Card>
    </>
  );
}

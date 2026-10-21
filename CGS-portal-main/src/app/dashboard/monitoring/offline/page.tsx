import { Card, EmptyState, PageHeader } from "@/components/ui";
import { requireActive } from "@/lib/auth";
import { today } from "@/lib/format";
import { OfflineCapture } from "@/modules/monitoring/OfflineCapture";

export default async function OfflineCapturePage() {
  const { supabase, profile } = await requireActive(["field_officer", "project_manager", "super_admin"]);
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, code")
    .in("status", ["approved", "active", "on_hold", "completed"])
    .order("name");

  return (
    <>
      <PageHeader
        title="Offline field capture"
        description="Record field reports where there is no connection. Reports are kept on this device and sent automatically when it is back online. Open this page once while online before going to the field, and stay signed in."
        crumbs={[{ label: "Monitoring", href: "/dashboard/monitoring" }, { label: "Offline capture" }]}
      />
      {(projects ?? []).length === 0 ? (
        <Card>
          <EmptyState title="You are not assigned to an approved project yet.">
            A project manager must add you to a project team before you can record field reports.
          </EmptyState>
        </Card>
      ) : (
        <OfflineCapture projects={projects ?? []} userId={profile.id} maxDate={today()} />
      )}
    </>
  );
}

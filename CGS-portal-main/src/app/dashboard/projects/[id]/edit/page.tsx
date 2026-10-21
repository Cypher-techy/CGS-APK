import { notFound, redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireActive } from "@/lib/auth";
import type { Project } from "@/lib/types";
import { ProjectForm } from "@/modules/projects/ProjectForm";

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await requireActive();
  const [{ data }, { data: categories }, { data: memberships }, { data: allOrganizations }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).maybeSingle(),
    supabase.from("project_categories").select("id, name, is_active").order("name"),
    supabase.from("organization_members").select("organization:organizations(id, name)").eq("user_id", profile.id),
    profile.role === "super_admin" ? supabase.from("organizations").select("id, name").order("name") : Promise.resolve({ data: null }),
  ]);
  const project = data as Project | null;
  if (!project) notFound();

  const ownerEditable = project.owner_id === profile.id && ["draft", "revision_required"].includes(project.status);
  const staffEditable = profile.role === "super_admin" || (profile.role === "project_manager" && project.manager_id === profile.id);
  if (!ownerEditable && !staffEditable) redirect(`/dashboard/projects/${id}`);
  // Administrators may attach any organization; everyone else only their own (plus the one already set).
   
  const own = ((memberships ?? []) as any[]).map((m) => m.organization).filter(Boolean) as { id: string; name: string }[];
  let organizations = allOrganizations ?? own;
  if (project.organization_id && !organizations.some((o) => o.id === project.organization_id)) {
    const { data: current } = await supabase.from("organizations").select("id, name").eq("id", project.organization_id).maybeSingle();
    if (current) organizations = [...organizations, current];
  }

  return (
    <>
      <PageHeader
        title={`Edit ${project.name}`}
        description={project.code}
        crumbs={[{ label: "Projects", href: "/dashboard/projects" }, { label: project.name, href: `/dashboard/projects/${id}` }, { label: "Edit" }]}
      />
      <Card>
        <ProjectForm
          project={project}
          categories={(categories ?? []).filter((c) => c.is_active || c.id === project.category_id)}
          organizations={organizations}
          canSubmit={ownerEditable}
          canSetAnyStage={staffEditable}
        />
      </Card>
    </>
  );
}

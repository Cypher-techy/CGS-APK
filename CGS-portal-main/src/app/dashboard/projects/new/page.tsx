import { Card, PageHeader } from "@/components/ui";
import { requireActive } from "@/lib/auth";
import { ProjectForm } from "@/modules/projects/ProjectForm";

export default async function NewProjectPage() {
  const { supabase, profile } = await requireActive(["project_owner"]);
  const [{ data: categories }, { data: memberships }] = await Promise.all([
    supabase.from("project_categories").select("id, name").eq("is_active", true).order("name"),
    supabase.from("organization_members").select("organization:organizations(id, name)").eq("user_id", profile.id),
  ]);
   
  const organizations = ((memberships ?? []) as any[]).map((m) => m.organization).filter(Boolean);
  return (
    <>
      <PageHeader
        title="Submit a project"
        description="Register an environmental project and place it on the Earth: choose its location on the map and draw or upload its boundary. Save it as a draft to continue later, or submit it for review by CGS. Supporting documents can be uploaded once the project is saved."
        crumbs={[{ label: "My Projects", href: "/dashboard/projects" }, { label: "Submit a project" }]}
      />
      <Card>
        <ProjectForm categories={categories ?? []} organizations={organizations} canSubmit />
      </Card>
    </>
  );
}

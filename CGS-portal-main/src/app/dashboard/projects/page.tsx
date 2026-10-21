import Link from "next/link";
import { PROJECT_LIST_COLUMNS, ProjectTable } from "@/components/lists";
import { Card, PageHeader } from "@/components/ui";
import { requireActive } from "@/lib/auth";
import { PROJECT_STATUS } from "@/lib/constants";

const TITLES: Record<string, string> = {
  super_admin: "Projects",
  project_manager: "My Projects",
  project_owner: "My Projects",
  field_officer: "Assigned Projects",
};

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const { supabase, profile } = await requireActive();
  const { q = "", status = "" } = await searchParams;

  // Row Level Security limits the result to projects this user owns, manages or is assigned to.
  let query = supabase.from("projects").select(PROJECT_LIST_COLUMNS).order("created_at", { ascending: false }).limit(200);
  if (status in PROJECT_STATUS) query = query.eq("status", status);
  const term = q.trim().replace(/[%,()]/g, " ").slice(0, 80);
  if (term) query = query.or(`name.ilike.%${term}%,code.ilike.%${term}%,county.ilike.%${term}%`);
  const { data: projects, error } = await query;
  if (error) throw new Error(error.message);

  return (
    <>
      <PageHeader
        title={TITLES[profile.role] ?? "Projects"}
        description="Projects you are authorised to see. Select a project to open its workspace."
        actions={profile.role === "project_owner" && <Link href="/dashboard/projects/new" className="btn btn-primary">Submit a project</Link>}
      />
      <Card pad={false}>
        <form className="flex flex-wrap items-end gap-3 border-b border-subtle-border p-4">
          <label className="min-w-40 flex-1">
            <span className="label">Search</span>
            <input name="q" defaultValue={q} placeholder="Name, code or county" className="input" />
          </label>
          <label>
            <span className="label">Status</span>
            <select name="status" defaultValue={status} className="input">
              <option value="">All statuses</option>
              {Object.entries(PROJECT_STATUS).map(([value, { label }]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn btn-secondary">Apply</button>
          {(q || status) && <Link href="/dashboard/projects" className="btn btn-secondary">Clear</Link>}
        </form>
        <ProjectTable projects={projects} empty={q || status ? "No projects match these filters." : "There are no projects to show yet."} />
      </Card>
    </>
  );
}

import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { Field } from "@/components/ui";
import { EARLY_STAGES, LIFECYCLE_STAGES } from "@/lib/constants";
import type { Project } from "@/lib/types";
import { saveProject } from "@/modules/projects/actions";
import { ProjectGeoFields } from "@/modules/projects/ProjectGeoFields";

/** Create / edit form for a project. `canSubmit` adds the "submit for approval" button. */
export function ProjectForm({
  project,
  categories,
  organizations,
  canSubmit,
  canSetAnyStage = false,
  allowBoundary = true,
}: {
  project?: Project;
  categories: { id: string; name: string }[];
  /** Organizations the viewer may attach the project to. */
  organizations: { id: string; name: string }[];
  canSubmit: boolean;
  /** Project managers and administrators may set stages from validation onwards. */
  canSetAnyStage?: boolean;
  allowBoundary?: boolean;
}) {
  const stages = Object.entries(LIFECYCLE_STAGES).filter(([key]) => canSetAnyStage || EARLY_STAGES.includes(key) || key === project?.lifecycle_stage);
  return (
    <ActionForm action={saveProject} className="space-y-6" resetOnSuccess={false}>
      {project && <input type="hidden" name="id" value={project.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Project name">
          <input name="name" className="input" required minLength={3} maxLength={160} defaultValue={project?.name} />
        </Field>
        <Field label="Category">
          <select name="category_id" className="input" required defaultValue={project?.category_id ?? ""}>
            <option value="" disabled>Select a category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Organization (optional)" hint={organizations.length === 0 ? undefined : "Only organizations you belong to are listed."}>
          <select name="organization_id" className="input" defaultValue={project?.organization_id ?? ""}>
            <option value="">No organization</option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          {organizations.length === 0 && (
            <span className="hint block">
              You do not belong to an organization yet. <Link href="/dashboard/organizations" className="link">Register one</Link>.
            </span>
          )}
        </Field>
        <Field label="Carbon project stage" hint="The stage of work, not a claim about credits. Later stages are set by the project manager or CGS.">
          <select name="lifecycle_stage" className="input" defaultValue={project?.lifecycle_stage ?? "idea"}>
            {stages.map(([key, stage]) => (
              <option key={key} value={key}>{stage.label}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Description" hint="What the project is and what it will do (at least 20 characters).">
        <textarea name="description" className="input" rows={5} required minLength={20} maxLength={5000} defaultValue={project?.description} />
      </Field>
      <Field label="Objectives (optional)">
        <textarea name="objectives" className="input" rows={4} maxLength={5000} defaultValue={project?.objectives ?? ""} />
      </Field>

      <ProjectGeoFields initial={project} allowBoundary={allowBoundary} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Start date (optional)">
          <input name="start_date" type="date" className="input" defaultValue={project?.start_date ?? ""} />
        </Field>
        <Field label="Expected completion date (optional)">
          <input name="expected_end_date" type="date" className="input" defaultValue={project?.expected_end_date ?? ""} />
        </Field>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-subtle-border pt-4">
        <button type="submit" name="intent" value="save" className="btn btn-secondary">
          {canSubmit ? "Save as draft" : "Save changes"}
        </button>
        {canSubmit && (
          <button type="submit" name="intent" value="submit" className="btn btn-primary">
            Save and submit for approval
          </button>
        )}
      </div>
    </ActionForm>
  );
}

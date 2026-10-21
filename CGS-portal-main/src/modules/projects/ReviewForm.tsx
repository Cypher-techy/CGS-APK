import { ActionForm } from "@/components/ActionForm";
import { Field } from "@/components/ui";
import { reviewProject } from "@/modules/projects/actions";

/** Administrator decision on a project that is pending approval. */
export function ReviewForm({
  projectId,
  managers,
  currentManagerId,
}: {
  projectId: string;
  managers: { id: string; full_name: string }[];
  currentManagerId: string | null;
}) {
  return (
    <ActionForm action={reviewProject} className="space-y-3">
      <input type="hidden" name="project_id" value={projectId} />
      <Field label="Project manager" hint="Required when approving.">
        <select name="manager_id" className="input" defaultValue={currentManagerId ?? ""}>
          <option value="">Not assigned</option>
          {managers.map((m) => (
            <option key={m.id} value={m.id}>{m.full_name}</option>
          ))}
        </select>
      </Field>
      <Field label="Review comments" hint="Required when rejecting or requesting a revision. Shown to the project owner.">
        <textarea name="comments" className="input" rows={3} maxLength={2000} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="decision" value="approved" className="btn btn-primary">Approve</button>
        <button type="submit" name="decision" value="revision_required" className="btn btn-secondary">Request revision</button>
        <button type="submit" name="decision" value="rejected" className="btn btn-danger">Reject</button>
      </div>
    </ActionForm>
  );
}

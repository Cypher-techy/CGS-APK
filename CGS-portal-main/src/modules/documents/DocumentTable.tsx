import { ActionForm } from "@/components/ActionForm";
import { EmptyState, StatusBadge } from "@/components/ui";
import { DOCUMENT_CATEGORIES, DOCUMENT_STATUS } from "@/lib/constants";
import { formatBytes, formatDateTime } from "@/lib/format";
import type { Profile } from "@/lib/types";
import { deleteDocument, reviewDocument } from "@/modules/documents/actions";

export const DOCUMENT_COLUMNS =
  "id, title, description, category, file_name, size_bytes, review_status, review_notes, created_at, project_id, uploaded_by, monitoring_record_id, project:projects(name, code, manager_id), uploader:profiles!documents_uploaded_by_fkey(full_name)";


type Row = Record<string, any>;

/** Document list with access-controlled download, review and delete actions. */
export function DocumentTable({ documents, viewer, showProject = true, empty }: { documents: Row[]; viewer: Profile; showProject?: boolean; empty: string }) {
  if (!documents.length) return <EmptyState title={empty} />;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Document</th>
            {showProject && <th>Project</th>}
            <th>Category</th>
            <th>Uploaded</th>
            <th>Review</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => {
            const canReview = viewer.role === "super_admin" || (viewer.role === "project_manager" && doc.project?.manager_id === viewer.id);
            const evidence = doc.monitoring_record_id !== null;
            const canDelete = canReview || (doc.uploaded_by === viewer.id && doc.review_status === "pending");
            return (
              <tr key={doc.id}>
                <td>
                  <a href={`/api/documents/${doc.id}`} className="link">{doc.title}</a>
                  <div className="text-xs text-muted-grey">
                    {doc.file_name} · {formatBytes(doc.size_bytes)}
                  </div>
                  {doc.description && <div className="mt-1 max-w-xs text-xs text-muted-grey">{doc.description}</div>}
                </td>
                {showProject && <td>{doc.project?.name ?? "—"}</td>}
                <td>{DOCUMENT_CATEGORIES[doc.category] ?? doc.category}</td>
                <td>
                  {doc.uploader?.full_name ?? "—"}
                  <div className="text-xs text-muted-grey">{formatDateTime(doc.created_at)}</div>
                </td>
                <td>
                  <StatusBadge map={DOCUMENT_STATUS} value={doc.review_status} />
                  {evidence && <div className="mt-1 text-xs text-muted-grey">Reviewed with its field report</div>}
                  {doc.review_notes && <div className="mt-1 max-w-xs text-xs text-muted-grey">Note: {doc.review_notes}</div>}
                </td>
                <td className="space-y-2">
                  <a href={`/api/documents/${doc.id}`} className="btn btn-secondary btn-sm">Download</a>
                  {canReview && !evidence && doc.review_status === "pending" && (
                    <ActionForm action={reviewDocument} className="space-y-1.5">
                      <input type="hidden" name="document_id" value={doc.id} />
                      <input name="review_notes" className="input py-1 text-xs" placeholder="Review note" maxLength={1000} aria-label="Review note" />
                      <div className="flex gap-1.5">
                        <button type="submit" name="decision" value="approved" className="btn btn-primary btn-sm">Approve</button>
                        <button type="submit" name="decision" value="rejected" className="btn btn-danger btn-sm">Reject</button>
                      </div>
                    </ActionForm>
                  )}
                  {canDelete && !evidence && (
                    <ActionForm action={deleteDocument} confirm={`Delete "${doc.title}"? This cannot be undone.`} submitLabel="Delete" submitClass="btn btn-danger btn-sm">
                      <input type="hidden" name="document_id" value={doc.id} />
                    </ActionForm>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

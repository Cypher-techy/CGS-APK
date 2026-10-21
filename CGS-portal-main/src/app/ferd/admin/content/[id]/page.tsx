import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { formatBytes } from "@/lib/format";
import { deleteContent, deleteFile, updateFile } from "@/modules/ferd/admin-actions";
import { CONTENT_STATUS, displayStatus } from "@/modules/ferd/constants";
import { CONTENT_COLUMNS } from "@/modules/ferd/content";
import { ContentEditor } from "@/modules/ferd/ContentEditor";
import { FileUploader } from "@/modules/ferd/FileUploader";
import { requireStaff } from "@/modules/ferd/session";

/** Content editor. `/ferd/admin/content/new` creates an item; any other id edits it and manages its files. */
export default async function FerdAdminContentEditPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; uploaded?: string; upload?: string }> }) {
  const { id } = await params;
  const { created, uploaded, upload } = await searchParams;
  const { supabase, departments, role } = await requireStaff(["department_admin", "content_manager", "opportunities_manager", "project_manager"]);
  const isNew = id === "new";
  if (!isNew && !/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [{ data: row }, { data: courses }, { data: products }, { data: files }] = await Promise.all([
    isNew ? Promise.resolve({ data: null }) : supabase.from("ferd_content").select(`${CONTENT_COLUMNS}, body`).eq("id", id).maybeSingle(),
    supabase.from("ferd_courses").select("id, code, title, department_id").eq("is_active", true).order("code"),
    supabase.from("ferd_products").select("id, name, price_kes").order("name"),
    isNew ? Promise.resolve({ data: [] }) : supabase.from("ferd_files").select("id, kind, file_name, size_bytes, caption, sort_order").eq("content_id", id).order("kind").order("sort_order"),
  ]);
  if (!isNew && !row) notFound();
  const canSetPremium = role === "super_admin" || role === "department_admin";

  return (
    <div className="space-y-5">
      <PageHeader
        title={isNew ? "New content" : row!.title}
        description={
          isNew ? "Fill in the details and attach its files or photos. Everything is saved when you press Create." : (
            <span className="flex items-center gap-2">
              <StatusBadge map={CONTENT_STATUS} value={displayStatus(row!)} />
              <Link href={`/ferd/content/${id}`} className="link">View as a student</Link>
            </span>
          )
        }
        actions={<Link href="/ferd/admin/content" className="btn btn-secondary">Back to the library</Link>}
      />
      {created && upload !== "failed" && (
        <p className="alert alert-success" role="status">
          {Number(uploaded) > 0 ? `Created, with ${Number(uploaded)} file${Number(uploaded) === 1 ? "" : "s"} uploaded.` : "Created. You can attach files and photos under “Files and photos” below."}
        </p>
      )}
      {upload === "failed" && <p className="alert alert-error" role="alert">The item was created, but not all of its files were uploaded. Check the list under “Files and photos” below and upload the missing ones again.</p>}
      <Card>
        <ContentEditor row={row ?? undefined} departments={departments} courses={courses ?? []} products={products ?? []} canSetPremium={canSetPremium} />
      </Card>

      {!isNew && (
        <>
          <Card title="Files and photos" pad={false}>
            {(files ?? []).length === 0 ? (
              <EmptyState title="No files attached">Upload PDFs, documents, datasets or gallery photos below.</EmptyState>
            ) : (
              <ul className="divide-y divide-subtle-border">
                {(files ?? []).map((file) => (
                  <li key={file.id} className="flex flex-wrap items-end justify-between gap-3 px-4 py-3 sm:px-5">
                    <div className="min-w-0 text-sm">
                      <a href={`/api/ferd/files/${file.id}`} className="link block truncate">{file.file_name}</a>
                      <span className="text-xs text-muted-grey">{file.kind === "image" ? "Gallery photo" : "Attachment"} · {formatBytes(file.size_bytes)}</span>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <ActionForm action={updateFile} submitLabel="Save" submitClass="btn btn-secondary btn-sm" className="flex flex-wrap items-end gap-2" resetOnSuccess={false}>
                        <input type="hidden" name="file_id" value={file.id} />
                        <label>
                          <span className="label">Caption / display name</span>
                          <input name="caption" className="input" maxLength={300} defaultValue={file.caption ?? ""} />
                        </label>
                        <label>
                          <span className="label">Order</span>
                          <input name="sort_order" type="number" min={0} max={999} className="input w-20" defaultValue={file.sort_order} />
                        </label>
                      </ActionForm>
                      <ActionForm action={deleteFile} submitLabel="Remove" submitClass="btn btn-danger btn-sm" confirm={`Remove “${file.file_name}”? This cannot be undone.`}>
                        <input type="hidden" name="file_id" value={file.id} />
                      </ActionForm>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-subtle-border p-4 sm:p-5">
              <FileUploader contentId={id} />
              <p className="mt-3 text-xs text-muted-grey">
                Files are stored privately. Students reach them only through a link the server creates after checking their access, and the link expires after one minute.
                Upload only material that CGS / FERD has permission to distribute, and only photos of people who agreed to be shown.
              </p>
            </div>
          </Card>

          <Card title="Delete">
            <p className="text-sm text-muted-grey">Deleting removes the item and all its files for everyone. To hide it and keep it, set the status to Unpublished or Archived instead.</p>
            <ActionForm action={deleteContent} submitLabel="Delete this item" submitClass="btn btn-danger" className="mt-3" confirm="Delete this item and all its files permanently?">
              <input type="hidden" name="id" value={id} />
            </ActionForm>
          </Card>
        </>
      )}
    </div>
  );
}

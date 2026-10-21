import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireActive } from "@/lib/auth";
import { DOCUMENT_STATUS } from "@/lib/constants";
import { DOCUMENT_COLUMNS, DocumentTable } from "@/modules/documents/DocumentTable";

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const { supabase, profile } = await requireActive();
  const { q = "", status = "" } = await searchParams;

  // Monitoring photographs are shown with their field report, not here.
  let query = supabase.from("documents").select(DOCUMENT_COLUMNS).is("monitoring_record_id", null).order("created_at", { ascending: false }).limit(300);
  if (status in DOCUMENT_STATUS) query = query.eq("review_status", status);
  const term = q.trim().replace(/[%,()]/g, " ").slice(0, 80);
  if (term) query = query.or(`title.ilike.%${term}%,file_name.ilike.%${term}%`);
  const { data: documents, error } = await query;
  if (error) throw new Error(error.message);

  return (
    <>
      <PageHeader
        title="Documents"
        description="Documents of the projects you take part in. Files are stored privately; upload new documents from the Documents tab of a project."
      />
      <Card pad={false}>
        <form className="flex flex-wrap items-end gap-3 border-b border-subtle-border p-4">
          <label className="min-w-40 flex-1">
            <span className="label">Search</span>
            <input name="q" defaultValue={q} placeholder="Title or file name" className="input" />
          </label>
          <label>
            <span className="label">Review status</span>
            <select name="status" defaultValue={status} className="input">
              <option value="">All</option>
              {Object.entries(DOCUMENT_STATUS).map(([value, { label }]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn btn-secondary">Apply</button>
          {(q || status) && <Link href="/dashboard/documents" className="btn btn-secondary">Clear</Link>}
        </form>
        <DocumentTable documents={documents} viewer={profile} empty={q || status ? "No documents match these filters." : "No documents have been uploaded yet."} />
      </Card>
    </>
  );
}

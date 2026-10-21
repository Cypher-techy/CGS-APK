import Link from "next/link";
import { MONITORING_LIST_COLUMNS, MonitoringTable } from "@/components/lists";
import { Card, PageHeader } from "@/components/ui";
import { requireActive } from "@/lib/auth";
import { MONITORING_STATUS, OBSERVATION_TYPES } from "@/lib/constants";

const HEADINGS: Record<string, [string, string]> = {
  project_owner: ["Monitoring Updates", "Field reports for your projects that have been reviewed and approved by the project manager."],
  field_officer: ["Field Monitoring", "Your field reports and their review status."],
};

export default async function MonitoringPage({ searchParams }: { searchParams: Promise<{ status?: string; type?: string }> }) {
  const { supabase, profile } = await requireActive();
  const { status = "", type = "" } = await searchParams;
  const canRecord = ["field_officer", "project_manager", "super_admin"].includes(profile.role);
  const [title, description] = HEADINGS[profile.role] ?? ["Monitoring", "Field reports across your projects. Reports awaiting review are listed first."];

  let query = supabase
    .from("monitoring_records")
    .select(MONITORING_LIST_COLUMNS)
    .order("review_status")
    .order("observation_date", { ascending: false })
    .limit(300);
  if (status in MONITORING_STATUS) query = query.eq("review_status", status);
  if (type in OBSERVATION_TYPES) query = query.eq("observation_type", type);
  const { data: records, error } = await query;
  if (error) throw new Error(error.message);

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={
          canRecord && (
            <>
              <Link href="/dashboard/monitoring/offline" className="btn btn-secondary">Offline capture</Link>
              <Link href="/dashboard/monitoring/new" className="btn btn-primary">New field report</Link>
            </>
          )
        }
      />
      <p className="alert alert-info mb-4">
        Monitoring records are project evidence reviewed within CGS. They are not independent verification or certification.
      </p>
      <Card pad={false}>
        <form className="flex flex-wrap items-end gap-3 border-b border-subtle-border p-4">
          <label>
            <span className="label">Observation type</span>
            <select name="type" defaultValue={type} className="input">
              <option value="">All types</option>
              {Object.entries(OBSERVATION_TYPES).map(([value, { label }]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          {canRecord && (
            <label>
              <span className="label">Review status</span>
              <select name="status" defaultValue={status} className="input">
                <option value="">All</option>
                {Object.entries(MONITORING_STATUS).map(([value, { label }]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
          )}
          <button type="submit" className="btn btn-secondary">Apply</button>
          {(status || type) && <Link href="/dashboard/monitoring" className="btn btn-secondary">Clear</Link>}
        </form>
        <MonitoringTable records={records} empty="No monitoring reports to show." />
      </Card>
    </>
  );
}

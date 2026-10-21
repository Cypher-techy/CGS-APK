import { Card, EmptyState, PageHeader } from "@/components/ui";
import { requireActive } from "@/lib/auth";
import { buildReport, REPORT_TYPES, type ReportType } from "@/modules/reports/data";

const PREVIEW_ROWS = 50;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; project?: string; from?: string; to?: string }>;
}) {
  const { supabase } = await requireActive();
  const params = await searchParams;
  const type = (params.type && params.type in REPORT_TYPES ? params.type : "projects") as ReportType;

  const [{ data: projects }, report] = await Promise.all([
    supabase.from("projects").select("id, name, code").order("name"),
    buildReport(supabase, type, params),
  ]);

  const query = new URLSearchParams({ type });
  for (const key of ["project", "from", "to"] as const) if (params[key]) query.set(key, params[key]!);

  return (
    <>
      <PageHeader
        title="Reports"
        description="Reports are generated from current database records for the projects you are authorised to see."
        actions={
          <>
            <a href={`/api/reports?${query}&format=csv`} className="btn btn-secondary">Export CSV</a>
            <a href={`/api/reports?${query}&format=pdf`} className="btn btn-secondary">Export PDF</a>
          </>
        }
      />
      <Card>
        <form className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label>
            <span className="label">Report</span>
            <select name="type" defaultValue={type} className="input">
              {Object.entries(REPORT_TYPES).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">Project</span>
            <select name="project" defaultValue={params.project ?? ""} className="input">
              <option value="">All my projects</option>
              {(projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">From</span>
            <input name="from" type="date" defaultValue={params.from ?? ""} className="input" />
          </label>
          <label>
            <span className="label">To</span>
            <input name="to" type="date" defaultValue={params.to ?? ""} className="input" />
          </label>
          <button type="submit" className="btn btn-primary">Generate</button>
        </form>
        <p className="hint">The date range applies to: {report.dateField.toLowerCase()}.</p>
      </Card>

      <div className="mt-5 space-y-5">
        <Card title={`${report.title}: summary`}>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 lg:grid-cols-4">
            {report.summary.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-grey">{label}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums text-heading">{value}</dd>
              </div>
            ))}
          </dl>
          {report.notes.map((note) => (
            <p key={note} className="mt-3 text-xs text-muted-grey">Note: {note}</p>
          ))}
        </Card>

        <Card title="Records" pad={false}>
          {report.rows.length === 0 ? (
            <EmptyState title="No records match this selection." />
          ) : (
            <>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      {report.columns.map((column) => (
                        <th key={column}>{column}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.slice(0, PREVIEW_ROWS).map((row, i) => (
                      <tr key={i}>
                        {row.map((value, j) => (
                          <td key={j} className="max-w-xs">{String(value) || "—"}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {report.rows.length > PREVIEW_ROWS && (
                <p className="border-t border-subtle-border px-4 py-2.5 text-xs text-muted-grey">
                  Showing the first {PREVIEW_ROWS} of {report.rows.length} records. Export the report to see all of them.
                </p>
              )}
            </>
          )}
        </Card>
      </div>
    </>
  );
}

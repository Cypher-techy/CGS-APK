import Link from "next/link";
import { ActivityList, ACTIVITY_COLUMNS } from "@/components/lists";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { requireActive } from "@/lib/auth";
import { ESTIMATE_KINDS, OBSERVATION_TYPES, SCHEDULE_FREQUENCIES } from "@/lib/constants";
import { formatDate, formatNumber, isOverdue } from "@/lib/format";

export default async function MrvPage() {
  const { supabase } = await requireActive(["mrv_specialist", "project_manager", "super_admin"]);
  const [{ data: estimates }, { data: schedules }, { data: logs }] = await Promise.all([
    supabase.from("carbon_estimates").select("id, kind, period_start, period_end, estimated_tco2e, methodology, created_at, project_id, project:projects(name, code)").order("created_at", { ascending: false }).limit(200),
    supabase.from("monitoring_schedules").select("id, observation_type, frequency, next_due, notes, project_id, project:projects(name, code)").order("next_due").limit(200),
    supabase.from("activity_logs").select(ACTIVITY_COLUMNS).in("entity_type", ["monitoring_record", "carbon_estimate", "listing"]).order("created_at", { ascending: false }).limit(25),
  ]);
   
  const name = (row: any) => row.project?.name ?? "—";

  return (
    <>
      <PageHeader
        title="MRV records"
        description="Carbon estimation records and monitoring schedules across your projects. Add or change them on the MRV tab of a project."
      />
      <p className="alert alert-info mb-4">
        These are estimates and internal monitoring records. The portal does not perform independent validation or verification and does not certify results.
      </p>
      <div className="space-y-5">
        <Card title="Monitoring schedule" pad={false}>
          {(schedules ?? []).length === 0 ? (
            <EmptyState title="No monitoring has been scheduled." />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Observation type</th>
                    <th>Frequency</th>
                    <th>Next due</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {(schedules ?? []).map((s) => (
                    <tr key={s.id}>
                      <td><Link href={`/dashboard/projects/${s.project_id}?tab=mrv`} className="link">{name(s)}</Link></td>
                      <td>{OBSERVATION_TYPES[s.observation_type]?.label}</td>
                      <td>{SCHEDULE_FREQUENCIES[s.frequency]}</td>
                      <td className={isOverdue(s.next_due, false) ? "font-medium text-red-300" : ""}>
                        {formatDate(s.next_due)}
                        {isOverdue(s.next_due, false) && <span className="block text-xs">Overdue</span>}
                      </td>
                      <td className="max-w-xs text-xs text-muted-grey">{s.notes ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Carbon estimation records" pad={false}>
          {(estimates ?? []).length === 0 ? (
            <EmptyState title="No carbon estimates have been recorded." />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Type</th>
                    <th>Period</th>
                    <th>Estimate (tCO₂e)</th>
                    <th>Method</th>
                    <th>Recorded</th>
                  </tr>
                </thead>
                <tbody>
                  {(estimates ?? []).map((e) => (
                    <tr key={e.id}>
                      <td><Link href={`/dashboard/projects/${e.project_id}?tab=mrv`} className="link">{name(e)}</Link></td>
                      <td>{ESTIMATE_KINDS[e.kind]}</td>
                      <td>{e.period_start || e.period_end ? `${formatDate(e.period_start)} to ${formatDate(e.period_end)}` : "—"}</td>
                      <td className="tabular-nums">
                        {formatNumber(e.estimated_tco2e, 2)}
                        <div className="text-xs text-muted-grey">Estimate, not verified</div>
                      </td>
                      <td className="max-w-sm text-xs">{e.methodology}</td>
                      <td>{formatDate(e.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Audit trail (monitoring, estimates, listing stages)" pad={false}>
          <ActivityList logs={logs ?? []} empty="No audit entries are visible to you yet." />
        </Card>
      </div>
    </>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { Card, DetailList, Field, PageHeader, StatusBadge } from "@/components/ui";
import { requireActive } from "@/lib/auth";
import { MONITORING_STATUS, OBSERVATION_TYPES } from "@/lib/constants";
import { formatBytes, formatDate, formatDateTime, formatNumber, today } from "@/lib/format";
import { reviewMonitoringRecord } from "@/modules/monitoring/actions";
import { MonitoringForm } from "@/modules/monitoring/MonitoringForm";

export default async function MonitoringRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await requireActive();

  const { data: record } = await supabase
    .from("monitoring_records")
    .select(
      "*, project:projects(id, name, code, manager_id), recorder:profiles!monitoring_records_recorded_by_fkey(full_name), reviewer:profiles!monitoring_records_reviewed_by_fkey(full_name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!record) notFound();

  const { data: sites } = await supabase.from("project_sites").select("id, project_id, name, latitude, longitude").eq("project_id", record.project_id).order("name");
  const { data: photos } = await supabase
    .from("documents")
    .select("id, file_name, size_bytes")
    .eq("monitoring_record_id", id)
    .order("created_at");

  const type = OBSERVATION_TYPES[record.observation_type];
  const measurements = (record.measurements ?? {}) as Record<string, string | number>;
  const canReview = profile.role === "super_admin" || (profile.role === "project_manager" && record.project.manager_id === profile.id);
  const canCorrect = record.recorded_by === profile.id && record.review_status !== "approved";
  const survival =
    record.observation_type === "tree_survival" && Number(measurements.trees_assessed) > 0 && measurements.trees_surviving !== undefined
      ? (100 * Number(measurements.trees_surviving)) / Number(measurements.trees_assessed)
      : null;

  return (
    <>
      <PageHeader
        title={`${type?.label ?? record.observation_type} report`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge map={MONITORING_STATUS} value={record.review_status} />
            <span>{record.project.name} · {formatDate(record.observation_date)}</span>
          </span>
        }
        crumbs={[{ label: "Monitoring", href: "/dashboard/monitoring" }, { label: "Field report" }]}
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Observation">
            <DetailList
              items={[
                ["Project", <Link key="p" href={`/dashboard/projects/${record.project_id}?tab=monitoring`} className="link">{record.project.name} ({record.project.code})</Link>],
                ["Observation date", formatDate(record.observation_date)],
                ["Recorded by", record.recorder?.full_name],
                ["Submitted", formatDateTime(record.created_at)],
                ["GPS coordinates", record.latitude !== null && record.longitude !== null ? `${record.latitude}, ${record.longitude}` : "Not recorded"],
                ["Basis of the figures", record.value_basis === "measured" ? "Measured in the field" : "Estimated"],
                ["Method", record.methodology],
              ]}
            />
            <h3 className="section-title mt-5">Description</h3>
            <p className="prose-block mt-1">{record.description}</p>
          </Card>

          {type && type.fields.length > 0 && (
            <Card title={`Measurements (${record.value_basis})`} pad={false}>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Measurement</th>
                      <th>Value</th>
                      <th>Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {type.fields.map((field) => {
                      const value = measurements[field.key];
                      return (
                        <tr key={field.key}>
                          <td>{field.label}</td>
                          <td className="tabular-nums">{value === undefined ? "Not recorded" : typeof value === "number" ? formatNumber(value, 2) : value}</td>
                          <td>{field.unit ?? "—"}</td>
                        </tr>
                      );
                    })}
                    {survival !== null && (
                      <tr>
                        <td>Survival rate (trees surviving ÷ trees assessed)</td>
                        <td className="tabular-nums">{formatNumber(survival, 1)}</td>
                        <td>%</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card title="Photographs and evidence">
            {(photos ?? []).length === 0 ? (
              <p className="text-sm text-muted-grey">No photographs were attached to this report.</p>
            ) : (
              <ul className="space-y-2">
                {(photos ?? []).map((photo) => (
                  <li key={photo.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate">
                      {photo.file_name} <span className="text-xs text-muted-grey">({formatBytes(photo.size_bytes)})</span>
                    </span>
                    <a href={`/api/documents/${photo.id}`} className="btn btn-secondary btn-sm">View / download</a>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {canCorrect && (
            <Card title={record.review_status === "revision_required" ? "Correct and resubmit" : "Edit report"}>
              <MonitoringForm
                projects={[{ id: record.project.id, name: record.project.name, code: record.project.code }]}
                sites={sites ?? []}
                maxDate={today()}
                initial={{
                  id: record.id,
                  project_id: record.project_id,
                  site_id: record.site_id,
                  observation_type: record.observation_type,
                  observation_date: record.observation_date,
                  latitude: record.latitude,
                  longitude: record.longitude,
                  description: record.description,
                  value_basis: record.value_basis,
                  methodology: record.methodology,
                  measurements,
                }}
              />
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <Card title="Review">
            <DetailList
              items={[
                ["Status", <StatusBadge key="s" map={MONITORING_STATUS} value={record.review_status} />],
                ["Reviewed by", record.reviewer?.full_name ?? (record.reviewed_at ? "CGS reviewer" : "Not yet reviewed")],
                ["Reviewed on", formatDateTime(record.reviewed_at)],
              ]}
            />
            {record.review_notes && (
              <>
                <h3 className="section-title mt-4">Reviewer notes</h3>
                <p className="prose-block mt-1">{record.review_notes}</p>
              </>
            )}
            <p className="mt-4 text-xs text-muted-grey">
              Review by the project manager is an internal quality check. It is not independent verification.
            </p>
          </Card>

          {canReview && record.review_status === "submitted" && (
            <Card title="Review this report">
              <ActionForm action={reviewMonitoringRecord} className="space-y-3">
                <input type="hidden" name="record_id" value={record.id} />
                <Field label="Review notes" hint="Required when asking for a correction.">
                  <textarea name="review_notes" className="input" rows={3} maxLength={2000} />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <button type="submit" name="decision" value="approved" className="btn btn-primary">Approve</button>
                  <button type="submit" name="decision" value="revision_required" className="btn btn-secondary">Request correction</button>
                </div>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

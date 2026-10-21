import { MILESTONE_STATUS, MONITORING_STATUS, OBSERVATION_TYPES, PROJECT_STATUS, TASK_PRIORITY, TASK_STATUS } from "@/lib/constants";
import { formatDate, humanize, isOverdue } from "@/lib/format";
import type { Supabase } from "@/lib/supabase/server";

export const REPORT_TYPES = {
  projects: "Project summary",
  tasks: "Task completion",
  milestones: "Milestones",
  monitoring: "Environmental field reports",
  approvals: "Project approval decisions",
  gis: "GIS and land area summary",
  carbon: "Carbon estimation records",
  finance: "Financial and benefit-sharing records",
} as const;
export type ReportType = keyof typeof REPORT_TYPES;

export interface ReportFilters {
  project?: string;
  from?: string;
  to?: string;
}

export interface Report {
  title: string;
  /** What the date range applies to, e.g. "Observation date". */
  dateField: string;
  columns: string[];
  rows: (string | number)[][];
  summary: [string, string][];
  notes: string[];
  truncated: boolean;
}

const MAX_ROWS = 2000;
const isDate = (value?: string) => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isUuid = (value?: string) => !!value && /^[0-9a-f-]{36}$/i.test(value);
const percent = (part: number, total: number) => (total ? `${Math.round((100 * part) / total)}% (${part} of ${total})` : "No records");
const label = (map: Record<string, { label: string }>, value: string) => map[value]?.label ?? value;


type Row = Record<string, any>;

/**
 * Builds a report from live database records. Queries run as the signed-in user,
 * so a report only ever contains rows that user is authorised to read.
 */
export async function buildReport(supabase: Supabase, type: ReportType, filters: ReportFilters): Promise<Report> {
  const project = isUuid(filters.project) ? filters.project : undefined;
  const from = isDate(filters.from) ? filters.from : undefined;
  const to = isDate(filters.to) ? filters.to : undefined;


  const scope = (query: any, projectColumn: string, dateColumn: string, timestamp: boolean) => {
    if (project) query = query.eq(projectColumn, project);
    if (from) query = query.gte(dateColumn, timestamp ? `${from}T00:00:00+03:00` : from);
    if (to) query = query.lte(dateColumn, timestamp ? `${to}T23:59:59+03:00` : to);
    return query.limit(MAX_ROWS + 1);
  };
  const finish = (report: Omit<Report, "truncated" | "title">, data: Row[]): Report => ({
    ...report,
    title: REPORT_TYPES[type],
    truncated: data.length > MAX_ROWS,
    rows: report.rows.slice(0, MAX_ROWS),
  });
  const fetch = async (query: PromiseLike<{ data: Row[] | null; error: { message: string } | null }>) => {
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data ?? [];
  };

  switch (type) {
    case "projects": {
      const data = await fetch(
        scope(
          supabase
            .from("projects")
            .select(
              "code, name, county, area_ha, status, progress_percent, start_date, expected_end_date, created_at, category:project_categories(name), owner:profiles!projects_owner_id_fkey(full_name), manager:profiles!projects_manager_id_fkey(full_name)",
            )
            .order("created_at", { ascending: false }),
          "id",
          "created_at",
          true,
        ),
      );
      const area = data.reduce((total, p) => total + Number(p.area_ha ?? 0), 0);
      return finish(
        {
          dateField: "Registration date",
          columns: ["Code", "Project", "Category", "County", "Area (ha)", "Status", "Progress (%)", "Owner", "Manager", "Start", "Expected completion", "Registered"],
          rows: data.map((p) => [
            p.code, p.name, p.category?.name ?? "", p.county, p.area_ha ?? "", label(PROJECT_STATUS, p.status), p.progress_percent,
            p.owner?.full_name ?? "", p.manager?.full_name ?? "", formatDate(p.start_date), formatDate(p.expected_end_date), formatDate(p.created_at),
          ]),
          summary: [
            ["Projects", String(data.length)],
            ["Total recorded land area", `${area.toLocaleString("en-KE", { maximumFractionDigits: 2 })} ha`],
            ...Object.keys(PROJECT_STATUS)
              .map((s): [string, string] => [label(PROJECT_STATUS, s), String(data.filter((p) => p.status === s).length)])
              .filter(([, n]) => n !== "0"),
          ],
          notes: ["Progress is the share of a project's tasks that are marked completed.", "Land area is as declared by the project owner and has not been surveyed by CGS."],
        },
        data,
      );
    }
    case "tasks": {
      const data = await fetch(
        scope(
          supabase
            .from("tasks")
            .select("title, priority, status, due_date, completed_at, created_at, project:projects(name, code), assignee:profiles!tasks_assigned_to_fkey(full_name)")
            .order("created_at", { ascending: false }),
          "project_id",
          "created_at",
          true,
        ),
      );
      const done = data.filter((t) => t.status === "completed").length;
      const overdue = data.filter((t) => isOverdue(t.due_date, t.status === "completed")).length;
      return finish(
        {
          dateField: "Task creation date",
          columns: ["Project", "Task", "Assigned to", "Priority", "Status", "Due date", "Completed on", "Created"],
          rows: data.map((t) => [
            t.project?.code ?? "", t.title, t.assignee?.full_name ?? "Unassigned", label(TASK_PRIORITY, t.priority), label(TASK_STATUS, t.status),
            formatDate(t.due_date), formatDate(t.completed_at), formatDate(t.created_at),
          ]),
          summary: [
            ["Tasks", String(data.length)],
            ["Completion rate", percent(done, data.length)],
            ["Overdue (not completed, past due date)", String(overdue)],
            ...Object.keys(TASK_STATUS).map((s): [string, string] => [label(TASK_STATUS, s), String(data.filter((t) => t.status === s).length)]),
          ],
          notes: ["Completion rate = completed tasks ÷ all tasks in the selection."],
        },
        data,
      );
    }
    case "milestones": {
      const data = await fetch(
        scope(
          supabase.from("milestones").select("title, due_date, status, completed_at, created_at, project:projects(name, code)").order("due_date"),
          "project_id",
          "created_at",
          true,
        ),
      );
      const done = data.filter((m) => m.status === "completed").length;
      return finish(
        {
          dateField: "Milestone creation date",
          columns: ["Project", "Milestone", "Target date", "Status", "Completed on"],
          rows: data.map((m) => [m.project?.code ?? "", m.title, formatDate(m.due_date), label(MILESTONE_STATUS, m.status), formatDate(m.completed_at)]),
          summary: [
            ["Milestones", String(data.length)],
            ["Completed", percent(done, data.length)],
            ["Overdue (pending, past target date)", String(data.filter((m) => isOverdue(m.due_date, m.status === "completed")).length)],
          ],
          notes: [],
        },
        data,
      );
    }
    case "monitoring": {
      const data = await fetch(
        scope(
          supabase
            .from("monitoring_records")
            .select(
              "observation_type, observation_date, latitude, longitude, description, measurements, value_basis, methodology, review_status, project:projects(name, code), recorder:profiles!monitoring_records_recorded_by_fkey(full_name)",
            )
            .order("observation_date", { ascending: false }),
          "project_id",
          "observation_date",
          false,
        ),
      );
      const measured = (r: Row) => {
        const fields = OBSERVATION_TYPES[r.observation_type]?.fields ?? [];
        return fields
          .filter((f) => r.measurements?.[f.key] !== undefined)
          .map((f) => `${f.label}: ${r.measurements[f.key]}${f.unit ? ` ${f.unit}` : ""}`)
          .join("; ");
      };
      return finish(
        {
          dateField: "Observation date",
          columns: ["Project", "Observation type", "Date", "Recorded by", "Basis", "Measurements", "Method", "Latitude", "Longitude", "Review status", "Description"],
          rows: data.map((r) => [
            r.project?.code ?? "", OBSERVATION_TYPES[r.observation_type]?.label ?? r.observation_type, formatDate(r.observation_date),
            r.recorder?.full_name ?? "", humanize(r.value_basis), measured(r), r.methodology ?? "", r.latitude ?? "", r.longitude ?? "",
            label(MONITORING_STATUS, r.review_status), r.description,
          ]),
          summary: [
            ["Field reports", String(data.length)],
            ["Reviewed and approved", String(data.filter((r) => r.review_status === "approved").length)],
            ["Awaiting review or correction", String(data.filter((r) => r.review_status !== "approved").length)],
            ["Based on field measurement", String(data.filter((r) => r.value_basis === "measured").length)],
            ["Based on estimates", String(data.filter((r) => r.value_basis === "estimated").length)],
          ],
          notes: [
            "The Basis column states whether figures were measured in the field or estimated.",
            "Review status reflects an internal CGS review. These records are not independently verified and do not represent verified emission reductions or issued carbon credits.",
          ],
        },
        data,
      );
    }
    case "gis": {
      const [projects, boundaries, observations] = await Promise.all([
        fetch(scope(supabase.from("projects").select("id, code, name, county, area_ha, latitude, longitude, created_at").order("code"), "id", "created_at", true)),
        fetch(supabase.from("project_boundaries").select("project_id, area_ha, source, updated_at")),
        fetch(supabase.from("monitoring_records").select("project_id").not("latitude", "is", null).limit(10000)),
      ]);
      const mapped = new Map(boundaries.map((b) => [b.project_id, b]));
      const points = new Map<string, number>();
      for (const o of observations) points.set(o.project_id, (points.get(o.project_id) ?? 0) + 1);
      const withBoundary = projects.filter((p) => mapped.has(p.id));
      const total = (values: number[]) => values.reduce((a, b) => a + b, 0).toLocaleString("en-KE", { maximumFractionDigits: 2 });
      return finish(
        {
          dateField: "Project registration date",
          columns: ["Code", "Project", "County", "Declared area (ha)", "Mapped area (ha)", "Difference (ha)", "Declared coordinates", "Georeferenced observations", "Boundary source", "Boundary updated"],
          rows: projects.map((p) => {
            const b = mapped.get(p.id);
            return [
              p.code, p.name, p.county, p.area_ha ?? "", b ? Number(b.area_ha) : "Not mapped",
              b && p.area_ha !== null ? Number((Number(b.area_ha) - Number(p.area_ha)).toFixed(2)) : "",
              p.latitude !== null && p.longitude !== null ? `${p.latitude}, ${p.longitude}` : "", points.get(p.id) ?? 0, b?.source ?? "", b ? formatDate(b.updated_at) : "",
            ];
          }),
          summary: [
            ["Projects", String(projects.length)],
            ["With mapped boundary", percent(withBoundary.length, projects.length)],
            ["Total mapped area", `${total(withBoundary.map((p) => Number(mapped.get(p.id)?.area_ha ?? 0)))} ha`],
            ["Total declared area", `${total(projects.map((p) => Number(p.area_ha ?? 0)))} ha`],
          ],
          notes: [
            "Mapped area is the geodesic area of the stored boundary polygon (PostGIS). Declared area is entered by the project owner. Neither is a legal survey.",
            "Land-use and land-cover classification is not available in this release.",
          ],
        },
        projects,
      );
    }
    case "carbon": {
      const data = await fetch(
        scope(
          supabase.from("carbon_estimates").select("kind, period_start, period_end, estimated_tco2e, methodology, assumptions, created_at, project:projects(name, code)").order("created_at", { ascending: false }),
          "project_id",
          "created_at",
          true,
        ),
      );
      return finish(
        {
          dateField: "Date recorded",
          columns: ["Project", "Type", "Period start", "Period end", "Estimate (tCO2e)", "Methodology", "Assumptions", "Recorded"],
          rows: data.map((e) => [
            e.project?.code ?? "", humanize(e.kind), formatDate(e.period_start), formatDate(e.period_end), Number(e.estimated_tco2e), e.methodology, e.assumptions ?? "", formatDate(e.created_at),
          ]),
          summary: [
            ["Estimation records", String(data.length)],
            ["Baseline estimates", String(data.filter((e) => e.kind === "baseline").length)],
            ["Carbon potential estimates", String(data.filter((e) => e.kind === "potential").length)],
            ["Monitoring period estimates", String(data.filter((e) => e.kind === "monitoring_period").length)],
          ],
          notes: [
            "All figures are estimates with the stated methodology. They are not verified emission reductions and not issued carbon credits.",
            "Estimates of different types and periods are not added together, because they can overlap.",
          ],
        },
        data,
      );
    }
    case "finance": {
      const data = await fetch(
        scope(
          supabase.from("financial_records").select("kind, category, description, amount, currency, record_date, payment_status, beneficiary, project:projects(name, code)").order("record_date", { ascending: false }),
          "project_id",
          "record_date",
          false,
        ),
      );
      const kinds: Record<string, string> = { budget: "Budget allocation", expense: "Expense", income: "Income", benefit_payment: "Benefit-sharing payment" };
      const total = (currency: string, kind: string, paidOnly: boolean) =>
        data.filter((r) => r.currency === currency && r.kind === kind && (!paidOnly || r.payment_status === "paid")).reduce((t, r) => t + Number(r.amount), 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const currencies = [...new Set(data.map((r) => r.currency as string))].sort();
      return finish(
        {
          dateField: "Record date",
          columns: ["Project", "Date", "Type", "Category", "Description", "Beneficiary", "Currency", "Amount", "Status"],
          rows: data.map((r) => [r.project?.code ?? "", formatDate(r.record_date), kinds[r.kind] ?? r.kind, r.category ?? "", r.description, r.beneficiary ?? "", r.currency, Number(r.amount), humanize(r.payment_status)]),
          summary: [
            ["Records", String(data.length)],
            ...currencies.flatMap((c): [string, string][] => [
              [`Budget (${c})`, total(c, "budget", false)],
              [`Expenses paid (${c})`, total(c, "expense", true)],
              [`Income received (${c})`, total(c, "income", true)],
              [`Benefit payments paid (${c})`, total(c, "benefit_payment", true)],
            ]),
          ],
          notes: [
            "Records are entered by project managers. The portal does not process payments; paid means a payment made outside the portal was recorded.",
            "Totals are per currency and are not converted. Only records you are authorised to see are included.",
          ],
        },
        data,
      );
    }
    case "approvals": {
      const data = await fetch(
        scope(
          supabase.from("approvals").select("decision, comments, created_at, project:projects(name, code)").order("created_at", { ascending: false }),
          "project_id",
          "created_at",
          true,
        ),
      );
      const count = (d: string) => String(data.filter((a) => a.decision === d).length);
      return finish(
        {
          dateField: "Decision date",
          columns: ["Project code", "Project", "Decision", "Decision date", "Comments"],
          rows: data.map((a) => [a.project?.code ?? "", a.project?.name ?? "", humanize(a.decision), formatDate(a.created_at), a.comments ?? ""]),
          summary: [
            ["Decisions recorded", String(data.length)],
            ["Approved", count("approved")],
            ["Revision requested", count("revision_required")],
            ["Rejected", count("rejected")],
          ],
          notes: ["A project can have several decisions, for example a revision request followed by an approval."],
        },
        data,
      );
    }
  }
}

/** CSV with a UTF-8 byte-order mark so that Excel opens it correctly. */
export function toCsv(report: Report): string {
  const cell = (value: string | number) => {
    let text = String(value ?? "");
    // Neutralise spreadsheet formulas in user-entered text.
    if (/^[=+\-@\t\r]/.test(text) && typeof value !== "number") text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [report.columns, ...report.rows].map((row) => row.map(cell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

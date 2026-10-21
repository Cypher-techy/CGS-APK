import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { ActivityList, ACTIVITY_COLUMNS, MONITORING_LIST_COLUMNS, MonitoringTable, TASK_LIST_COLUMNS, TaskTable } from "@/components/lists";
import { Card, EmptyState, Field, StatusBadge } from "@/components/ui";
import { DOCUMENT_CATEGORIES, MEMBER_ROLES, MILESTONE_STATUS, ROLE_LABELS } from "@/lib/constants";
import { formatDate, isOverdue } from "@/lib/format";
import type { Supabase } from "@/lib/supabase/server";
import type { Profile, Project } from "@/lib/types";
import { uploadDocument } from "@/modules/documents/actions";
import { DOCUMENT_COLUMNS, DocumentTable } from "@/modules/documents/DocumentTable";
import { addMember, removeMember } from "@/modules/projects/actions";
import { createMilestone, createTask, deleteMilestone, setMilestoneStatus } from "@/modules/tasks/actions";

export interface TabProps {
  supabase: Supabase;
  project: Project;
  viewer: Profile;
  canManage: boolean;
}

interface Person {
  id: string;
  full_name: string;
}

/** Owner, manager and team members: the people a task can be assigned to. */
async function participants(supabase: Supabase, project: Project): Promise<Person[]> {
  const [{ data: members }, { data: leads }] = await Promise.all([
    supabase.from("project_members").select("user:profiles!project_members_user_id_fkey(id, full_name)").eq("project_id", project.id),
    supabase.from("profiles").select("id, full_name").in("id", [project.owner_id, project.manager_id].filter(Boolean)),
  ]);
  const people = new Map<string, Person>();

  for (const m of (members ?? []) as any[]) if (m.user) people.set(m.user.id, m.user);
  for (const p of leads ?? []) people.set(p.id, p);
  return [...people.values()].sort((a, b) => a.full_name.localeCompare(b.full_name));
}

export async function TasksTab({ supabase, project, canManage }: TabProps) {
  const [{ data: tasks }, people, { data: milestones }] = await Promise.all([
    supabase.from("tasks").select(TASK_LIST_COLUMNS).eq("project_id", project.id).order("due_date", { nullsFirst: false }),
    canManage ? participants(supabase, project) : Promise.resolve([]),
    canManage ? supabase.from("milestones").select("id, title").eq("project_id", project.id).order("due_date") : Promise.resolve({ data: [] }),
  ]);
  return (
    <div className="space-y-5">
      <Card title="Tasks" pad={false}>
        <TaskTable tasks={tasks ?? []} showProject={false} empty="No tasks have been created for this project." />
      </Card>
      {canManage && (
        <Card title="Create a task">
          <ActionForm action={createTask} submitLabel="Create task" className="space-y-4">
            <input type="hidden" name="project_id" value={project.id} />
            <Field label="Title">
              <input name="title" className="input" required minLength={3} maxLength={160} />
            </Field>
            <Field label="Description and instructions (optional)">
              <textarea name="description" className="input" rows={3} maxLength={4000} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Assign to" hint="Add people on the Team tab first.">
                <select name="assigned_to" className="input" defaultValue="">
                  <option value="">Unassigned</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>{p.full_name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Priority">
                <select name="priority" className="input" defaultValue="medium">
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </Field>
              <Field label="Due date (optional)">
                <input name="due_date" type="date" className="input" />
              </Field>
              <Field label="Milestone (optional)">
                <select name="milestone_id" className="input" defaultValue="">
                  <option value="">None</option>
                  {(milestones ?? []).map((m) => (
                    <option key={m.id} value={m.id}>{m.title}</option>
                  ))}
                </select>
              </Field>
            </div>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}

export async function MilestonesTab({ supabase, project, canManage }: TabProps) {
  const { data: milestones } = await supabase
    .from("milestones")
    .select("id, title, description, due_date, status, completed_at")
    .eq("project_id", project.id)
    .order("due_date", { nullsFirst: false });
  return (
    <div className="space-y-5">
      <Card title="Milestones" pad={false}>
        {(milestones ?? []).length === 0 ? (
          <EmptyState title="No milestones have been defined for this project." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Milestone</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th>Completed</th>
                  {canManage && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {(milestones ?? []).map((m) => {
                  const done = m.status === "completed";
                  return (
                    <tr key={m.id}>
                      <td>
                        <span className="font-medium">{m.title}</span>
                        {m.description && <div className="mt-0.5 max-w-md text-xs text-muted-grey">{m.description}</div>}
                      </td>
                      <td className={isOverdue(m.due_date, done) ? "font-medium text-red-300" : ""}>{formatDate(m.due_date)}</td>
                      <td>
                        <StatusBadge map={MILESTONE_STATUS} value={m.status} />
                      </td>
                      <td>{formatDate(m.completed_at)}</td>
                      {canManage && (
                        <td>
                          <div className="flex flex-wrap gap-1.5">
                            <ActionForm action={setMilestoneStatus} submitLabel={done ? "Reopen" : "Mark completed"} submitClass="btn btn-secondary btn-sm">
                              <input type="hidden" name="milestone_id" value={m.id} />
                              <input type="hidden" name="status" value={done ? "pending" : "completed"} />
                            </ActionForm>
                            <ActionForm action={deleteMilestone} confirm={`Delete milestone "${m.title}"?`} submitLabel="Delete" submitClass="btn btn-danger btn-sm">
                              <input type="hidden" name="milestone_id" value={m.id} />
                            </ActionForm>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {canManage && (
        <Card title="Add a milestone">
          <ActionForm action={createMilestone} submitLabel="Add milestone" className="space-y-4">
            <input type="hidden" name="project_id" value={project.id} />
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <Field label="Title">
                  <input name="title" className="input" required minLength={3} maxLength={160} />
                </Field>
              </div>
              <Field label="Target date (optional)">
                <input name="due_date" type="date" className="input" />
              </Field>
            </div>
            <Field label="Description (optional)">
              <textarea name="description" className="input" rows={2} maxLength={2000} />
            </Field>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}

export async function DocumentsTab({ supabase, project, viewer, canUpload = true }: TabProps & { canUpload?: boolean }) {
  const { data: documents } = await supabase
    .from("documents")
    .select(DOCUMENT_COLUMNS)
    .eq("project_id", project.id)
    .order("created_at", { ascending: false });
  return (
    <div className="space-y-5">
      <Card title="Project documents" pad={false}>
        <DocumentTable documents={documents ?? []} viewer={viewer} showProject={false} empty="No documents have been uploaded for this project." />
      </Card>
      {!canUpload && <p className="text-xs text-muted-grey">Approved project reports are shown here.</p>}
      {canUpload && <Card title="Upload a document">
        <ActionForm action={uploadDocument} submitLabel="Upload" className="space-y-4">
          <input type="hidden" name="project_id" value={project.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title">
              <input name="title" className="input" required minLength={2} maxLength={160} />
            </Field>
            <Field label="Category">
              <select name="category" className="input" defaultValue="other">
                {Object.entries(DOCUMENT_CATEGORIES)
                  .filter(([value]) => value !== "monitoring_evidence")
                  .map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
              </select>
            </Field>
          </div>
          <Field label="Description (optional)">
            <input name="description" className="input" maxLength={1000} />
          </Field>
          <Field label="File" hint="PDF, DOCX, XLSX, JPG, PNG, WEBP, GeoJSON, KML, ZIP or CSV. Maximum 10 MB.">
            <input name="file" type="file" required className="input" accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png,.webp,.geojson,.kml,.zip,.csv" />
          </Field>
        </ActionForm>
      </Card>}
    </div>
  );
}

export async function MonitoringTab({ supabase, project, viewer, canManage }: TabProps) {
  const { data: records } = await supabase
    .from("monitoring_records")
    .select(MONITORING_LIST_COLUMNS)
    .eq("project_id", project.id)
    .order("observation_date", { ascending: false });
  const canRecord = canManage || viewer.role === "field_officer";
  return (
    <Card
      title="Environmental monitoring"
      pad={false}
      actions={canRecord && <Link href={`/dashboard/monitoring/new?project=${project.id}`} className="btn btn-primary btn-sm">New field report</Link>}
    >
      {!canRecord && (
        <p className="border-b border-subtle-border px-4 py-2.5 text-xs text-muted-grey sm:px-5">
          Only field reports that have been reviewed and approved by the project manager are shown here.
        </p>
      )}
      <MonitoringTable records={records ?? []} showProject={false} empty="No monitoring reports are available for this project yet." />
    </Card>
  );
}

export async function TeamTab({ supabase, project, canManage }: TabProps) {
  const [{ data: members }, { data: leads }, { data: candidates }] = await Promise.all([
    supabase
      .from("project_members")
      .select("id, user_id, member_role, created_at, user:profiles!project_members_user_id_fkey(full_name, email, phone, role)")
      .eq("project_id", project.id)
      .order("created_at"),
    supabase.from("profiles").select("id, full_name, email, phone").in("id", [project.owner_id, project.manager_id].filter(Boolean)),
    canManage
      ? supabase.from("profiles").select("id, full_name, role").eq("status", "active").in("role", ["field_officer", "project_manager", "gis_analyst", "mrv_specialist", "community_member"]).order("full_name")
      : Promise.resolve({ data: [] }),
  ]);
  const lead = (id: string | null) => (leads ?? []).find((p) => p.id === id);
  const owner = lead(project.owner_id);
  const manager = lead(project.manager_id);
  const taken = new Set([project.owner_id, project.manager_id, ...(members ?? []).map((m) => m.user_id)]);
  const available = (candidates ?? []).filter((c) => !taken.has(c.id));

  return (
    <div className="space-y-5">
      <Card title="Project team" pad={false}>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Project role</th>
                <th>Contact</th>
                {canManage && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{owner?.full_name ?? "—"}</td>
                <td>Project owner</td>
                <td className="text-xs text-muted-grey">{owner?.email}{owner?.phone ? ` · ${owner.phone}` : ""}</td>
                {canManage && <td />}
              </tr>
              <tr>
                <td>{manager?.full_name ?? "Not assigned"}</td>
                <td>Project manager</td>
                <td className="text-xs text-muted-grey">{manager?.email}{manager?.phone ? ` · ${manager.phone}` : ""}</td>
                {canManage && <td />}
              </tr>
              {((members ?? []) as any[]).map((m) => (
                <tr key={m.id}>
                  <td>{m.user?.full_name ?? "—"}</td>
                  <td>{MEMBER_ROLES[m.member_role] ?? m.member_role}</td>
                  <td className="text-xs text-muted-grey">{m.user?.email}{m.user?.phone ? ` · ${m.user.phone}` : ""}</td>
                  {canManage && (
                    <td>
                      <ActionForm action={removeMember} confirm={`Remove ${m.user?.full_name ?? "this member"} from the project?`} submitLabel="Remove" submitClass="btn btn-danger btn-sm">
                        <input type="hidden" name="member_id" value={m.id} />
                      </ActionForm>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {canManage && (
        <Card title="Add a team member">
          {available.length === 0 ? (
            <p className="text-sm text-muted-grey">There is nobody left to add. Team members must have an active account first.</p>
          ) : (
            <ActionForm action={addMember} submitLabel="Add to project" className="grid items-end gap-4 sm:grid-cols-3">
              <input type="hidden" name="project_id" value={project.id} />
              <Field label="Person">
                <select name="user_id" className="input" required defaultValue="">
                  <option value="" disabled>Select a person</option>
                  {available.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name} ({ROLE_LABELS[c.role as keyof typeof ROLE_LABELS]})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Access on this project" hint="The working role follows the person&apos;s account role.">
                <select name="access" className="input" defaultValue="role">
                  <option value="role">Working role</option>
                  <option value="observer">Observer (read-only, limited)</option>
                </select>
              </Field>
            </ActionForm>
          )}
        </Card>
      )}
    </div>
  );
}

export async function ActivityTab({ supabase, project }: TabProps) {
  const { data: logs } = await supabase
    .from("activity_logs")
    .select(ACTIVITY_COLUMNS)
    .eq("project_id", project.id)
    .order("created_at", { ascending: false })
    .limit(100);
  return (
    <Card title="Project activity history" pad={false}>
      <ActivityList logs={logs ?? []} />
    </Card>
  );
}

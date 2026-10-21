import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { Card, EmptyState, Field, PageHeader, StatusBadge } from "@/components/ui";
import { requireActive } from "@/lib/auth";
import { GRIEVANCE_STATUS } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import { submitGrievance } from "@/modules/community/actions";

export default async function CommunityPage() {
  const { supabase, profile } = await requireActive();
  const now = new Date().toISOString();
  const [{ data: projects }, { data: announcements }, { data: meetings }, { data: grievances }] = await Promise.all([
    supabase.from("projects").select("id, name, code").order("name"),
    supabase.from("project_announcements").select("id, title, body, created_at, project_id, project:projects(name)").order("created_at", { ascending: false }).limit(30),
    supabase.from("project_meetings").select("id, title, scheduled_at, location, agenda, minutes, project_id, project:projects(name)").order("scheduled_at", { ascending: false }).limit(30),
    supabase.from("grievances").select("id, kind, subject, description, status, response, created_at, project:projects(name)").eq("submitted_by", profile.id).order("created_at", { ascending: false }),
  ]);
  const { data: benefits } = await supabase.from("benefit_sharing_terms").select("id, beneficiary, share_percent, description, project_id, project:projects(name)").order("created_at");
   
  const projectName = (row: any) => row.project?.name ?? "Project";

  return (
    <>
      <PageHeader
        title="Announcements and feedback"
        description="Announcements and meetings of the projects you take part in, and the feedback or grievances you have submitted."
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <Card title="Project announcements">
            {(announcements ?? []).length === 0 ? (
              <EmptyState title="No announcements yet." />
            ) : (
              <ul className="space-y-4">
                {(announcements ?? []).map((a) => (
                  <li key={a.id}>
                    <p className="text-sm font-semibold text-heading">{a.title}</p>
                    <p className="text-xs text-muted-grey">
                      <Link href={`/dashboard/projects/${a.project_id}?tab=community`} className="link">{projectName(a)}</Link> · {formatDateTime(a.created_at)}
                    </p>
                    <p className="prose-block mt-1">{a.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Meeting schedule and records">
            {(meetings ?? []).length === 0 ? (
              <EmptyState title="No meetings have been scheduled." />
            ) : (
              <ul className="space-y-4">
                {(meetings ?? []).map((m) => (
                  <li key={m.id} className="rounded-md border border-subtle-border p-3">
                    <p className="text-sm font-semibold text-heading">{m.title}</p>
                    <p className="text-xs text-muted-grey">
                      {projectName(m)} · {formatDateTime(m.scheduled_at)} (EAT){m.location ? ` · ${m.location}` : ""} · {m.scheduled_at > now ? "Upcoming" : "Held"}
                    </p>
                    {m.agenda && <p className="prose-block mt-2"><span className="font-medium">Agenda: </span>{m.agenda}</p>}
                    {m.minutes && <p className="prose-block mt-2"><span className="font-medium">Record: </span>{m.minutes}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Send feedback or raise a grievance">
            {(projects ?? []).length === 0 ? (
              <p className="text-sm text-muted-grey">You are not yet a participant of any project. A project manager adds community members to a project.</p>
            ) : (
              <ActionForm action={submitGrievance} submitLabel="Submit" className="space-y-3">
                <Field label="Project">
                  <select name="project_id" className="input" required defaultValue="">
                    <option value="" disabled>Select a project</option>
                    {(projects ?? []).map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
                    ))}
                  </select>
                </Field>
                <Field label="Type">
                  <select name="kind" className="input" defaultValue="feedback">
                    <option value="feedback">Feedback</option>
                    <option value="grievance">Grievance</option>
                  </select>
                </Field>
                <Field label="Subject">
                  <input name="subject" className="input" required minLength={3} maxLength={160} />
                </Field>
                <Field label="Details" hint="Seen only by you, the project manager and CGS administrators.">
                  <textarea name="description" className="input" rows={4} required minLength={10} maxLength={4000} />
                </Field>
              </ActionForm>
            )}
          </Card>
          <Card title="My submissions">
            {(grievances ?? []).length === 0 ? (
              <EmptyState title="You have not submitted anything yet." />
            ) : (
              <ul className="space-y-4">
                {(grievances ?? []).map((g) => (
                  <li key={g.id} className="rounded-md border border-subtle-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-heading">{g.subject}</p>
                      <StatusBadge map={GRIEVANCE_STATUS} value={g.status} />
                    </div>
                    <p className="text-xs capitalize text-muted-grey">{g.kind} · {projectName(g)} · {formatDateTime(g.created_at)}</p>
                    <p className="prose-block mt-2">{g.description}</p>
                    {g.response && <p className="prose-block mt-2"><span className="font-medium">Response: </span>{g.response}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      <div className="mt-5">
        <Card title="Benefit-sharing arrangements">
          {(benefits ?? []).length === 0 ? (
            <EmptyState title="No benefit-sharing terms have been recorded for your projects." />
          ) : (
            <ul className="space-y-3">
              {(benefits ?? []).map((b) => (
                <li key={b.id} className="text-sm">
                  <span className="font-semibold text-heading">{b.beneficiary}</span>
                  {b.share_percent !== null && <span> · {Number(b.share_percent)}%</span>}
                  <span className="text-xs text-muted-grey"> · </span>
                  <Link href={`/dashboard/projects/${b.project_id}?tab=finance`} className="link text-xs">{projectName(b)}</Link>
                  <p className="prose-block mt-0.5">{b.description}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

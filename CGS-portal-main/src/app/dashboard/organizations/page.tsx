import { BadgeCheck } from "lucide-react";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, EmptyState, Field, PageHeader } from "@/components/ui";
import { requireActive } from "@/lib/auth";
import { ORGANIZATION_KINDS } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { COUNTRIES } from "@/modules/geo/places";
import { addOrganizationMember, createOrganization, deleteOrganization, removeOrganizationMember, setOrganizationVerified } from "@/modules/organizations/actions";


type Row = Record<string, any>;

/** Organizations: administrators see and verify all of them; other users see and manage their own. */
export default async function OrganizationsPage() {
  const { supabase, profile } = await requireActive();
  const isAdmin = profile.role === "super_admin";
  const [{ data: organizations }, { data: memberships }, { data: projects }] = await Promise.all([
    supabase.from("organizations").select("id, name, kind, country, county, website, description, is_verified, verified_at, created_at").order("name"),
    supabase.from("organization_members").select("organization_id, user_id, member_role, member:profiles!organization_members_user_id_fkey(full_name, email)"),
    supabase.from("projects").select("id, organization_id").not("organization_id", "is", null),
  ]);
  const members = (memberships ?? []) as Row[];
  const mine = new Map(members.filter((m) => m.user_id === profile.id).map((m) => [m.organization_id, m.member_role]));
  const shown = ((organizations ?? []) as Row[]).filter((o) => isAdmin || mine.has(o.id));
  const projectCount = (id: string) => (projects ?? []).filter((p) => p.organization_id === id).length;

  return (
    <>
      <PageHeader
        title="Organizations"
        description={
          isAdmin
            ? "Every organization registered on CGS. Verify an organization once you have confirmed it is genuine; only verified names are shown publicly."
            : "The organizations you belong to. Projects can be registered under an organization, and CGS verifies each organization before its name is shown publicly."
        }
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {shown.length === 0 ? (
            <Card>
              <EmptyState title={isAdmin ? "No organizations registered." : "You do not belong to an organization yet."}>
                Register your organization with the form on this page. You become its administrator and can add colleagues by e-mail.
              </EmptyState>
            </Card>
          ) : (
            shown.map((org) => {
              const team = members.filter((m) => m.organization_id === org.id);
              const canAdminister = isAdmin || mine.get(org.id) === "admin";
              return (
                <Card key={org.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="flex items-center gap-2 text-lg font-semibold text-heading">
                        {org.is_verified && <BadgeCheck className="h-5 w-5 text-primary-green" aria-hidden="true" />}
                        {org.name}
                      </h2>
                      <p className="mt-0.5 text-xs text-muted-grey">
                        {ORGANIZATION_KINDS[org.kind] ?? org.kind} · {[org.county, org.country].filter(Boolean).join(", ")} · {projectCount(org.id)} project{projectCount(org.id) === 1 ? "" : "s"} visible to you · registered {formatDate(org.created_at)}
                      </p>
                    </div>
                    <Badge tone={org.is_verified ? "success" : "warning"}>{org.is_verified ? `Verified ${formatDate(org.verified_at)}` : "Awaiting CGS verification"}</Badge>
                  </div>
                  {org.description && <p className="mt-3 text-sm text-charcoal">{org.description}</p>}
                  {org.website && (
                    <p className="mt-1 text-sm">
                      <a href={org.website} target="_blank" rel="noopener noreferrer nofollow" className="link">{org.website}</a>
                    </p>
                  )}

                  <h3 className="section-title mt-5">Members</h3>
                  {team.length === 0 ? (
                    <p className="mt-1 text-sm text-muted-grey">No members.</p>
                  ) : (
                    <ul className="mt-2 divide-y divide-subtle-border rounded-xl border border-subtle-border">
                      {team.map((m) => (
                        <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                          <span>
                            {m.member?.full_name ?? "Member"} <span className="text-xs text-muted-grey">{m.member?.email}</span>
                          </span>
                          <span className="flex items-center gap-2">
                            <Badge tone={m.member_role === "admin" ? "info" : "neutral"}>{m.member_role === "admin" ? "Administrator" : "Member"}</Badge>
                            {(canAdminister || m.user_id === profile.id) && (
                              <ActionForm action={removeOrganizationMember} confirm="Remove this person from the organization?" submitLabel={m.user_id === profile.id ? "Leave" : "Remove"} submitClass="btn btn-danger btn-sm">
                                <input type="hidden" name="organization_id" value={org.id} />
                                <input type="hidden" name="user_id" value={m.user_id} />
                              </ActionForm>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {canAdminister && (
                    <ActionForm action={addOrganizationMember} submitLabel="Add member" submitClass="btn btn-secondary" className="mt-4 flex flex-wrap items-end gap-3">
                      <input type="hidden" name="organization_id" value={org.id} />
                      <Field label="E-mail of an active CGS account">
                        <input name="email" type="email" className="input" required maxLength={160} />
                      </Field>
                      <Field label="Role">
                        <select name="member_role" className="input" defaultValue="member">
                          <option value="member">Member</option>
                          <option value="admin">Administrator</option>
                        </select>
                      </Field>
                    </ActionForm>
                  )}

                  {isAdmin && (
                    <div className="mt-4 flex flex-wrap gap-2 border-t border-subtle-border pt-4">
                      <ActionForm action={setOrganizationVerified} submitLabel={org.is_verified ? "Withdraw verification" : "Verify organization"} submitClass={org.is_verified ? "btn btn-secondary" : "btn btn-primary"}>
                        <input type="hidden" name="organization_id" value={org.id} />
                        <input type="hidden" name="verified" value={org.is_verified ? "false" : "true"} />
                      </ActionForm>
                      <ActionForm action={deleteOrganization} confirm={`Delete ${org.name}? Its projects are kept without an organization.`} submitLabel="Delete" submitClass="btn btn-danger">
                        <input type="hidden" name="organization_id" value={org.id} />
                      </ActionForm>
                    </div>
                  )}
                </Card>
              );
            })
          )}
        </div>

        <Card title="Register an organization">
          <ActionForm action={createOrganization} submitLabel="Register organization" className="space-y-4">
            <Field label="Name">
              <input name="name" className="input" required minLength={2} maxLength={160} />
            </Field>
            <Field label="Type">
              <select name="kind" className="input" defaultValue="company">
                {Object.entries(ORGANIZATION_KINDS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </Field>
            <Field label="Country">
              <select name="country" className="input" defaultValue="Kenya">
                {COUNTRIES.map((c) => (
                  <option key={c.iso2} value={c.name}>{c.name}</option>
                ))}
              </select>
            </Field>
            <Field label="County or region (optional)">
              <input name="county" className="input" maxLength={80} />
            </Field>
            <Field label="Website (optional)" hint="Starting with https://">
              <input name="website" type="url" className="input" maxLength={200} />
            </Field>
            <Field label="Description (optional)">
              <textarea name="description" className="input" rows={3} maxLength={1000} />
            </Field>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}

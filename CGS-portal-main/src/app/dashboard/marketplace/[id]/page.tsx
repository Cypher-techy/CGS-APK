import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { Card, DetailList, Field, PageHeader, StatusBadge } from "@/components/ui";
import { requireActive } from "@/lib/auth";
import { DEVELOPMENT_STAGES, EVIDENCE_STAGES, INTEREST_KINDS, INTEREST_STATUS } from "@/lib/constants";
import { formatDate, formatNumber } from "@/lib/format";
import { submitInterest, toggleSaved } from "@/modules/marketplace/actions";

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await requireActive(["investor", "super_admin"]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [{ data: rows }, { data: saved }, { data: mine }] = await Promise.all([
    supabase.rpc("marketplace_browse").eq("project_id", id),
    supabase.from("marketplace_saved").select("project_id").eq("project_id", id).maybeSingle(),
    supabase.from("marketplace_interests").select("id, kind, status, created_at").eq("project_id", id).eq("investor_id", profile.id).order("created_at", { ascending: false }),
  ]);
  const listing = rows?.[0];
  if (!listing) notFound();
  const isInvestor = profile.role === "investor";
  const evidenced = EVIDENCE_STAGES.includes(listing.development_stage);

  return (
    <>
      <PageHeader
        title={listing.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{listing.code}</span>
            <StatusBadge map={DEVELOPMENT_STAGES} value={listing.development_stage} />
          </span>
        }
        crumbs={[{ label: "Marketplace", href: "/dashboard/marketplace" }, { label: listing.code }]}
        actions={
          isInvestor && (
            <ActionForm action={toggleSaved} submitLabel={saved ? "Remove from saved" : "Save project"} submitClass="btn btn-secondary">
              <input type="hidden" name="project_id" value={id} />
              <input type="hidden" name="saved" value={String(!!saved)} />
            </ActionForm>
          )
        }
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Project profile">
            <p className="prose-block">{listing.summary}</p>
            <div className="mt-5">
              <DetailList
                items={[
                  ["Category", listing.category],
                  ["County", listing.county],
                  ["Declared area", listing.declared_area_ha !== null ? `${formatNumber(listing.declared_area_ha, 2)} ha` : null],
                  ["Mapped boundary area", listing.mapped_area_ha !== null ? `${formatNumber(listing.mapped_area_ha, 2)} ha` : "Not mapped"],
                  ["Planned start", formatDate(listing.start_date)],
                  ["Reviewed field reports on record", String(listing.approved_monitoring_records)],
                ]}
              />
            </div>
            <h3 className="section-title mt-5">Description</h3>
            <p className="prose-block mt-1">{listing.description}</p>
            {listing.objectives && (
              <>
                <h3 className="section-title mt-5">Objectives</h3>
                <p className="prose-block mt-1">{listing.objectives}</p>
              </>
            )}
            {listing.eligibility_notes && (
              <>
                <h3 className="section-title mt-5">Eligibility information</h3>
                <p className="prose-block mt-1">{listing.eligibility_notes}</p>
              </>
            )}
          </Card>

          <Card title="Estimated carbon potential">
            {listing.estimated_tco2e === null ? (
              <p className="text-sm text-muted-grey">No carbon potential assessment has been recorded for this project.</p>
            ) : (
              <>
                <p className="text-2xl font-semibold tabular-nums text-heading">{formatNumber(listing.estimated_tco2e, 0)} tCO₂e</p>
                <p className="text-xs font-medium uppercase tracking-wide text-amber-200">Estimate — not verified, not issued credits</p>
                <h3 className="section-title mt-4">Method</h3>
                <p className="prose-block mt-1">{listing.estimate_methodology}</p>
                {listing.estimate_assumptions && (
                  <>
                    <h3 className="section-title mt-4">Assessment assumptions</h3>
                    <p className="prose-block mt-1">{listing.estimate_assumptions}</p>
                  </>
                )}
                <p className="mt-3 text-xs text-muted-grey">Recorded {formatDate(listing.estimate_date)} by the project team.</p>
              </>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Validation and verification status">
            <DetailList
              items={[
                ["Development stage", <StatusBadge key="d" map={DEVELOPMENT_STAGES} value={listing.development_stage} />],
                ["Standard", listing.standard ?? "None stated"],
                ["Supporting evidence on file", listing.has_stage_evidence ? "Yes, held by CGS" : "No"],
              ]}
            />
            <p className="mt-4 text-xs text-muted-grey">
              {evidenced
                ? "This stage was recorded with a named standard and a supporting document. Request the document during due diligence and confirm it with the standard's registry."
                : "This project has not been independently validated or verified. Monitoring recorded in the portal is internal project evidence."}
            </p>
          </Card>

          {isInvestor ? (
            <Card title="Send an enquiry">
              <ActionForm action={submitInterest} submitLabel="Send enquiry" className="space-y-3">
                <input type="hidden" name="project_id" value={id} />
                <Field label="Type">
                  <select name="kind" className="input">
                    {Object.entries(INTEREST_KINDS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Message" hint="Introduce your organisation and what you are looking for. CGS and the project owner will see this.">
                  <textarea name="message" className="input" rows={5} required minLength={20} maxLength={3000} />
                </Field>
              </ActionForm>
              {(mine ?? []).length > 0 && (
                <div className="mt-4 border-t border-subtle-border pt-3">
                  <p className="section-title">Your enquiries on this project</p>
                  <ul className="mt-2 space-y-1.5 text-sm">
                    {(mine ?? []).map((i) => (
                      <li key={i.id} className="flex items-center justify-between gap-2">
                        <span>{INTEREST_KINDS[i.kind]} · {formatDate(i.created_at)}</span>
                        <StatusBadge map={INTEREST_STATUS} value={i.status} />
                      </li>
                    ))}
                  </ul>
                  <Link href="/dashboard/marketplace/enquiries" className="link mt-2 inline-block text-xs">View all my enquiries</Link>
                </div>
              )}
            </Card>
          ) : (
            <Card title="Administration">
              <p className="text-sm text-muted-grey">This is the listing as investors see it.</p>
              <Link href={`/dashboard/projects/${id}?tab=marketplace`} className="btn btn-secondary mt-3">Manage listing</Link>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

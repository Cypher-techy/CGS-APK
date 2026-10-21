import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { requireActive } from "@/lib/auth";
import { INTEREST_KINDS, INTEREST_STATUS } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import { updateInterest } from "@/modules/marketplace/actions";

const OPEN = ["submitted", "under_review", "due_diligence", "negotiation"];

export default async function EnquiriesPage() {
  const { supabase, profile } = await requireActive(["investor", "super_admin", "project_manager", "project_owner"]);
  const isInvestor = profile.role === "investor";
  const canHandle = profile.role === "super_admin" || profile.role === "project_manager";

  // RLS: investors see their own enquiries; owners, managers and administrators see those on their projects.
  const { data, error } = await supabase
    .from("marketplace_interests")
    .select("id, kind, message, status, response_notes, created_at, updated_at, project_id, investor_id")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  const enquiries = data ?? [];

  // Project names: investors read them from the marketplace, project participants from their projects.
  const names = new Map<string, string>();
  if (isInvestor) {
    const { data: listings } = await supabase.rpc("marketplace_browse");
     
    for (const l of (listings ?? []) as any[]) names.set(l.project_id, l.name);
  } else {
    const { data: projects } = await supabase.from("projects").select("id, name").in("id", [...new Set(enquiries.map((e) => e.project_id))]);
    for (const p of projects ?? []) names.set(p.id, p.name);
  }

  return (
    <>
      <PageHeader
        title={isInvestor ? "My enquiries" : "Investor enquiries"}
        description={
          isInvestor
            ? "Expressions of interest and partnership enquiries you have sent, with their due diligence and negotiation status."
            : "Enquiries from investors and project developers about listed projects. Each enquiry moves through review, due diligence, negotiation and agreement."
        }
      />
      <Card pad={false}>
        {enquiries.length === 0 ? (
          <EmptyState title="There are no enquiries yet.">
            {isInvestor && <Link href="/dashboard/marketplace" className="link">Browse the marketplace</Link>}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-subtle-border">
            {enquiries.map((e) => (
              <li key={e.id} className="px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-heading">
                    {INTEREST_KINDS[e.kind]}:{" "}
                    <Link href={isInvestor ? `/dashboard/marketplace/${e.project_id}` : `/dashboard/projects/${e.project_id}?tab=marketplace`} className="link">
                      {names.get(e.project_id) ?? "Listing no longer published"}
                    </Link>
                  </p>
                  <StatusBadge map={INTEREST_STATUS} value={e.status} />
                </div>
                <p className="text-xs text-muted-grey">
                  Sent {formatDateTime(e.created_at)} · last updated {formatDateTime(e.updated_at)}
                </p>
                <p className="prose-block mt-2">{e.message}</p>
                {e.response_notes && <p className="prose-block mt-2"><span className="font-medium">CGS response: </span>{e.response_notes}</p>}

                {canHandle && (
                  <ActionForm action={updateInterest} submitLabel="Update enquiry" submitClass="btn btn-secondary btn-sm" className="mt-3 flex flex-wrap items-start gap-2" resetOnSuccess={false}>
                    <input type="hidden" name="interest_id" value={e.id} />
                    <select name="status" defaultValue={e.status} className="input w-auto py-1 text-xs" aria-label="Enquiry status">
                      {Object.entries(INTEREST_STATUS).map(([value, { label }]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                    <input name="response_notes" defaultValue={e.response_notes ?? ""} maxLength={3000} placeholder="Response visible to the investor" aria-label="Response" className="input min-w-52 flex-1 py-1 text-xs" />
                  </ActionForm>
                )}
                {isInvestor && OPEN.includes(e.status) && (
                  <ActionForm action={updateInterest} confirm="Withdraw this enquiry?" submitLabel="Withdraw enquiry" submitClass="btn btn-danger btn-sm" className="mt-3">
                    <input type="hidden" name="interest_id" value={e.id} />
                    <input type="hidden" name="status" value="withdrawn" />
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {!isInvestor && (
        <p className="mt-3 text-xs text-muted-grey">
          Investor identities are shown to CGS administrators under Users. Agreements and financial terms are concluded outside the portal.
        </p>
      )}
    </>
  );
}

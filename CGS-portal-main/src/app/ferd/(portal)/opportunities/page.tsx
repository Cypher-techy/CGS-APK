import { OPPORTUNITY_TYPES } from "@/modules/ferd/constants";
import { Listing, type ListingParams } from "@/modules/ferd/portal";

export default async function FerdOpportunitiesPage({ searchParams }: { searchParams: Promise<ListingParams> }) {
  return (
    <Listing
      moduleKey="opportunities"
      path="/ferd/opportunities"
      types={OPPORTUNITY_TYPES}
      params={await searchParams}
      order="deadline"
      empty="No open opportunities"
      emptyHint="Listings are removed automatically when their deadline passes. Bookmark the ones you plan to apply for."
      intro={<p className="mb-4 text-xs text-muted-grey">Each listing links to the official application page and shows when it was last checked. Always confirm details with the organization itself.</p>}
    />
  );
}

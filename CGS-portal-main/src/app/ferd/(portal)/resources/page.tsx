import { typesIn } from "@/modules/ferd/constants";
import { Listing, type ListingParams } from "@/modules/ferd/portal";

export default async function FerdResourcesPage({ searchParams }: { searchParams: Promise<ListingParams> }) {
  return (
    <Listing
      moduleKey="resources"
      path="/ferd/resources"
      types={typesIn("learning")}
      params={await searchParams}
      empty="No resources available"
      emptyHint="Notes, guides, datasets and links appear here as soon as your department publishes them."
    />
  );
}

import { Listing, type ListingParams } from "@/modules/ferd/portal";

export default async function FerdEventsPage({ searchParams }: { searchParams: Promise<ListingParams> }) {
  return (
    <Listing
      moduleKey="events"
      path="/ferd/events"
      types={["event"]}
      params={await searchParams}
      empty="No events announced"
      emptyHint="Field trips, workshops, practical sessions and meetings appear here when they are announced."
    />
  );
}

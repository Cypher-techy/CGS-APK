import { Listing, type ListingParams } from "@/modules/ferd/portal";

export default async function FerdCommunityPage({ searchParams }: { searchParams: Promise<ListingParams> }) {
  return (
    <Listing
      moduleKey="community"
      path="/ferd/community"
      types={["announcement", "gallery", "project"]}
      params={await searchParams}
      empty="Nothing posted yet"
      emptyHint="Department announcements, photo galleries and student projects appear here."
    />
  );
}

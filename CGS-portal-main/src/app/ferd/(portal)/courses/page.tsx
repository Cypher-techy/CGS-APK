import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { typesIn } from "@/modules/ferd/constants";
import { bookmarkedIds, ContentGrid, entitledProducts, liveContent } from "@/modules/ferd/content";
import { requireModule } from "@/modules/ferd/portal";

/** Units of the department. Selecting a unit lists everything published for it. */
export default async function FerdCoursesPage({ searchParams }: { searchParams: Promise<{ course?: string }> }) {
  const { course: selectedId } = await searchParams;
  const { supabase, user, student, role, department, moduleLabel } = await requireModule("courses");
  const { data: courses } = await supabase
    .from("ferd_courses")
    .select("id, code, title, year_of_study, semester, description")
    .eq("department_id", department.id)
    .eq("is_active", true)
    .order("year_of_study", { nullsFirst: false })
    .order("semester", { nullsFirst: false })
    .order("code");
  const list = courses ?? [];
  const selected = list.find((c) => c.id === selectedId);
  const years = [...new Set(list.map((c) => c.year_of_study ?? 0))];

  if (selected) {
    const [rows, entitled, bookmarks] = await Promise.all([
      liveContent(supabase, department.id, { types: typesIn("learning", "manual"), courseId: selected.id }),
      entitledProducts(supabase, user.id),
      bookmarkedIds(supabase, user.id),
    ]);
    return (
      <>
        <PageHeader title={`${selected.code} · ${selected.title}`} description={selected.description ?? undefined} actions={<Link href="/ferd/courses" className="btn btn-secondary">All units</Link>} />
        <ContentGrid rows={rows} entitled={entitled} bookmarks={bookmarks} canBookmark={!!student} staff={!!role} empty="No materials for this unit yet" emptyHint="Notes, guides and manuals for the unit appear here when they are published." />
      </>
    );
  }

  return (
    <>
      <PageHeader title={moduleLabel} description={`Units offered in ${department.name}. Open a unit to see its notes, guides and manuals.`} />
      {list.length === 0 ? (
        <Card>
          <EmptyState title="No units listed">Units are added by your department administrator.</EmptyState>
        </Card>
      ) : (
        <div className="space-y-6">
          {years.map((year) => (
            <section key={year}>
              <h2 className="mb-3 text-lg font-bold text-white">{year ? `Year ${year}` : "Other units"}</h2>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {list.filter((c) => (c.year_of_study ?? 0) === year).map((c) => (
                  <li key={c.id}>
                    <Link href={`/ferd/courses?course=${c.id}`} className="card card-pad block h-full hover:border-[var(--ferd-accent)]">
                      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ferd-accent)]">
                        {c.code}
                        {c.semester ? ` · Semester ${c.semester}` : ""}
                      </p>
                      <p className="mt-1 font-display text-base font-bold text-white">{c.title}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

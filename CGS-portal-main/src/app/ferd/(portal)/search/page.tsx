import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { CONTENT_TYPES } from "@/modules/ferd/constants";
import { bookmarkedIds, cleanSearch, ContentFilters, ContentGrid, entitledProducts, liveContent } from "@/modules/ferd/content";
import { requireViewer } from "@/modules/ferd/session";

export const metadata: Metadata = { title: "Search" };

const ALL_TYPES = Object.keys(CONTENT_TYPES);

/**
 * Search across everything published for the student's department: titles, summaries, the text itself,
 * sources, tags, and the names and captions of uploaded files.
 */
export default async function FerdSearchPage({ searchParams }: { searchParams: Promise<{ q?: string; type?: string; tier?: string }> }) {
  const params = await searchParams;
  const { supabase, user, student, role, department } = await requireViewer();
  const q = cleanSearch(params.q ?? "");
  const types = params.type && ALL_TYPES.includes(params.type) ? [params.type] : ALL_TYPES;

  // Items whose uploaded files match by name or caption. RLS shows a student only the files of items they can see.
  const { data: files } = q.length >= 2
    ? await supabase.from("ferd_files").select("content_id, file_name").or(`file_name.ilike.%${q}%,caption.ilike.%${q}%`).limit(200)
    : { data: [] };
  const byFile = new Map<string, string[]>();
  for (const file of files ?? []) byFile.set(file.content_id, [...(byFile.get(file.content_id) ?? []), file.file_name]);

  const [rows, entitled, bookmarks] = q.length >= 2
    ? await Promise.all([
        liveContent(supabase, department.id, { types, q, deep: true, ids: [...byFile.keys()], tier: params.tier }),
        entitledProducts(supabase, user.id),
        bookmarkedIds(supabase, user.id),
      ])
    : [[], new Set<string>(), new Set<string>()];
  const matchedFiles = rows.flatMap((row) => (byFile.get(row.id) ?? []).map((name) => ({ id: row.id as string, title: row.title as string, name })));

  return (
    <>
      <PageHeader title="Search" description={`Notes, manuals, files, announcements, events and opportunities for ${department.name}.`} />
      <ContentFilters action="/ferd/search" q={params.q} type={params.type} tier={params.tier} types={ALL_TYPES} />
      {q.length < 2 ? (
        <p className="text-sm text-muted-grey">Type at least two letters: a unit code, a topic, a file name or a word from the text.</p>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-grey" role="status">
            {rows.length === 0 ? "Nothing matches" : `${rows.length}${rows.length === 60 ? "+" : ""} result${rows.length === 1 ? "" : "s"} for`}{" "}
            <strong className="text-charcoal">“{q}”</strong>
          </p>
          {matchedFiles.length > 0 && (
            <ul className="card mb-5 divide-y divide-subtle-border text-sm">
              {matchedFiles.slice(0, 12).map((file, i) => (
                <li key={file.id + i} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <a href={`/ferd/content/${file.id}`} className="link truncate">{file.name}</a>
                  <span className="truncate text-xs text-muted-grey">File in “{file.title}”</span>
                </li>
              ))}
            </ul>
          )}
          <ContentGrid rows={rows} entitled={entitled} bookmarks={bookmarks} canBookmark={!!student} staff={!!role} empty="Nothing matches your search" emptyHint="Try a shorter word, a unit code or part of a file name." />
        </>
      )}
    </>
  );
}

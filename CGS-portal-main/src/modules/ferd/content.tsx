import Link from "next/link";
import { Bookmark, BookmarkCheck, CalendarDays, Lock, MapPin, Unlock } from "lucide-react";
import { EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/format";
import type { Supabase } from "@/lib/supabase/server";
import { CONTENT_TYPES } from "@/modules/ferd/constants";
import { toggleBookmark } from "@/modules/ferd/student-actions";


export type ContentRow = Record<string, any>;

export const CONTENT_COLUMNS =
  "id, type, title, summary, tier, product_id, status, publish_at, expires_at, source, external_url, tags, meta, course_id, departments, created_at";

/** Characters that have a meaning in a PostgREST filter are removed from free-text searches. */
export const cleanSearch = (value: string) => value.replace(/[%,()*\\"']/g, " ").trim().slice(0, 80);

/**
 * Live content of one department: published, inside its publication window, and addressed to that
 * department or to all. RLS already limits students to this; the filters make a staff preview match.
 */
export async function liveContent(
  supabase: Supabase,
  departmentId: string,
  options: { types: string[]; q?: string; deep?: boolean; ids?: string[]; tag?: string; courseId?: string; tier?: string; limit?: number; order?: "recent" | "deadline" },
): Promise<ContentRow[]> {
  const now = new Date().toISOString();
  let query = supabase
    .from("ferd_content")
    .select(CONTENT_COLUMNS)
    .in("type", options.types)
    .eq("status", "published")
    .or(`departments.eq.{},departments.cs.{${departmentId}}`)
    .or(`publish_at.is.null,publish_at.lte.${now}`)
    .or(`expires_at.is.null,expires_at.gt.${now}`);
  const q = options.q ? cleanSearch(options.q) : "";
  if (q && options.deep) {
    // The search page also looks in the text, the source, the tags and (through `ids`) the uploaded files.
    const parts = [`title.ilike.%${q}%`, `summary.ilike.%${q}%`, `body.ilike.%${q}%`, `source.ilike.%${q}%`];
    if (/^[w -]+$/.test(q)) parts.push(`tags.cs.{"${q}"}`);
    const ids = (options.ids ?? []).filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 200);
    if (ids.length) parts.push(`id.in.(${ids.join(",")})`);
    query = query.or(parts.join(","));
  } else if (q) query = query.or(`title.ilike.%${q}%,summary.ilike.%${q}%`);
  if (options.tag) query = query.contains("tags", [options.tag.slice(0, 40)]);
  if (options.courseId) query = query.eq("course_id", options.courseId);
  if (options.tier === "free" || options.tier === "premium") query = query.eq("tier", options.tier);
  query = options.order === "deadline" ? query.order("expires_at", { ascending: true, nullsFirst: false }) : query.order("publish_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });
  const { data, error } = await query.limit(options.limit ?? 60);
  if (error) console.error("FERD content query failed:", error.message);
  return data ?? [];
}

/** Product ids the user holds an active entitlement for. */
export async function entitledProducts(supabase: Supabase, userId: string): Promise<Set<string>> {
  const { data } = await supabase.from("ferd_entitlements").select("product_id").eq("user_id", userId).is("revoked_at", null);
  return new Set((data ?? []).map((row) => row.product_id as string));
}

export async function bookmarkedIds(supabase: Supabase, userId: string): Promise<Set<string>> {
  const { data } = await supabase.from("ferd_bookmarks").select("content_id").eq("user_id", userId);
  return new Set((data ?? []).map((row) => row.content_id as string));
}

export function TierBadge({ row, unlocked }: { row: ContentRow; unlocked: boolean }) {
  if (row.tier !== "premium") return <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-medium text-emerald-200">Free</span>;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${unlocked ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-amber-400/30 bg-amber-400/10 text-amber-200"}`}>
      {unlocked ? <Unlock className="h-3 w-3" aria-hidden="true" /> : <Lock className="h-3 w-3" aria-hidden="true" />}
      {unlocked ? "Premium · unlocked" : "Premium"}
    </span>
  );
}

/** One line of type-specific facts: organization, place, deadline, event date. */
function Facts({ row }: { row: ContentRow }) {
  const meta = (row.meta ?? {}) as Record<string, string>;
  const group = CONTENT_TYPES[row.type]?.group;
  return (
    <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-grey">
      {meta.organization && <span>{meta.organization}</span>}
      {meta.location && (
        <span className="inline-flex items-center gap-1">
          <MapPin className="h-3 w-3" aria-hidden="true" /> {meta.location}
          {meta.mode ? ` · ${meta.mode}` : ""}
        </span>
      )}
      {group === "event" && meta.starts_at && (
        <span className="inline-flex items-center gap-1">
          <CalendarDays className="h-3 w-3" aria-hidden="true" /> {formatDate(meta.starts_at)}
        </span>
      )}
      {group === "opportunity" && <span>{row.expires_at ? `Deadline ${formatDate(row.expires_at)}` : "No deadline stated"}</span>}
      {group === "opportunity" && meta.last_verified && <span>Checked {formatDate(meta.last_verified)}</span>}
      {row.source && <span>Source: {row.source}</span>}
    </p>
  );
}

export function ContentCard({ row, unlocked, bookmarked, canBookmark }: { row: ContentRow; unlocked: boolean; bookmarked: boolean; canBookmark: boolean }) {
  return (
    <li className="card flex flex-col p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ferd-accent)]">{CONTENT_TYPES[row.type]?.label ?? row.type}</span>
        <TierBadge row={row} unlocked={unlocked} />
        {canBookmark && (
          <form action={toggleBookmark} className="ml-auto">
            <input type="hidden" name="content_id" value={row.id} />
            <button type="submit" className="rounded-full p-1.5 text-muted-grey hover:bg-white/10 hover:text-white" aria-label={bookmarked ? "Remove bookmark" : "Bookmark"} aria-pressed={bookmarked}>
              {bookmarked ? <BookmarkCheck className="h-4 w-4 text-[var(--ferd-accent)]" /> : <Bookmark className="h-4 w-4" />}
            </button>
          </form>
        )}
      </div>
      <h3 className="mt-2 font-display text-lg font-bold leading-snug text-white">
        <Link href={`/ferd/content/${row.id}`} className="hover:underline">{row.title}</Link>
      </h3>
      {row.summary && <p className="mt-1.5 line-clamp-3 text-sm text-muted-grey">{row.summary}</p>}
      <Facts row={row} />
      {(row.tags ?? []).length > 0 && (
        <p className="mt-3 flex flex-wrap gap-1.5">
          {(row.tags as string[]).slice(0, 5).map((tag) => (
            <span key={tag} className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-charcoal">{tag}</span>
          ))}
        </p>
      )}
    </li>
  );
}

export function ContentGrid({
  rows,
  entitled,
  bookmarks,
  canBookmark,
  staff,
  empty,
  emptyHint,
}: {
  rows: ContentRow[];
  entitled: Set<string>;
  bookmarks: Set<string>;
  canBookmark: boolean;
  /** Staff previews see premium items as unlocked. */
  staff: boolean;
  empty: string;
  emptyHint?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="card">
        <EmptyState title={empty}>{emptyHint}</EmptyState>
      </div>
    );
  }
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((row) => (
        <ContentCard key={row.id} row={row} unlocked={row.tier !== "premium" || staff || entitled.has(row.product_id)} bookmarked={bookmarks.has(row.id)} canBookmark={canBookmark} />
      ))}
    </ul>
  );
}

/** Search box and filters shared by the listing pages. Plain GET form: works without scripts. */
export function ContentFilters({ action, q, type, tier, types }: { action: string; q?: string; type?: string; tier?: string; types: string[] }) {
  return (
    <form action={action} className="mb-5 flex flex-wrap items-end gap-3" role="search">
      <label className="min-w-48 flex-1">
        <span className="label">Search</span>
        <input name="q" type="search" defaultValue={q ?? ""} className="input" placeholder="Title or summary" maxLength={80} />
      </label>
      {types.length > 1 && (
        <label>
          <span className="label">Type</span>
          <select name="type" defaultValue={type ?? ""} className="input">
            <option value="">All</option>
            {types.map((key) => (
              <option key={key} value={key}>{CONTENT_TYPES[key].plural}</option>
            ))}
          </select>
        </label>
      )}
      <label>
        <span className="label">Access</span>
        <select name="tier" defaultValue={tier ?? ""} className="input">
          <option value="">Free and premium</option>
          <option value="free">Free</option>
          <option value="premium">Premium</option>
        </select>
      </label>
      <button type="submit" className="btn btn-secondary">Apply</button>
    </form>
  );
}

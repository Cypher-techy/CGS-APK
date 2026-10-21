import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui";
import { bookmarkedIds, ContentFilters, ContentGrid, entitledProducts, liveContent } from "@/modules/ferd/content";
import { requireViewer } from "@/modules/ferd/session";

/**
 * Viewer of one portal module. A module that the Super Admin switched off (globally or for this
 * department) is not just hidden from the menu: its page stops existing.
 */
export async function requireModule(key: string) {
  const viewer = await requireViewer();
  const [{ data: module }, { data: override }] = await Promise.all([
    viewer.supabase.from("ferd_modules").select("label, description, is_enabled").eq("key", key).maybeSingle(),
    viewer.supabase.from("ferd_department_modules").select("is_enabled, label").eq("department_id", viewer.department.id).eq("module_key", key).maybeSingle(),
  ]);
  if (!module || !module.is_enabled || override?.is_enabled === false) notFound();
  return { ...viewer, moduleLabel: (override?.label ?? module.label) as string, moduleDescription: (module.description ?? "") as string };
}

export interface ListingParams {
  q?: string;
  type?: string;
  tier?: string;
  tag?: string;
}

/** A searchable, filterable list of live content for the viewer's department. */
export async function Listing({
  moduleKey,
  path,
  types,
  params,
  empty,
  emptyHint,
  order,
  intro,
}: {
  moduleKey: string;
  path: string;
  types: string[];
  params: ListingParams;
  empty: string;
  emptyHint?: string;
  order?: "recent" | "deadline";
  intro?: ReactNode;
}) {
  const { supabase, user, student, role, department, moduleLabel, moduleDescription } = await requireModule(moduleKey);
  const selected = params.type && types.includes(params.type) ? [params.type] : types;
  const [rows, entitled, bookmarks] = await Promise.all([
    liveContent(supabase, department.id, { types: selected, q: params.q, tier: params.tier, tag: params.tag, order }),
    entitledProducts(supabase, user.id),
    bookmarkedIds(supabase, user.id),
  ]);
  return (
    <>
      <PageHeader title={moduleLabel} description={`${moduleDescription} ${department.name}.`} />
      {intro}
      <ContentFilters action={path} q={params.q} type={params.type} tier={params.tier} types={types} />
      {params.tag && <p className="mb-4 text-sm text-muted-grey">Filtered by focus area: <strong className="text-charcoal">{params.tag}</strong></p>}
      <ContentGrid rows={rows} entitled={entitled} bookmarks={bookmarks} canBookmark={!!student} staff={!!role} empty={empty} emptyHint={emptyHint} />
    </>
  );
}

import type { Feature, FeatureCollection } from "geojson";
import { createClient, type Supabase } from "@/lib/supabase/server";
import type { ActivityEntry, Insight } from "@/modules/geo/ExplorerPanel";

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const asCollection = (data: unknown): FeatureCollection =>
  data && typeof data === "object" && Array.isArray((data as FeatureCollection).features) ? (data as FeatureCollection) : EMPTY;

const featureKey = (f: Feature) => {
  const p = f.properties ?? {};
  return `${p.kind}:${p.record_id ?? p.site_id ?? p.project_id}`;
};

/**
 * Projects published to the public Explore map. Returns `available: false` when the feed cannot be
 * read (for example before the database migration is applied) so pages can say so instead of showing zero.
 */
export async function publicFeatures(supabase?: Supabase): Promise<{ features: FeatureCollection; available: boolean }> {
  const client = supabase ?? (await createClient());
  const { data, error } = await client.rpc("explore_public");
  if (error) {
    console.error("Explore feed failed:", error.message);
    return { features: EMPTY, available: false };
  }
  return { features: asCollection(data), available: true };
}

/**
 * Everything the signed-in user may see on the map (RLS decides).
 * A busy database can time the query out, so it is tried twice; if it still fails the page gets an
 * empty map marked `available: false` and says so, instead of failing as a whole.
 */
export async function workspaceMap(supabase: Supabase): Promise<{ features: FeatureCollection; available: boolean }> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { data, error } = await supabase.rpc("gis_features", { p_project: null });
    if (!error) return { features: asCollection(data), available: true };
    console.error(`Workspace map failed (attempt ${attempt}):`, error.message);
  }
  return { features: EMPTY, available: false };
}

/** As workspaceMap, for callers that only need the features. */
export async function workspaceFeatures(supabase: Supabase): Promise<FeatureCollection> {
  return (await workspaceMap(supabase)).features;
}

export const MAP_UNAVAILABLE = "The project map could not be loaded just now. Reload the page to try again; the lists below are unaffected.";

/** The viewer's own projects first, then public projects they do not take part in. */
export function mergeFeatures(own: FeatureCollection, shared: FeatureCollection): FeatureCollection {
  const seen = new Set(own.features.map(featureKey));
  return { type: "FeatureCollection", features: [...own.features, ...shared.features.filter((f) => !seen.has(featureKey(f)))] };
}

export const projectIds = (collection: FeatureCollection) =>
  collection.features.filter((f) => f.properties?.kind === "project").map((f) => String(f.properties?.project_id));

export async function projectInsights(supabase: Supabase): Promise<Record<string, Insight>> {
  const { data, error } = await supabase.rpc("geo_project_insights");
  if (error) {
    console.error("Project insights failed:", error.message);
    return {};
  }
  return Object.fromEntries(((data ?? []) as (Insight & { project_id: string })[]).map((row) => [row.project_id, row]));
}

export async function recentActivity(supabase: Supabase, limit = 40): Promise<ActivityEntry[]> {
  const { data } = await supabase
    .from("activity_logs")
    .select("id, action, created_at, project_id, actor:profiles!activity_logs_actor_id_fkey(full_name), project:projects(code)")
    .order("created_at", { ascending: false })
    .limit(limit);

  return ((data ?? []) as any[]).map((row) => ({
    id: row.id,
    action: row.action,
    created_at: row.created_at,
    project_id: row.project_id,
    actor: row.actor?.full_name ?? null,
    code: row.project?.code ?? null,
  }));
}

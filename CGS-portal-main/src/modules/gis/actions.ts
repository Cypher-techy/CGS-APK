"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { activeSession, NOT_ALLOWED } from "@/lib/auth";
import { dbError, fail, ok, optionalText, parseForm, uuid } from "@/lib/actions";
import { isFile } from "@/modules/documents/storage";
import { LAND_COVER_FIRST_YEAR, LAND_COVER_SOURCE, landCoverByClass } from "@/modules/gis/landcover";
import { readBoundaryFile } from "@/modules/gis/parse";
import type { ActionState } from "@/lib/types";

const MAX_GEOJSON_CHARS = 5 * 1024 * 1024;

/**
 * Saves a project boundary from an uploaded file (GeoJSON, KML or zipped shapefile), pasted GeoJSON
 * or a shape drawn on the map. PostGIS validates and repairs the geometry and calculates the area;
 * RLS decides who may write.
 */
export async function saveBoundary(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession();
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(z.object({ project_id: uuid, source: optionalText(200) }), formData);
  if (parsed.error) return parsed.error;

  const file = formData.get("file");
  const text = String(formData.get("geojson") ?? "").trim();
  let source = parsed.data.source;
  let geojson: unknown;

  if (isFile(file)) {
    const read = await readBoundaryFile(file);
    if (read.error !== null) return fail(read.error);
    geojson = read.geojson;
    source = source ?? `Imported from ${file.name.slice(-120)}`;
  } else if (text) {
    if (text.length > MAX_GEOJSON_CHARS) return fail("The GeoJSON is larger than 5 MB.");
    try {
      geojson = JSON.parse(text);
    } catch {
      return fail("The pasted content is not valid JSON.");
    }
  } else {
    return fail("Choose a boundary file, paste GeoJSON or draw the boundary on the map.");
  }
  if (typeof geojson !== "object" || geojson === null || !("type" in geojson)) return fail("The content is not GeoJSON.");

  const { data, error } = await session.supabase.rpc("save_project_boundary", {
    p_project: parsed.data.project_id,
    p_geojson: geojson,
    p_source: source,
  });
  if (error) return dbError(error);
  revalidatePath("/dashboard", "layout");
  return ok(`Boundary saved. Calculated area: ${Number(data).toLocaleString("en-KE", { maximumFractionDigits: 2 })} ha.`);
}

export async function deleteBoundary(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession();
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(z.object({ project_id: uuid }), formData);
  if (parsed.error) return parsed.error;
  const { data, error } = await session.supabase.from("project_boundaries").delete().eq("project_id", parsed.data.project_id).select("project_id");
  if (error) return dbError(error);
  if (!data.length) return fail("No boundary was removed. You may not be permitted to edit this project's boundary.");
  revalidatePath("/dashboard", "layout");
  return ok("Boundary removed.");
}

/**
 * Calculates the land-cover composition inside the project boundary for one year from the
 * Sentinel-2 10 m land-cover time series and stores it. Running several years gives the change over time.
 */
export async function runLandCoverAnalysis(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession(["super_admin", "project_manager", "gis_analyst", "mrv_specialist"]);
  if (!session) return fail(NOT_ALLOWED);
  const thisYear = new Date().getUTCFullYear();
  const parsed = parseForm(
    z.object({
      project_id: uuid,
      year: z.coerce.number().int().min(LAND_COVER_FIRST_YEAR, `must be ${LAND_COVER_FIRST_YEAR} or later`).max(thisYear, "cannot be in the future"),
    }),
    formData,
  );
  if (parsed.error) return parsed.error;
  const { project_id, year } = parsed.data;
  const { supabase } = session;

  const { data: features, error: readError } = await supabase.rpc("gis_features", { p_project: project_id });
  if (readError) return dbError(readError);
   
  const boundary = (features?.features ?? []).find((f: any) => f.properties?.kind === "boundary");
  if (!boundary) return fail("Map the project boundary first. Land cover is calculated inside the boundary.");

  let classes: Record<string, number>;
  try {
    classes = await landCoverByClass(boundary.geometry.coordinates, year, Number(boundary.properties.area_ha));
  } catch (error) {
    if (error instanceof Error && error.message === "NO_DATA") return fail(`The land-cover dataset has no data for ${year} at this location.`);
    console.error("Land-cover analysis failed:", error);
    return fail("The land-cover service did not respond. Please try again in a few minutes.");
  }

  const { error } = await supabase
    .from("land_cover_analyses")
    .upsert({ project_id, year, classes, boundary_area_ha: boundary.properties.area_ha, source: LAND_COVER_SOURCE }, { onConflict: "project_id,year" });
  if (error) return dbError(error);
  revalidatePath("/dashboard", "layout");
  return ok(`Land cover for ${year} calculated and saved.`);
}

export async function deleteLandCoverAnalysis(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession();
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(z.object({ analysis_id: uuid }), formData);
  if (parsed.error) return parsed.error;
  const { data, error } = await session.supabase.from("land_cover_analyses").delete().eq("id", parsed.data.analysis_id).select("id");
  if (error) return dbError(error);
  if (!data.length) return fail("The result was not found or you are not permitted to delete it.");
  revalidatePath("/dashboard", "layout");
  return ok("Result removed.");
}

"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { activeSession, NOT_ALLOWED } from "@/lib/auth";
import { dbError, fail, ok, optionalDate, optionalNumber, optionalText, optionalUuid, parseForm, text, uuid } from "@/lib/actions";
import { LIFECYCLE_STAGES, SITE_KINDS } from "@/lib/constants";
import type { ActionState } from "@/lib/types";
import { isFile } from "@/modules/documents/storage";
import { readBoundaryFile } from "@/modules/gis/parse";

const refresh = () => revalidatePath("/dashboard", "layout");
const NO_ROWS = "The record was not found or you are not permitted to change it in its current status.";

const projectSchema = z
  .object({
    id: optionalUuid,
    intent: z.enum(["save", "submit"]).default("save"),
    name: text(3, 160),
    category_id: uuid,
    description: text(20, 5000),
    objectives: optionalText(5000),
    organization_id: optionalUuid,
    lifecycle_stage: z.enum(Object.keys(LIFECYCLE_STAGES) as [string, ...string[]]).default("idea"),
    country: text(2, 80),
    county: text(2, 80),
    sub_county: optionalText(80),
    location_description: optionalText(500),
    latitude: optionalNumber(-90, 90),
    longitude: optionalNumber(-180, 180),
    area_ha: optionalNumber(0, 10_000_000),
    start_date: optionalDate,
    expected_end_date: optionalDate,
  })
  .refine((v) => !v.start_date || !v.expected_end_date || v.expected_end_date >= v.start_date, {
    message: "expected completion date cannot be before the start date",
  })
  .refine((v) => (v.latitude === null) === (v.longitude === null), { message: "provide both latitude and longitude, or neither" });

/** Boundary sent with the project form: drawn on the map (GeoJSON text) or uploaded as a GIS file. */
async function readFormBoundary(formData: FormData): Promise<{ geojson: unknown; source: string } | { error: string } | null> {
  const drawn = String(formData.get("boundary_geojson") ?? "").trim();
  if (drawn) {
    if (drawn.length > 2_000_000) return { error: "The drawn boundary is too large." };
    try {
      return { geojson: JSON.parse(drawn), source: "Drawn on the map during registration" };
    } catch {
      return { error: "The drawn boundary could not be read. Clear it and draw it again." };
    }
  }
  const file = formData.get("boundary_file");
  if (!isFile(file)) return null;
  const read = await readBoundaryFile(file);
  if (read.error !== null) return { error: read.error };
  return { geojson: read.geojson, source: `Imported from ${file.name.slice(-120)}` };
}

/** Creates or edits a project; with intent "submit" it is also sent for approval. */
export async function saveProject(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession();
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(projectSchema, formData);
  if (parsed.error) return parsed.error;
  const { id, intent, ...fields } = parsed.data;
  const { supabase, user } = session;
  // The boundary is read before anything is saved, so a bad file never leaves a half-registered project.
  const boundary = await readFormBoundary(formData);
  if (boundary && "error" in boundary) return fail(boundary.error);

  let projectId = id;
  if (id) {
    const changes = intent === "submit" ? { ...fields, status: "pending_approval" } : fields;
    const { data, error } = await supabase.from("projects").update(changes).eq("id", id).select("id");
    if (error) return dbError(error);
    if (!data.length) return fail(NO_ROWS);
  } else {
    const { data, error } = await supabase
      .from("projects")
      .insert({ ...fields, owner_id: user.id, status: intent === "submit" ? "pending_approval" : "draft" })
      .select("id")
      .single();
    if (error) return dbError(error);
    projectId = data.id;
  }
  let boundaryFailed = false;
  if (boundary) {
    const { error } = await supabase.rpc("save_project_boundary", { p_project: projectId, p_geojson: boundary.geojson, p_source: boundary.source });
    if (error && id) return fail(`The project was saved, but its boundary was not: ${dbError(error)!.message}`);
    boundaryFailed = !!error;
  }
  refresh();
  redirect(`/dashboard/projects/${projectId}${boundaryFailed ? "?tab=map&notice=boundary" : ""}`);
}

export async function submitProject(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession();
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(z.object({ project_id: uuid }), formData);
  if (parsed.error) return parsed.error;
  const { data, error } = await session.supabase
    .from("projects")
    .update({ status: "pending_approval" })
    .eq("id", parsed.data.project_id)
    .select("id");
  if (error) return dbError(error);
  if (!data.length) return fail(NO_ROWS);
  refresh();
  return ok("Project submitted for approval.");
}

export async function deleteProject(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession();
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(z.object({ project_id: uuid }), formData);
  if (parsed.error) return parsed.error;
  const { data, error } = await session.supabase.from("projects").delete().eq("id", parsed.data.project_id).select("id");
  if (error) return dbError(error);
  if (!data.length) return fail("Only draft projects can be deleted by their owner.");
  refresh();
  redirect("/dashboard/projects");
}

/** Administrator decision on a submitted project. The decision row drives the status change in the database. */
export async function reviewProject(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession(["super_admin"]);
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(
    z.object({
      project_id: uuid,
      decision: z.enum(["approved", "rejected", "revision_required"], { message: "choose a decision" }),
      comments: optionalText(2000),
      manager_id: optionalUuid,
    }),
    formData,
  );
  if (parsed.error) return parsed.error;
  const { project_id, decision, comments, manager_id } = parsed.data;
  const { supabase } = session;

  if (decision !== "approved" && !comments) return fail("Comments are required when rejecting a project or requesting revision.");
  if (decision === "approved") {
    const { data: project } = await supabase.from("projects").select("manager_id").eq("id", project_id).maybeSingle();
    if (!project) return fail("Project not found.");
    if (!manager_id && !project.manager_id) return fail("Assign a project manager when approving a project.");
    if (manager_id && manager_id !== project.manager_id) {
      const { error } = await supabase.from("projects").update({ manager_id }).eq("id", project_id);
      if (error) return dbError(error);
    }
  }
  const { error } = await supabase.from("approvals").insert({ project_id, decision, comments });
  if (error) return dbError(error);
  refresh();
  return ok(`Decision recorded: ${decision.replace("_", " ")}.`);
}

export async function assignManager(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession(["super_admin"]);
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(z.object({ project_id: uuid, manager_id: uuid }), formData);
  if (parsed.error) return parsed.error;
  const { error } = await session.supabase
    .from("projects")
    .update({ manager_id: parsed.data.manager_id })
    .eq("id", parsed.data.project_id);
  if (error) return dbError(error);
  refresh();
  return ok("Project manager assigned.");
}

export async function changeProjectStatus(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession(["super_admin", "project_manager"]);
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(z.object({ project_id: uuid, status: z.enum(["active", "on_hold", "completed"]) }), formData);
  if (parsed.error) return parsed.error;
  const { data, error } = await session.supabase
    .from("projects")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.project_id)
    .select("id");
  if (error) return dbError(error);
  if (!data.length) return fail(NO_ROWS);
  refresh();
  return ok("Project status updated.");
}

/** Team role that goes with each account role. Investors are never project team members. */
const TEAM_ROLE: Record<string, string> = {
  field_officer: "field_officer",
  project_manager: "team_member",
  gis_analyst: "gis_analyst",
  mrv_specialist: "mrv_specialist",
  community_member: "community_member",
};

export async function addMember(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession(["super_admin", "project_manager"]);
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(z.object({ project_id: uuid, user_id: uuid, access: z.enum(["role", "observer"]) }), formData);
  if (parsed.error) return parsed.error;
  const { project_id, user_id, access } = parsed.data;
  const { data: person } = await session.supabase.from("profiles").select("role, status").eq("id", user_id).maybeSingle();
  if (!person || person.status !== "active") return fail("Only active accounts can be added to a project.");
  const member_role = access === "observer" ? "observer" : TEAM_ROLE[person.role];
  if (!member_role) return fail("This account type cannot be added to a project team.");
  const { error } = await session.supabase.from("project_members").insert({ project_id, user_id, member_role });
  if (error) return error.code === "23505" ? fail("That person is already on the project team.") : dbError(error);
  refresh();
  return ok("Team member added.");
}

export async function removeMember(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession(["super_admin", "project_manager"]);
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(z.object({ member_id: uuid }), formData);
  if (parsed.error) return parsed.error;
  const { data, error } = await session.supabase.from("project_members").delete().eq("id", parsed.data.member_id).select("id");
  if (error) return dbError(error);
  if (!data.length) return fail(NO_ROWS);
  refresh();
  return ok("Team member removed.");
}

/** Comment on a project, or on one of its tasks when task_id is given. */
export async function addComment(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession();
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(z.object({ project_id: uuid, task_id: optionalUuid, body: text(1, 2000) }), formData);
  if (parsed.error) return parsed.error;
  const { error } = await session.supabase.from("project_comments").insert({ ...parsed.data, author_id: session.user.id });
  if (error) return dbError(error);
  refresh();
  return ok("Comment posted.");
}

/** Shows or hides an approved project on the public Explore map. The database checks who may do this. */
export async function setProjectVisibility(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession(["super_admin", "project_manager"]);
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(z.object({ project_id: uuid, is_public: z.enum(["true", "false"]) }), formData);
  if (parsed.error) return parsed.error;
  const is_public = parsed.data.is_public === "true";
  const { data, error } = await session.supabase.from("projects").update({ is_public }).eq("id", parsed.data.project_id).select("id");
  if (error) return dbError(error);
  if (!data.length) return fail(NO_ROWS);
  refresh();
  revalidatePath("/explore");
  return ok(is_public ? "The project is now shown on the public Explore map." : "The project was removed from the public Explore map.");
}

export async function setLifecycleStage(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession(["super_admin", "project_manager"]);
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(z.object({ project_id: uuid, lifecycle_stage: z.enum(Object.keys(LIFECYCLE_STAGES) as [string, ...string[]]) }), formData);
  if (parsed.error) return parsed.error;
  const { data, error } = await session.supabase
    .from("projects")
    .update({ lifecycle_stage: parsed.data.lifecycle_stage })
    .eq("id", parsed.data.project_id)
    .select("id");
  if (error) return dbError(error);
  if (!data.length) return fail(NO_ROWS);
  refresh();
  return ok(`Stage set to ${LIFECYCLE_STAGES[parsed.data.lifecycle_stage].label}.`);
}

/** Adds a named location (planting block, monitoring point, nursery) to a project. RLS decides who may. */
export async function saveSite(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession();
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(
    z.object({
      project_id: uuid,
      name: text(2, 120),
      kind: z.enum(Object.keys(SITE_KINDS) as [string, ...string[]]),
      description: optionalText(1000),
      latitude: z.coerce.number({ message: "is required" }).min(-90).max(90),
      longitude: z.coerce.number({ message: "is required" }).min(-180).max(180),
      area_ha: optionalNumber(0, 10_000_000),
    }),
    formData,
  );
  if (parsed.error) return parsed.error;
  const { error } = await session.supabase.from("project_sites").insert(parsed.data);
  if (error) return error.code === "23505" ? fail("This project already has a site with that name.") : dbError(error);
  refresh();
  return ok("Site added. It is now on the map.");
}

export async function deleteSite(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession();
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(z.object({ site_id: uuid }), formData);
  if (parsed.error) return parsed.error;
  const { data, error } = await session.supabase.from("project_sites").delete().eq("id", parsed.data.site_id).select("id");
  if (error) return dbError(error);
  if (!data.length) return fail(NO_ROWS);
  refresh();
  return ok("Site removed.");
}

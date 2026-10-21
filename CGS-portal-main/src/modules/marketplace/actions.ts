"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { activeSession, NOT_ALLOWED } from "@/lib/auth";
import { dbError, fail, ok, optionalText, optionalUuid, parseForm, text, uuid } from "@/lib/actions";
import { DEVELOPMENT_STAGES, EVIDENCE_STAGES, INTEREST_KINDS, INTEREST_STATUS } from "@/lib/constants";
import type { ActionState } from "@/lib/types";

const refresh = () => revalidatePath("/dashboard", "layout");
const keys = (map: Record<string, unknown>) => Object.keys(map) as [string, ...string[]];
const NO_ROWS = "The record was not found or you are not permitted to change it.";

/** Project owner (or administrator) creates or edits the listing text. Publication is a separate, admin-only step. */
export async function saveListing(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession();
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(z.object({ project_id: uuid, summary: text(20, 2000), eligibility_notes: optionalText(2000) }), formData);
  if (parsed.error) return parsed.error;
  const { project_id, ...fields } = parsed.data;
  const { supabase } = session;

  const { data: existing } = await supabase.from("marketplace_listings").select("project_id").eq("project_id", project_id).maybeSingle();
  if (existing) {
    const { data, error } = await supabase.from("marketplace_listings").update(fields).eq("project_id", project_id).select("project_id");
    if (error) return dbError(error);
    if (!data.length) return fail(NO_ROWS);
  } else {
    const { error } = await supabase.from("marketplace_listings").insert({ project_id, ...fields });
    if (error) return dbError(error);
  }
  refresh();
  return ok("Listing saved.");
}

/** Submit for review / withdraw (owner or manager), publish / return to draft (administrator). Enforced by the database. */
export async function setListingStatus(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession();
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(z.object({ project_id: uuid, status: z.enum(["draft", "pending_review", "published", "withdrawn"]) }), formData);
  if (parsed.error) return parsed.error;
  const { data, error } = await session.supabase
    .from("marketplace_listings")
    .update({ status: parsed.data.status })
    .eq("project_id", parsed.data.project_id)
    .select("project_id");
  if (error) return dbError(error);
  if (!data.length) return fail(NO_ROWS);
  refresh();
  return ok(`Listing status: ${parsed.data.status.replace("_", " ")}.`);
}

/** Development stage. Validated, verified and issued need a named standard and an approved evidence document. */
export async function setDevelopmentStage(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession();
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(
    z.object({
      project_id: uuid,
      development_stage: z.enum(keys(DEVELOPMENT_STAGES)),
      standard: optionalText(120),
      stage_evidence_document_id: optionalUuid,
    }),
    formData,
  );
  if (parsed.error) return parsed.error;
  const { project_id, ...fields } = parsed.data;
  if (EVIDENCE_STAGES.includes(fields.development_stage) && (!fields.standard || !fields.stage_evidence_document_id)) {
    return fail("To record a project as validated, verified or issued, name the standard and select the approved evidence document.");
  }
  const { data, error } = await session.supabase.from("marketplace_listings").update(fields).eq("project_id", project_id).select("project_id");
  if (error) return dbError(error);
  if (!data.length) return fail(NO_ROWS);
  refresh();
  return ok("Development stage updated.");
}

export async function toggleSaved(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession(["investor"]);
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(z.object({ project_id: uuid, saved: z.enum(["true", "false"]) }), formData);
  if (parsed.error) return parsed.error;
  const { supabase, user } = session;
  const { error } =
    parsed.data.saved === "true"
      ? await supabase.from("marketplace_saved").delete().eq("investor_id", user.id).eq("project_id", parsed.data.project_id)
      : await supabase.from("marketplace_saved").insert({ investor_id: user.id, project_id: parsed.data.project_id });
  if (error) return dbError(error);
  refresh();
  return ok(parsed.data.saved === "true" ? "Removed from saved projects." : "Project saved.");
}

export async function submitInterest(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession(["investor"]);
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(z.object({ project_id: uuid, kind: z.enum(keys(INTEREST_KINDS)), message: text(20, 3000) }), formData);
  if (parsed.error) return parsed.error;
  const { error } = await session.supabase.from("marketplace_interests").insert({ ...parsed.data, investor_id: session.user.id });
  if (error) return dbError(error);
  refresh();
  return ok("Your enquiry was sent to CGS and the project owner. Follow its progress under My Enquiries.");
}

/** Administrators and project managers move an enquiry through due diligence; investors may only withdraw. */
export async function updateInterest(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession();
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(z.object({ interest_id: uuid, status: z.enum(keys(INTEREST_STATUS)), response_notes: optionalText(3000) }), formData);
  if (parsed.error) return parsed.error;
  const { interest_id, status, response_notes } = parsed.data;
  const changes = session.profile.role === "investor" ? { status } : { status, response_notes };
  const { data, error } = await session.supabase.from("marketplace_interests").update(changes).eq("id", interest_id).select("id");
  if (error) return dbError(error);
  if (!data.length) return fail(NO_ROWS);
  refresh();
  return ok("Enquiry updated.");
}

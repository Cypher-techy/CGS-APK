"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { activeSession, NOT_ALLOWED } from "@/lib/auth";
import { dbError, fail, ok, optionalNumber, optionalText, optionalUuid, parseForm, text, uuid } from "@/lib/actions";
import { OBSERVATION_TYPES } from "@/lib/constants";
import { today } from "@/lib/format";
import { BUCKET, isFile, storeFile } from "@/modules/documents/storage";
import type { ActionState } from "@/lib/types";

const refresh = () => revalidatePath("/dashboard", "layout");
const MAX_PHOTOS = 3;
const FIELD_ROLES = ["field_officer", "project_manager", "super_admin"] as const;

const recordSchema = z.object({
  record_id: optionalUuid,
  // Set by offline capture so that a report sent twice is stored once.
  client_id: optionalUuid,
  project_id: uuid,
  site_id: optionalUuid,
  observation_type: z.enum(Object.keys(OBSERVATION_TYPES) as [string, ...string[]], { message: "choose an observation type" }),
  observation_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be a valid date")
    .refine((d) => d <= today(), "cannot be in the future"),
  latitude: optionalNumber(-90, 90),
  longitude: optionalNumber(-180, 180),
  description: text(10, 5000),
  value_basis: z.enum(["measured", "estimated"]),
  methodology: optionalText(1000),
});

/** Reads the measurement inputs (named m_<key>) defined for the observation type. */
function readMeasurements(type: string, formData: FormData): { values: Record<string, number | string>; error?: string } {
  const values: Record<string, number | string> = {};
  for (const field of OBSERVATION_TYPES[type].fields) {
    const raw = String(formData.get(`m_${field.key}`) ?? "").trim();
    if (!raw) continue;
    if (field.type === "number") {
      const number = Number(raw);
      if (!Number.isFinite(number) || number < 0) return { values, error: `${field.label} must be a non-negative number.` };
      values[field.key] = number;
    } else {
      values[field.key] = raw.slice(0, 300);
    }
  }
  if (type === "tree_survival" && Number(values.trees_surviving ?? 0) > Number(values.trees_assessed ?? Infinity)) {
    return { values, error: "Trees surviving cannot exceed trees assessed." };
  }
  return { values };
}

/**
 * Validates and stores a field report with its photographs.
 * Returns the record id, plus a message when something needs the user's attention.
 */
async function persistRecord(formData: FormData): Promise<{ recordId: string | null; problem: string | null }> {
  const session = await activeSession([...FIELD_ROLES]);
  if (!session) return { recordId: null, problem: NOT_ALLOWED };
  const parsed = parseForm(recordSchema, formData);
  if (parsed.error) return { recordId: null, problem: parsed.error.message };
  const { record_id, client_id, ...fields } = parsed.data;
  if ((fields.latitude === null) !== (fields.longitude === null)) return { recordId: null, problem: "Provide both latitude and longitude, or neither." };

  const measurements = readMeasurements(fields.observation_type, formData);
  if (measurements.error) return { recordId: null, problem: measurements.error };

  const photos = formData.getAll("photos").filter(isFile);
  if (photos.length > MAX_PHOTOS) return { recordId: null, problem: `Attach at most ${MAX_PHOTOS} photographs per report.` };

  const { supabase, user } = session;
  let recordId: string;
  if (record_id) {
    const { project_id: _project, ...changes } = fields;
    const { data, error } = await supabase
      .from("monitoring_records")
      .update({ ...changes, measurements: measurements.values })
      .eq("id", record_id)
      .select("id");
    if (error) return { recordId: null, problem: dbError(error)!.message };
    if (!data.length) return { recordId: null, problem: "The report was not found or can no longer be edited." };
    recordId = record_id;
  } else {
    const { data, error } = await supabase
      .from("monitoring_records")
      .insert({ ...fields, client_id, measurements: measurements.values, recorded_by: user.id })
      .select("id")
      .single();
    if (error) {
      // The same offline report arrived before: it is already stored, photographs included.
      if (error.code === "23505" && client_id) {
        const { data: existing } = await supabase.from("monitoring_records").select("id").eq("client_id", client_id).maybeSingle();
        if (existing) return { recordId: existing.id, problem: null };
      }
      return { recordId: null, problem: dbError(error)!.message };
    }
    recordId = data.id;
  }

  const failed: string[] = [];
  for (const photo of photos) {
    const upload = await storeFile(supabase, fields.project_id, photo, true);
    if (!upload.stored) {
      failed.push(upload.error);
      continue;
    }
    const { error } = await supabase.from("documents").insert({
      ...upload.stored,
      project_id: fields.project_id,
      monitoring_record_id: recordId,
      title: `Field photograph ${fields.observation_date}`,
      category: "monitoring_evidence",
      uploaded_by: user.id,
    });
    if (error) {
      await supabase.storage.from(BUCKET).remove([upload.stored.storage_path]);
      failed.push(`"${photo.name}" could not be attached.`);
    }
  }
  refresh();
  return { recordId, problem: failed.length ? `The report was saved, but: ${failed.join(" ")}` : null };
}

/** Creates a field monitoring record (with photographs), or corrects one that was sent back. */
export async function saveMonitoringRecord(_: ActionState, formData: FormData): Promise<ActionState> {
  const { recordId, problem } = await persistRecord(formData);
  if (problem) return fail(problem);
  redirect(`/dashboard/monitoring/${recordId}`);
}

/** Receives a report captured offline. Safe to call again for the same report: it is stored once. */
export async function syncOfflineRecord(formData: FormData): Promise<{ ok: boolean; message: string }> {
  if (!formData.get("client_id")) return { ok: false, message: "Missing report identifier." };
  formData.delete("record_id");
  const { recordId, problem } = await persistRecord(formData);
  if (!recordId) return { ok: false, message: problem ?? "The report could not be saved." };
  return { ok: true, message: problem ?? "Synchronised." };
}

export async function reviewMonitoringRecord(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession(["project_manager", "super_admin"]);
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(
    z.object({ record_id: uuid, decision: z.enum(["approved", "revision_required"]), review_notes: optionalText(2000) }),
    formData,
  );
  if (parsed.error) return parsed.error;
  const { record_id, decision, review_notes } = parsed.data;
  if (decision === "revision_required" && !review_notes) return fail("Explain what needs to be corrected.");
  const { data, error } = await session.supabase
    .from("monitoring_records")
    .update({ review_status: decision, review_notes })
    .eq("id", record_id)
    .select("id");
  if (error) return dbError(error);
  if (!data.length) return fail("The report was not found or you are not permitted to review it.");
  refresh();
  return ok(decision === "approved" ? "Report approved. The project owner can now see it." : "Report returned for correction.");
}

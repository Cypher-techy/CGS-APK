"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { activeSession, NOT_ALLOWED } from "@/lib/auth";
import { dbError, fail, ok, optionalDate, optionalText, parseForm, text, uuid } from "@/lib/actions";
import { ESTIMATE_KINDS, OBSERVATION_TYPES, SCHEDULE_FREQUENCIES } from "@/lib/constants";
import type { ActionState } from "@/lib/types";

const refresh = () => revalidatePath("/dashboard", "layout");
const keys = (map: Record<string, unknown>) => Object.keys(map) as [string, ...string[]];
const NO_ROWS = "The record was not found or you are not permitted to change it.";

/** Records a carbon estimate. Estimates always carry their method and are never presented as verified results. */
export async function createCarbonEstimate(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession();
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(
    z
      .object({
        project_id: uuid,
        kind: z.enum(keys(ESTIMATE_KINDS)),
        period_start: optionalDate,
        period_end: optionalDate,
        estimated_tco2e: z.coerce.number({ message: "must be a number" }).min(0, "cannot be negative").max(1e11, "is too large"),
        methodology: text(10, 2000),
        assumptions: optionalText(4000),
      })
      .refine((v) => !v.period_start || !v.period_end || v.period_end >= v.period_start, { message: "period end cannot be before period start" }),
    formData,
  );
  if (parsed.error) return parsed.error;
  const { error } = await session.supabase.from("carbon_estimates").insert(parsed.data);
  if (error) return dbError(error);
  refresh();
  return ok("Estimate recorded.");
}

export async function deleteCarbonEstimate(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession();
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(z.object({ estimate_id: uuid }), formData);
  if (parsed.error) return parsed.error;
  const { data, error } = await session.supabase.from("carbon_estimates").delete().eq("id", parsed.data.estimate_id).select("id");
  if (error) return dbError(error);
  if (!data.length) return fail(NO_ROWS);
  refresh();
  return ok("Estimate deleted.");
}

export async function createSchedule(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession();
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(
    z.object({
      project_id: uuid,
      observation_type: z.enum(keys(OBSERVATION_TYPES)),
      frequency: z.enum(keys(SCHEDULE_FREQUENCIES)),
      next_due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a valid date"),
      notes: optionalText(1000),
    }),
    formData,
  );
  if (parsed.error) return parsed.error;
  const { error } = await session.supabase.from("monitoring_schedules").insert(parsed.data);
  if (error) return dbError(error);
  refresh();
  return ok("Monitoring schedule added.");
}

export async function deleteSchedule(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession();
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(z.object({ schedule_id: uuid }), formData);
  if (parsed.error) return parsed.error;
  const { data, error } = await session.supabase.from("monitoring_schedules").delete().eq("id", parsed.data.schedule_id).select("id");
  if (error) return dbError(error);
  if (!data.length) return fail(NO_ROWS);
  refresh();
  return ok("Schedule removed.");
}

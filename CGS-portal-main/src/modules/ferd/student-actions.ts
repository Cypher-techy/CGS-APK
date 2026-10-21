"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbError, fail, ok, parseForm, uuid } from "@/lib/actions";
import type { ActionState } from "@/lib/types";
import { normalizePhone, phoneProblem } from "@/modules/ferd/constants";
import { getFerdSession } from "@/modules/ferd/session";

/** Adds or removes a bookmark. Used as a plain form action, so it returns nothing. */
export async function toggleBookmark(formData: FormData): Promise<void> {
  const session = await getFerdSession();
  const id = uuid.safeParse(formData.get("content_id"));
  if (!session?.student || !id.success) return;
  const { supabase, user } = session;
  const { data: existing } = await supabase.from("ferd_bookmarks").select("content_id").eq("user_id", user.id).eq("content_id", id.data).maybeSingle();
  if (existing) await supabase.from("ferd_bookmarks").delete().eq("user_id", user.id).eq("content_id", id.data);
  else await supabase.from("ferd_bookmarks").insert({ user_id: user.id, content_id: id.data });
  revalidatePath("/ferd", "layout");
}

export async function markNotificationsRead(): Promise<void> {
  const session = await getFerdSession();
  if (!session) return;
  await session.supabase.from("ferd_notifications").update({ read_at: new Date().toISOString() }).eq("user_id", session.user.id).is("read_at", null);
  revalidatePath("/ferd", "layout");
}

/** A student may change only their contact details; the database rejects anything else. */
export async function updateStudentProfile(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await getFerdSession();
  if (!session?.student) return fail("You are not signed in as a student.");
  const parsed = parseForm(z.object({ phone: z.string().trim().min(1, "is required").max(20), year_of_study: z.enum(["", "1", "2", "3", "4", "5", "6"]).default("") }), formData);
  if (parsed.error) return parsed.error;
  // The number can be changed but never removed: M-Pesa payment prompts are sent to it.
  const phone = normalizePhone(parsed.data.phone);
  if (!phone) return fail(`Phone number: ${phoneProblem(parsed.data.phone)}`);
  const { error } = await session.supabase
    .from("ferd_students")
    .update({ phone, year_of_study: parsed.data.year_of_study ? Number(parsed.data.year_of_study) : null })
    .eq("user_id", session.user.id);
  if (error) return dbError(error);
  revalidatePath("/ferd", "layout");
  return ok("Your details were updated.");
}

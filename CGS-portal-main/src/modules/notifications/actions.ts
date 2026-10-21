"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession, NOT_ALLOWED } from "@/lib/auth";
import { dbError, fail, ok, parseForm, uuid } from "@/lib/actions";
import type { ActionState } from "@/lib/types";

export async function markNotificationRead(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(z.object({ notification_id: uuid }), formData);
  if (parsed.error) return parsed.error;
  const { error } = await session.supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", parsed.data.notification_id)
    .is("read_at", null);
  if (error) return dbError(error);
  revalidatePath("/dashboard", "layout");
  return null;
}

export async function markAllNotificationsRead(): Promise<ActionState> {
  const session = await getSession();
  if (!session) return fail(NOT_ALLOWED);
  const { error } = await session.supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", session.user.id)
    .is("read_at", null);
  if (error) return dbError(error);
  revalidatePath("/dashboard", "layout");
  return ok("All notifications marked as read.");
}

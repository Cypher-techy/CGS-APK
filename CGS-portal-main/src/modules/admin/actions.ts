"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { activeSession, NOT_ALLOWED } from "@/lib/auth";
import { dbError, fail, ok, optionalText, optionalUuid, parseForm, text, uuid } from "@/lib/actions";
import { ACCOUNT_STATUS, ROLE_LABELS } from "@/lib/constants";
import type { ActionState } from "@/lib/types";

const refresh = () => revalidatePath("/dashboard", "layout");
const ADMIN = ["super_admin"] as const;

/** Role assignment, account approval, suspension and termination. */
export async function updateUserAccess(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession([...ADMIN]);
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(
    z.object({
      user_id: uuid,
      role: z.enum(Object.keys(ROLE_LABELS) as [string, ...string[]]),
      status: z.enum(Object.keys(ACCOUNT_STATUS) as [string, ...string[]]),
    }),
    formData,
  );
  if (parsed.error) return parsed.error;
  const { user_id, role, status } = parsed.data;
  const { data, error } = await session.supabase.from("profiles").update({ role, status }).eq("id", user_id).select("id");
  if (error) return dbError(error);
  if (!data.length) return fail("User not found.");
  refresh();
  return ok("Account updated.");
}

export async function saveCategory(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession([...ADMIN]);
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(
    z.object({
      category_id: optionalUuid,
      name: text(2, 80),
      description: optionalText(400),
      is_active: z.enum(["true", "false"]).default("true"),
    }),
    formData,
  );
  if (parsed.error) return parsed.error;
  const { category_id, is_active, ...fields } = parsed.data;
  const row = { ...fields, is_active: is_active === "true" };
  const query = category_id
    ? session.supabase.from("project_categories").update(row).eq("id", category_id)
    : session.supabase.from("project_categories").insert(row);
  const { error } = await query;
  if (error) return error.code === "23505" ? fail("A category with that name already exists.") : dbError(error);
  refresh();
  return ok(category_id ? "Category updated." : "Category added.");
}

export async function saveSettings(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession([...ADMIN]);
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(
    z.object({
      platform_name: text(2, 80),
      support_email: z.string().trim().email("enter a valid e-mail address").max(160),
      support_phone: text(3, 30),
      require_account_approval: z.enum(["true", "false"]),
    }),
    formData,
  );
  if (parsed.error) return parsed.error;
  const { require_account_approval, ...fields } = parsed.data;
  const { error } = await session.supabase
    .from("system_settings")
    .update({ ...fields, require_account_approval: require_account_approval === "true" })
    .eq("id", true);
  if (error) return dbError(error);
  refresh();
  return ok("Settings saved.");
}

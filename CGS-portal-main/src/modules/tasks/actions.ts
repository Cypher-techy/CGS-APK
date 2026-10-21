"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { activeSession, NOT_ALLOWED } from "@/lib/auth";
import { dbError, fail, ok, optionalDate, optionalText, optionalUuid, parseForm, text, uuid } from "@/lib/actions";
import type { ActionState } from "@/lib/types";

const refresh = () => revalidatePath("/dashboard", "layout");
const NO_ROWS = "The record was not found or you are not permitted to change it.";

const taskFields = {
  title: text(3, 160),
  description: optionalText(4000),
  assigned_to: optionalUuid,
  milestone_id: optionalUuid,
  priority: z.enum(["low", "medium", "high"]),
  due_date: optionalDate,
};

export async function createTask(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession(["super_admin", "project_manager"]);
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(z.object({ project_id: uuid, ...taskFields }), formData);
  if (parsed.error) return parsed.error;
  const { error } = await session.supabase.from("tasks").insert(parsed.data);
  if (error) return dbError(error);
  refresh();
  return ok("Task created.");
}

export async function updateTask(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession(["super_admin", "project_manager"]);
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(z.object({ task_id: uuid, ...taskFields }), formData);
  if (parsed.error) return parsed.error;
  const { task_id, ...fields } = parsed.data;
  const { data, error } = await session.supabase.from("tasks").update(fields).eq("id", task_id).select("id");
  if (error) return dbError(error);
  if (!data.length) return fail(NO_ROWS);
  refresh();
  return ok("Task updated.");
}

/** Used by assignees (start, submit for review) and managers (complete, return). The database enforces who may do what. */
export async function setTaskStatus(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession();
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(
    z.object({ task_id: uuid, status: z.enum(["todo", "in_progress", "under_review", "completed"]) }),
    formData,
  );
  if (parsed.error) return parsed.error;
  const { data, error } = await session.supabase
    .from("tasks")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.task_id)
    .select("id");
  if (error) return dbError(error);
  if (!data.length) return fail(NO_ROWS);
  refresh();
  return ok("Task status updated.");
}

export async function deleteTask(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession(["super_admin", "project_manager"]);
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(z.object({ task_id: uuid }), formData);
  if (parsed.error) return parsed.error;
  const { data, error } = await session.supabase.from("tasks").delete().eq("id", parsed.data.task_id).select("project_id");
  if (error) return dbError(error);
  if (!data.length) return fail(NO_ROWS);
  refresh();
  redirect(`/dashboard/projects/${data[0].project_id}?tab=tasks`);
}

export async function createMilestone(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession(["super_admin", "project_manager"]);
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(
    z.object({ project_id: uuid, title: text(3, 160), description: optionalText(2000), due_date: optionalDate }),
    formData,
  );
  if (parsed.error) return parsed.error;
  const { error } = await session.supabase.from("milestones").insert(parsed.data);
  if (error) return dbError(error);
  refresh();
  return ok("Milestone created.");
}

export async function setMilestoneStatus(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession(["super_admin", "project_manager"]);
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(z.object({ milestone_id: uuid, status: z.enum(["pending", "completed"]) }), formData);
  if (parsed.error) return parsed.error;
  const { data, error } = await session.supabase
    .from("milestones")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.milestone_id)
    .select("id");
  if (error) return dbError(error);
  if (!data.length) return fail(NO_ROWS);
  refresh();
  return ok(parsed.data.status === "completed" ? "Milestone marked completed." : "Milestone reopened.");
}

export async function deleteMilestone(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession(["super_admin", "project_manager"]);
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(z.object({ milestone_id: uuid }), formData);
  if (parsed.error) return parsed.error;
  const { data, error } = await session.supabase.from("milestones").delete().eq("id", parsed.data.milestone_id).select("id");
  if (error) return dbError(error);
  if (!data.length) return fail(NO_ROWS);
  refresh();
  return ok("Milestone deleted.");
}

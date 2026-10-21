"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { activeSession, NOT_ALLOWED } from "@/lib/auth";
import { dbError, fail, ok, optionalText, parseForm, text, uuid } from "@/lib/actions";
import type { ActionState } from "@/lib/types";

const refresh = () => revalidatePath("/dashboard", "layout");
const MANAGERS = ["super_admin", "project_manager"] as const;

export async function postAnnouncement(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession([...MANAGERS]);
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(z.object({ project_id: uuid, title: text(3, 160), body: text(5, 4000) }), formData);
  if (parsed.error) return parsed.error;
  const { error } = await session.supabase.from("project_announcements").insert(parsed.data);
  if (error) return dbError(error);
  refresh();
  return ok("Announcement posted. All project participants were notified.");
}

export async function scheduleMeeting(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession([...MANAGERS]);
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(
    z.object({
      project_id: uuid,
      title: text(3, 160),
      scheduled_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "must be a valid date and time"),
      location: optionalText(300),
      agenda: optionalText(4000),
    }),
    formData,
  );
  if (parsed.error) return parsed.error;
  // The form collects East Africa Time.
  const { scheduled_at, ...fields } = parsed.data;
  const { error } = await session.supabase.from("project_meetings").insert({ ...fields, scheduled_at: `${scheduled_at}:00+03:00` });
  if (error) return dbError(error);
  refresh();
  return ok("Meeting scheduled. All project participants were notified.");
}

export async function saveMeetingMinutes(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession([...MANAGERS]);
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(z.object({ meeting_id: uuid, minutes: text(5, 8000) }), formData);
  if (parsed.error) return parsed.error;
  const { data, error } = await session.supabase
    .from("project_meetings")
    .update({ minutes: parsed.data.minutes })
    .eq("id", parsed.data.meeting_id)
    .select("id");
  if (error) return dbError(error);
  if (!data.length) return fail("The meeting was not found or you are not permitted to edit it.");
  refresh();
  return ok("Meeting record saved.");
}

/** Feedback or grievance from any project participant. Visible only to the sender and the people who handle it. */
export async function submitGrievance(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession();
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(
    z.object({ project_id: uuid, kind: z.enum(["feedback", "grievance"]), subject: text(3, 160), description: text(10, 4000) }),
    formData,
  );
  if (parsed.error) return parsed.error;
  const { error } = await session.supabase.from("grievances").insert({ ...parsed.data, submitted_by: session.user.id });
  if (error) return dbError(error);
  refresh();
  return ok("Submitted. The project manager has been notified and you can follow the status here.");
}

export async function respondToGrievance(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession([...MANAGERS]);
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(
    z.object({ grievance_id: uuid, status: z.enum(["open", "in_review", "resolved", "closed"]), response: optionalText(4000) }),
    formData,
  );
  if (parsed.error) return parsed.error;
  const { grievance_id, status, response } = parsed.data;
  if ((status === "resolved" || status === "closed") && !response) return fail("Add a response before resolving or closing.");
  const { data, error } = await session.supabase.from("grievances").update({ status, response }).eq("id", grievance_id).select("id");
  if (error) return dbError(error);
  if (!data.length) return fail("The record was not found or you are not permitted to handle it.");
  refresh();
  return ok("Response saved. The sender was notified.");
}

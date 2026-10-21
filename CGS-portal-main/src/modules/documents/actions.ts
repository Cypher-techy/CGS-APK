"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { activeSession, NOT_ALLOWED } from "@/lib/auth";
import { dbError, fail, ok, optionalText, parseForm, text, uuid } from "@/lib/actions";
import { DOCUMENT_CATEGORIES } from "@/lib/constants";
import { BUCKET, isFile, storeFile } from "@/modules/documents/storage";
import type { ActionState } from "@/lib/types";

const refresh = () => revalidatePath("/dashboard", "layout");
const categories = Object.keys(DOCUMENT_CATEGORIES).filter((c) => c !== "monitoring_evidence") as [string, ...string[]];

export async function uploadDocument(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession();
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(
    z.object({ project_id: uuid, title: text(2, 160), category: z.enum(categories), description: optionalText(1000) }),
    formData,
  );
  if (parsed.error) return parsed.error;
  const file = formData.get("file");
  if (!isFile(file)) return fail("Choose a file to upload.");

  const { supabase, user } = session;
  const upload = await storeFile(supabase, parsed.data.project_id, file);
  if (!upload.stored) return fail(upload.error);

  const { error } = await supabase.from("documents").insert({ ...parsed.data, ...upload.stored, uploaded_by: user.id });
  if (error) {
    await supabase.storage.from(BUCKET).remove([upload.stored.storage_path]);
    return dbError(error);
  }
  refresh();
  return ok("Document uploaded. It is now awaiting review.");
}

export async function reviewDocument(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession(["super_admin", "project_manager"]);
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(
    z.object({ document_id: uuid, decision: z.enum(["approved", "rejected"]), review_notes: optionalText(1000) }),
    formData,
  );
  if (parsed.error) return parsed.error;
  const { document_id, decision, review_notes } = parsed.data;
  if (decision === "rejected" && !review_notes) return fail("Add a note explaining why the document is rejected.");
  const { data, error } = await session.supabase
    .from("documents")
    .update({ review_status: decision, review_notes })
    .eq("id", document_id)
    .select("id");
  if (error) return dbError(error);
  if (!data.length) return fail("The document was not found or you are not permitted to review it.");
  refresh();
  return ok(`Document ${decision}.`);
}

export async function deleteDocument(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession();
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(z.object({ document_id: uuid }), formData);
  if (parsed.error) return parsed.error;
  const { supabase, profile } = session;

  const { data: doc } = await supabase
    .from("documents")
    .select("id, storage_path, uploaded_by, review_status, project:projects(manager_id)")
    .eq("id", parsed.data.document_id)
    .maybeSingle();
  if (!doc) return fail("Document not found.");
  // Same rule as the database delete policy, checked up front so the file is never removed
  // for a record that must stay.
  const manager = (doc.project as unknown as { manager_id: string | null } | null)?.manager_id;
  const manages = profile.role === "super_admin" || (profile.role === "project_manager" && manager === profile.id);
  if (!manages && !(doc.uploaded_by === profile.id && doc.review_status === "pending")) {
    return fail("You can only delete your own documents while they are pending review.");
  }
  // The stored file is readable only while its record exists, so it is removed first.
  const { error: storageError } = await supabase.storage.from(BUCKET).remove([doc.storage_path]);
  if (storageError) return fail("The stored file could not be removed. Please try again.");
  const { data, error } = await supabase.from("documents").delete().eq("id", doc.id).select("id");
  if (error) return dbError(error);
  if (!data.length) return fail("The document record could not be deleted.");
  refresh();
  return ok("Document deleted.");
}

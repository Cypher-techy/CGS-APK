"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { dbError, fail, ok, optionalDate, optionalNumber, optionalText, optionalUuid, parseForm, text, uuid } from "@/lib/actions";
import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import type { ActionState } from "@/lib/types";
import { CONTENT_TYPES, FERD_ROLES, FERD_UPLOAD_MAX_BYTES, FERD_UPLOAD_MAX_LABEL, FERD_UPLOAD_TYPES, REGNO_EXAMPLE, REGNO_PATTERN, regnoKey, type FerdRole } from "@/modules/ferd/constants";
import { reconcile } from "@/modules/ferd/mpesa";
import { staffSession } from "@/modules/ferd/session";

// Every action runs as the signed-in member of staff, so Row Level Security and the database triggers
// decide what is allowed. The role checks here only give a clear message early.
const DENIED = "You are not signed in as FERD staff, or your role does not allow this.";
const NO_ROWS = "Nothing was changed. The record was not found or your role does not allow this change.";
const refresh = () => revalidatePath("/ferd", "layout");
const CONTENT_EDITORS: FerdRole[] = ["department_admin", "content_manager", "opportunities_manager", "project_manager"];
const list = (value: string | null) => (value ?? "").split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

/* ------------------------------------------------------------------ students */

export async function reviewStudent(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await staffSession(["department_admin"]);
  if (!session) return fail(DENIED);
  const parsed = parseForm(
    z.object({ user_id: uuid, status: z.enum(["pending", "verified", "rejected", "suspended"]), department_id: optionalUuid, status_note: optionalText(500) }),
    formData,
  );
  if (parsed.error) return parsed.error;
  const { user_id, status, department_id, status_note } = parsed.data;
  if (status === "verified" && !department_id) return fail("Choose the student's department before verifying the account.");
  if ((status === "rejected" || status === "suspended") && !status_note) return fail("Give a short reason. The student sees it on their status page.");
  // The department is only changed when one was chosen; a rejection never clears it.
  const changes = { status, status_note, ...(department_id ? { department_id } : {}) };
  const { data, error } = await session.supabase.from("ferd_students").update(changes).eq("user_id", user_id).select("user_id");
  if (error) return dbError(error);
  if (!data.length) return fail(NO_ROWS);
  refresh();
  return ok(`Student ${status === "verified" ? "verified" : `marked ${status}`}.`);
}

/** Corrects a verified record (name or registration number). The change is written to the audit log. */
export async function correctStudent(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await staffSession(["department_admin"]);
  if (!session) return fail(DENIED);
  const parsed = parseForm(z.object({ user_id: uuid, full_name: text(2, 120), reg_no: z.string().trim().max(40) }), formData);
  if (parsed.error) return parsed.error;
  const key = regnoKey(parsed.data.reg_no);
  if (!REGNO_PATTERN.test(key)) return fail(`registration number: use the format ${REGNO_EXAMPLE}`);
  const { data, error } = await session.supabase
    .from("ferd_students")
    .update({ full_name: parsed.data.full_name, reg_no: parsed.data.reg_no.trim().toUpperCase(), reg_no_key: key })
    .eq("user_id", parsed.data.user_id)
    .select("user_id");
  if (error) return error.code === "23505" ? fail("Another account already uses that registration number.") : dbError(error);
  if (!data.length) return fail(NO_ROWS);
  refresh();
  return ok("Record corrected.");
}

/** Official student records, one per line: "registration number, full name". Used to help reviewers. */
export async function importStudentRecords(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await staffSession(["department_admin"]);
  if (!session) return fail(DENIED);
  const parsed = parseForm(z.object({ department_id: uuid, records: z.string().trim().min(5, "paste at least one record").max(200_000) }), formData);
  if (parsed.error) return parsed.error;
  const rows: { reg_no_key: string; full_name: string; department_id: string; added_by: string }[] = [];
  const bad: string[] = [];
  for (const line of parsed.data.records.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const [number, ...name] = line.split(/[,;\t]/);
    const key = regnoKey(number ?? "");
    const fullName = name.join(" ").trim();
    if (REGNO_PATTERN.test(key) && fullName.length >= 2) rows.push({ reg_no_key: key, full_name: fullName.slice(0, 120), department_id: parsed.data.department_id, added_by: session.user.id });
    else bad.push(line.slice(0, 40));
  }
  if (rows.length === 0) return fail(`No valid lines. Use: registration number, full name. Numbers are written like ${REGNO_EXAMPLE}.`);
  if (rows.length > 5000) return fail("Import at most 5,000 records at a time.");
  const { error } = await session.supabase.from("ferd_student_records").upsert(rows, { onConflict: "reg_no_key" });
  if (error) return dbError(error);
  refresh();
  return ok(`${rows.length} record${rows.length === 1 ? "" : "s"} saved.${bad.length ? ` ${bad.length} line${bad.length === 1 ? "" : "s"} skipped (first: “${bad[0]}”).` : ""}`);
}

/* ------------------------------------------------------------------ content */

const contentSchema = z.object({
  id: optionalUuid,
  type: z.enum(Object.keys(CONTENT_TYPES) as [string, ...string[]], { message: "choose a content type" }),
  title: text(3, 200),
  summary: optionalText(500),
  body: optionalText(30000),
  course_id: optionalUuid,
  tier: z.enum(["free", "premium"]),
  product_id: optionalUuid,
  status: z.enum(["draft", "published", "unpublished", "archived"]),
  publish_at: z.string().max(30).default(""),
  expires_at: z.string().max(30).default(""),
  source: optionalText(200),
  external_url: optionalText(500),
  tags: z.string().max(500).default(""),
  organization: optionalText(160),
  eligibility: optionalText(500),
  location: optionalText(160),
  mode: optionalText(40),
  starts_at: optionalDate,
  ends_at: optionalDate,
  last_verified: optionalDate,
});

/** Reads a <input type="datetime-local"> value (Nairobi time) as an ISO timestamp, or null. */
function localDateTime(value: string): string | null | undefined {
  if (!value) return null;
  const date = new Date(/T/.test(value) ? `${value}:00+03:00` : `${value}T00:00:00+03:00`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Validates and stores a content item. Returns the failure to show, or the id of the saved item. */
async function persistContent(formData: FormData): Promise<ActionState | { id: string; created: boolean }> {
  const session = await staffSession(CONTENT_EDITORS);
  if (!session) return fail(DENIED);
  const parsed = parseForm(contentSchema, formData);
  if (parsed.error) return parsed.error;
  const { id, publish_at, expires_at, tags, organization, eligibility, location, mode, starts_at, ends_at, last_verified, ...fields } = parsed.data;
  const departments = formData.getAll("departments").map(String).filter((value) => uuid.safeParse(value).success);
  const publishAt = localDateTime(publish_at);
  const expiresAt = localDateTime(expires_at);
  if (publishAt === undefined || expiresAt === undefined) return fail("Enter valid publication and expiry dates.");
  if (publishAt && expiresAt && expiresAt <= publishAt) return fail("The expiry date must be after the publication date.");
  if (fields.external_url && !/^https?:\/\//i.test(fields.external_url)) return fail("link: must start with http:// or https://");
  if (fields.tier === "premium" && !fields.product_id) return fail("Premium content must belong to a premium library.");
  const meta = Object.fromEntries(Object.entries({ organization, eligibility, location, mode, starts_at, ends_at, last_verified }).filter(([, value]) => value));
  const row = {
    ...fields,
    product_id: fields.tier === "premium" ? fields.product_id : null,
    departments,
    publish_at: publishAt ?? (fields.status === "published" && !id ? new Date().toISOString() : publishAt),
    expires_at: expiresAt,
    tags: list(tags).slice(0, 12).map((tag) => tag.slice(0, 40)),
    meta,
  };

  let contentId = id;
  if (id) {
    const { data, error } = await session.supabase.from("ferd_content").update(row).eq("id", id).select("id");
    if (error) return dbError(error);
    if (!data.length) return fail(NO_ROWS);
  } else {
    const { data, error } = await session.supabase.from("ferd_content").insert(row).select("id").single();
    if (error) return dbError(error);
    contentId = data.id;
  }
  refresh();
  return { id: contentId as string, created: !id };
}

export async function saveContent(_: ActionState, formData: FormData): Promise<ActionState> {
  const result = await persistContent(formData);
  if (!result || "ok" in result) return result;
  if (result.created) redirect(`/ferd/admin/content/${result.id}?created=1`);
  return ok("Saved. The change is live for students now.");
}

/** Creates an item and returns its id, so the new-content form can upload the chosen files to it. */
export async function createContent(formData: FormData): Promise<{ error: string } | { id: string }> {
  formData.delete("id");
  const result = await persistContent(formData);
  if (!result) return { error: "The item could not be saved." };
  return "ok" in result ? { error: result.message } : { id: result.id };
}

/** Publish, unpublish or archive from the list, without opening the editor. */
export async function setContentStatus(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await staffSession(CONTENT_EDITORS);
  if (!session) return fail(DENIED);
  const parsed = parseForm(z.object({ id: uuid, status: z.enum(["draft", "published", "unpublished", "archived"]) }), formData);
  if (parsed.error) return parsed.error;
  const changes: Record<string, unknown> = { status: parsed.data.status };
  if (parsed.data.status === "published") {
    const { data: current } = await session.supabase.from("ferd_content").select("publish_at").eq("id", parsed.data.id).maybeSingle();
    if (current && !current.publish_at) changes.publish_at = new Date().toISOString();
  }
  const { data, error } = await session.supabase.from("ferd_content").update(changes).eq("id", parsed.data.id).select("id");
  if (error) return dbError(error);
  if (!data.length) return fail(NO_ROWS);
  refresh();
  return ok(`Status set to ${parsed.data.status}.`);
}

export async function deleteContent(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await staffSession(CONTENT_EDITORS);
  if (!session) return fail(DENIED);
  const parsed = parseForm(z.object({ id: uuid }), formData);
  if (parsed.error) return parsed.error;
  const { supabase } = session;
  const { data: files } = await supabase.from("ferd_files").select("storage_path").eq("content_id", parsed.data.id);
  const { data, error } = await supabase.from("ferd_content").delete().eq("id", parsed.data.id).select("id");
  if (error) return dbError(error);
  if (!data.length) return fail(NO_ROWS);
  if (files?.length) await supabase.storage.from("ferd-files").remove(files.map((f) => f.storage_path));
  refresh();
  redirect("/ferd/admin/content?deleted=1");
}

// Uploads do not pass through this server: a web server limits the size of a request (about 4.5 MB on
// Vercel), which is smaller than most manuals. The browser asks for one-time upload links, sends each file
// straight to private storage, then asks for the files to be recorded.
type UploadKind = "attachment" | "image";

function uploadProblem(name: string, size: number, kind: UploadKind): string | null {
  const mime = FERD_UPLOAD_TYPES[name.split(".").pop()?.toLowerCase() ?? ""];
  if (!mime) return `“${name}”: this file type is not allowed. Allowed: ${Object.keys(FERD_UPLOAD_TYPES).join(", ")}.`;
  if (kind === "image" && !mime.startsWith("image/")) return `“${name}” is not an image. Gallery photos must be JPG, PNG or WEBP.`;
  if (size <= 0) return `“${name}” is empty.`;
  if (size > FERD_UPLOAD_MAX_BYTES) return `“${name}” is larger than ${FERD_UPLOAD_MAX_LABEL}.`;
  return null;
}

/** Step 1: checks the staff member, the item and the files, and returns a one-time upload link per file. */
export async function prepareContentUploads(
  contentId: string, kind: UploadKind, files: { name: string; size: number }[],
): Promise<{ error: string } | { uploads: { path: string; url: string; mime: string }[] }> {
  const session = await staffSession(CONTENT_EDITORS);
  if (!session) return { error: DENIED };
  const parsed = z.object({
    contentId: uuid, kind: z.enum(["attachment", "image"]),
    files: z.array(z.object({ name: z.string().min(1).max(300), size: z.number().int().nonnegative() })).min(1).max(10),
  }).safeParse({ contentId, kind, files });
  if (!parsed.success) return { error: "Choose between 1 and 10 files." };
  const { supabase } = session;
  // The content row is read first: RLS hides it from staff who may not edit it.
  const { data: content } = await supabase.from("ferd_content").select("id").eq("id", parsed.data.contentId).maybeSingle();
  if (!content) return { error: NO_ROWS };
  for (const file of parsed.data.files) {
    const problem = uploadProblem(file.name, file.size, parsed.data.kind);
    if (problem) return { error: problem };
  }
  const uploads = [];
  for (const file of parsed.data.files) {
    const extension = file.name.split(".").pop()!.toLowerCase();
    // The stored name is generated; the original name is kept only as a label.
    const path = `${content.id}/${randomUUID()}.${extension}`;
    const { data, error } = await supabase.storage.from("ferd-files").createSignedUploadUrl(path);
    if (error || !data) return { error: "An upload link could not be created. Your role may not allow uploads." };
    uploads.push({ path, url: data.signedUrl, mime: FERD_UPLOAD_TYPES[extension] });
  }
  return { uploads };
}

/** Step 2: records the files that arrived. Size and type are read from storage, not from the browser. */
export async function registerContentUploads(contentId: string, kind: UploadKind, caption: string, files: { path: string; name: string }[]): Promise<ActionState> {
  const session = await staffSession(CONTENT_EDITORS);
  if (!session) return fail(DENIED);
  const parsed = z.object({
    contentId: uuid, kind: z.enum(["attachment", "image"]), caption: z.string().trim().max(300),
    files: z.array(z.object({ path: z.string().max(200), name: z.string().min(1).max(300) })).min(1).max(10),
  }).safeParse({ contentId, kind, caption, files });
  if (!parsed.success) return fail("The upload could not be recorded.");
  const { supabase, user } = session;
  const { data: content } = await supabase.from("ferd_content").select("id").eq("id", parsed.data.contentId).maybeSingle();
  if (!content) return fail(NO_ROWS);
  const bucket = supabase.storage.from("ferd-files");
  const { count } = await supabase.from("ferd_files").select("id", { count: "exact", head: true }).eq("content_id", content.id);

  let saved = 0;
  for (const file of parsed.data.files) {
    // Only an object inside this item's own folder, under a generated name, can be recorded.
    const match = /^([0-9a-f-]{36})\/([0-9a-f-]{36}\.([a-z0-9]+))$/.exec(file.path);
    if (!match || match[1] !== content.id) return fail(`“${file.name}” could not be recorded (${saved} of ${parsed.data.files.length} saved).`);
    const { data: stored } = await bucket.list(content.id, { search: match[2], limit: 1 });
    const object = stored?.find((item) => item.name === match[2]);
    if (!object) return fail(`“${file.name}” did not reach storage (${saved} of ${parsed.data.files.length} saved). Try again.`);
    const size = Number(object.metadata?.size ?? 0);
    const problem = uploadProblem(file.name, size, parsed.data.kind) ?? (FERD_UPLOAD_TYPES[match[3]] ? null : "This file type is not allowed.");
    if (problem) {
      await bucket.remove([file.path]);
      return fail(problem);
    }
    const { error } = await supabase.from("ferd_files").insert({
      content_id: content.id, kind: parsed.data.kind, storage_path: file.path, file_name: file.name.replace(/[^\w.\- ()]/g, "_").slice(-200),
      mime_type: FERD_UPLOAD_TYPES[match[3]], size_bytes: size, caption: parsed.data.caption || null, sort_order: (count ?? 0) + saved, uploaded_by: user.id,
    });
    if (error) {
      // A path that is already recorded belongs to an existing file and must not be removed.
      if (error.code !== "23505") await bucket.remove([file.path]);
      return dbError(error);
    }
    saved++;
  }
  refresh();
  return ok(`${saved} file${saved === 1 ? "" : "s"} uploaded.`);
}

export async function updateFile(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await staffSession(CONTENT_EDITORS);
  if (!session) return fail(DENIED);
  const parsed = parseForm(z.object({ file_id: uuid, caption: optionalText(300), sort_order: z.coerce.number().int().min(0).max(999).default(0) }), formData);
  if (parsed.error) return parsed.error;
  const { data, error } = await session.supabase.from("ferd_files").update({ caption: parsed.data.caption, sort_order: parsed.data.sort_order }).eq("id", parsed.data.file_id).select("id");
  if (error) return dbError(error);
  if (!data.length) return fail(NO_ROWS);
  refresh();
  return ok("File details saved.");
}

export async function deleteFile(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await staffSession(CONTENT_EDITORS);
  if (!session) return fail(DENIED);
  const parsed = parseForm(z.object({ file_id: uuid }), formData);
  if (parsed.error) return parsed.error;
  const { data, error } = await session.supabase.from("ferd_files").delete().eq("id", parsed.data.file_id).select("storage_path");
  if (error) return dbError(error);
  if (!data.length) return fail(NO_ROWS);
  await session.supabase.storage.from("ferd-files").remove([data[0].storage_path]);
  refresh();
  return ok("File removed.");
}

/* ------------------------------------------------------------------ courses */

export async function saveCourse(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await staffSession(["department_admin"]);
  if (!session) return fail(DENIED);
  const parsed = parseForm(
    z.object({ department_id: uuid, code: text(2, 20), title: text(3, 160), year_of_study: optionalNumber(1, 8), semester: optionalNumber(1, 3), description: optionalText(1000) }),
    formData,
  );
  if (parsed.error) return parsed.error;
  const { error } = await session.supabase.from("ferd_courses").insert({ ...parsed.data, code: parsed.data.code.toUpperCase() });
  if (error) return error.code === "23505" ? fail("That department already has a unit with this code.") : dbError(error);
  refresh();
  return ok("Unit added.");
}

export async function setCourseActive(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await staffSession(["department_admin"]);
  if (!session) return fail(DENIED);
  const parsed = parseForm(z.object({ id: uuid, active: z.enum(["true", "false"]) }), formData);
  if (parsed.error) return parsed.error;
  const { data, error } = await session.supabase.from("ferd_courses").update({ is_active: parsed.data.active === "true" }).eq("id", parsed.data.id).select("id");
  if (error) return dbError(error);
  if (!data.length) return fail(NO_ROWS);
  refresh();
  return ok("Unit updated.");
}

/* ------------------------------------------------------------------ products and entitlements (Super Admin) */

export async function saveProduct(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await staffSession([]);
  if (!session) return fail(DENIED);
  const parsed = parseForm(
    z.object({
      id: optionalUuid, name: text(3, 120), description: optionalText(3000), terms: optionalText(3000),
      price_kes: z.coerce.number({ message: "enter a price" }).int("must be a whole number of shillings").min(1).max(150_000),
      department_id: optionalUuid, is_active: z.enum(["true", "false"]),
    }),
    formData,
  );
  if (parsed.error) return parsed.error;
  const { id, is_active, description, terms, ...fields } = parsed.data;
  const row = { ...fields, description: description ?? "", terms: terms ?? "", is_active: is_active === "true" };
  // A price change applies to future purchases only: finished payments and existing entitlements keep their own record.
  const result = id
    ? await session.supabase.from("ferd_products").update(row).eq("id", id).select("id")
    : await session.supabase.from("ferd_products").insert({ ...row, slug: `${slugify(fields.name)}-${randomUUID().slice(0, 4)}`, created_by: session.user.id }).select("id");
  if (result.error) return dbError(result.error);
  if (!result.data.length) return fail(NO_ROWS);
  refresh();
  return ok(id ? "Library updated. Existing purchases are unaffected." : "Library created.");
}

/** Gives a student a library without payment (for example a bursary). Super Admin only, recorded in the audit log. */
export async function grantEntitlement(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await staffSession([]);
  if (!session) return fail(DENIED);
  const parsed = parseForm(z.object({ product_id: uuid, reg_no: z.string().trim().max(40), note: text(5, 300) }), formData);
  if (parsed.error) return parsed.error;
  const { supabase, user } = session;
  const { data: student } = await supabase.from("ferd_students").select("user_id, status").eq("reg_no_key", regnoKey(parsed.data.reg_no)).maybeSingle();
  if (!student) return fail("No student with that registration number.");
  if (student.status !== "verified") return fail("Only a verified student can be given a library.");
  const { data: existing } = await supabase.from("ferd_entitlements").select("id, revoked_at").eq("user_id", student.user_id).eq("product_id", parsed.data.product_id).maybeSingle();
  if (existing && !existing.revoked_at) return fail("This student already has the library.");
  const result = existing
    ? await supabase.from("ferd_entitlements").update({ revoked_at: null, note: parsed.data.note }).eq("id", existing.id).select("id")
    : await supabase.from("ferd_entitlements").insert({ user_id: student.user_id, product_id: parsed.data.product_id, source: "grant", granted_by: user.id, note: parsed.data.note }).select("id");
  if (result.error) return dbError(result.error);
  if (!result.data.length) return fail(NO_ROWS);
  refresh();
  return ok("Library granted.");
}

export async function setEntitlementRevoked(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await staffSession([]);
  if (!session) return fail(DENIED);
  const parsed = parseForm(z.object({ id: uuid, revoked: z.enum(["true", "false"]), note: text(5, 300) }), formData);
  if (parsed.error) return parsed.error;
  const { data, error } = await session.supabase
    .from("ferd_entitlements")
    .update({ revoked_at: parsed.data.revoked === "true" ? new Date().toISOString() : null, note: parsed.data.note })
    .eq("id", parsed.data.id)
    .select("id");
  if (error) return dbError(error);
  if (!data.length) return fail(NO_ROWS);
  refresh();
  return ok(parsed.data.revoked === "true" ? "Access withdrawn." : "Access restored.");
}

/* ------------------------------------------------------------------ payments (finance) */

/** Asks Safaricom about a pending payment. It can only move a payment to the outcome Safaricom reports. */
export async function reconcilePayment(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await staffSession(["finance_admin"]);
  if (!session) return fail(DENIED);
  const parsed = parseForm(z.object({ id: uuid }), formData);
  if (parsed.error) return parsed.error;
  const { data: payment } = await session.supabase.from("ferd_payments").select("id, status, checkout_request_id").eq("id", parsed.data.id).maybeSingle();
  if (!payment) return fail(NO_ROWS);
  if (payment.status !== "pending") return ok(`This payment is already final (${payment.status}).`);
  if (!adminConfigured()) return fail("The server is not configured to reach M-Pesa.");
  const status = await reconcile(payment);
  refresh();
  return status === "pending" ? ok("Safaricom has no final result for this payment yet. Nothing was changed.") : ok(`Safaricom reports: ${status}. The record was updated.`);
}

/* ------------------------------------------------------------------ settings (Super Admin) */

/** Switches automatic verification of new students on or off. */
export async function saveFerdSettings(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await staffSession([]);
  if (!session) return fail(DENIED);
  const parsed = parseForm(z.object({ auto_verify_students: z.enum(["true", "false"]) }), formData);
  if (parsed.error) return parsed.error;
  const auto = parsed.data.auto_verify_students === "true";
  const { data, error } = await session.supabase
    .from("ferd_settings")
    .update({ auto_verify_students: auto, updated_by: session.user.id, updated_at: new Date().toISOString() })
    .eq("id", true)
    .select("id");
  if (error) return dbError(error);
  if (!data.length) return fail(NO_ROWS);
  refresh();
  return ok(auto ? "New students are now verified automatically when their registration number matches a department." : "New students now wait for an administrator to verify them.");
}

export async function saveDepartment(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await staffSession([]);
  if (!session) return fail(DENIED);
  const parsed = parseForm(
    z.object({
      id: uuid, name: text(3, 80), tagline: optionalText(200), description: optionalText(2000), focus_areas: z.string().max(600).default(""),
      accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, "must be a colour such as #4cc38a"), is_active: z.enum(["true", "false"]),
    }),
    formData,
  );
  if (parsed.error) return parsed.error;
  const { id, focus_areas, is_active, ...fields } = parsed.data;
  const { data, error } = await session.supabase
    .from("ferd_departments")
    .update({ ...fields, focus_areas: list(focus_areas).slice(0, 12).map((area) => area.slice(0, 40)), is_active: is_active === "true", updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id");
  if (error) return dbError(error);
  if (!data.length) return fail(NO_ROWS);
  refresh();
  return ok("Department saved.");
}

export async function savePrefixRule(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await staffSession([]);
  if (!session) return fail(DENIED);
  const parsed = parseForm(z.object({ prefix: z.string().trim().max(14), department_id: uuid, note: optionalText(300) }), formData);
  if (parsed.error) return parsed.error;
  const prefix = regnoKey(parsed.data.prefix);
  if (!/^[A-Z0-9/]{1,12}$/.test(prefix)) return fail("prefix: use letters, digits and “/”, for example N12/");
  const { error } = await session.supabase.from("ferd_prefix_rules").insert({ prefix, department_id: parsed.data.department_id, note: parsed.data.note, created_by: session.user.id });
  if (error) return error.code === "23505" ? fail("A rule for that prefix already exists.") : dbError(error);
  refresh();
  return ok(`Rule added: ${prefix}. It applies to new registrations; existing students keep their department until an administrator changes it.`);
}

export async function updatePrefixRule(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await staffSession([]);
  if (!session) return fail(DENIED);
  const parsed = parseForm(z.object({ id: uuid, intent: z.enum(["enable", "disable", "delete"]) }), formData);
  if (parsed.error) return parsed.error;
  const table = session.supabase.from("ferd_prefix_rules");
  const result = parsed.data.intent === "delete" ? await table.delete().eq("id", parsed.data.id).select("id") : await table.update({ is_active: parsed.data.intent === "enable" }).eq("id", parsed.data.id).select("id");
  if (result.error) return dbError(result.error);
  if (!result.data.length) return fail(NO_ROWS);
  refresh();
  return ok("Prefix rule updated.");
}

export async function saveModule(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await staffSession([]);
  if (!session) return fail(DENIED);
  const parsed = parseForm(
    z.object({ key: z.string().regex(/^[a-z_]{2,30}$/), label: text(2, 40), description: optionalText(200), sort_order: z.coerce.number().int().min(0).max(99), is_enabled: z.enum(["true", "false"]) }),
    formData,
  );
  if (parsed.error) return parsed.error;
  const { key, is_enabled, ...fields } = parsed.data;
  if (key === "dashboard" && is_enabled === "false") return fail("The dashboard cannot be switched off: it is where students land.");
  const { data, error } = await session.supabase.from("ferd_modules").update({ ...fields, is_enabled: is_enabled === "true", updated_at: new Date().toISOString() }).eq("key", key).select("key");
  if (error) return dbError(error);
  if (!data.length) return fail(NO_ROWS);
  refresh();
  return ok("Module saved. Menus update immediately.");
}

/** Per-department override of a module: show or hide it, rename it, or move it. */
export async function saveDepartmentModule(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await staffSession([]);
  if (!session) return fail(DENIED);
  const parsed = parseForm(
    z.object({ department_id: uuid, module_key: z.string().regex(/^[a-z_]{2,30}$/), is_enabled: z.enum(["true", "false"]), label: optionalText(40), sort_order: optionalNumber(0, 99) }),
    formData,
  );
  if (parsed.error) return parsed.error;
  if (parsed.data.module_key === "dashboard" && parsed.data.is_enabled === "false") return fail("The dashboard cannot be switched off.");
  const { error } = await session.supabase
    .from("ferd_department_modules")
    .upsert({ ...parsed.data, is_enabled: parsed.data.is_enabled === "true" }, { onConflict: "department_id,module_key" });
  if (error) return dbError(error);
  refresh();
  return ok("Department setting saved.");
}

/* ------------------------------------------------------------------ staff (Super Admin) */

export async function saveStaff(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await staffSession([]);
  if (!session) return fail(DENIED);
  const parsed = parseForm(
    z.object({ email: z.string().trim().toLowerCase().email("enter a valid e-mail address"), role: z.enum(Object.keys(FERD_ROLES) as [FerdRole, ...FerdRole[]]), department_id: optionalUuid }),
    formData,
  );
  if (parsed.error) return parsed.error;
  if (parsed.data.role === "department_admin" && !parsed.data.department_id) return fail("A department admin must be assigned to a department.");
  if (!adminConfigured()) return fail("The server is not configured to look up accounts.");
  // The account lookup uses the server key because staff may not read other people's profiles; the role
  // itself is written with the caller's own session, so the database confirms they are a Super Admin.
  const { data: account } = await createAdminClient().from("profiles").select("id").eq("email", parsed.data.email).maybeSingle();
  if (!account) return fail("No account uses that e-mail address. The person must first register an account on Cypher Green Systems.");
  if (account.id === session.user.id) return fail("You cannot change your own role.");
  const { error } = await session.supabase
    .from("ferd_staff")
    .upsert({ user_id: account.id, role: parsed.data.role, department_id: parsed.data.department_id, granted_by: session.user.id }, { onConflict: "user_id" });
  if (error) return dbError(error);
  refresh();
  return ok(`${FERD_ROLES[parsed.data.role].label} role saved for ${parsed.data.email}.`);
}

export async function removeStaff(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await staffSession([]);
  if (!session) return fail(DENIED);
  const parsed = parseForm(z.object({ user_id: uuid }), formData);
  if (parsed.error) return parsed.error;
  if (parsed.data.user_id === session.user.id) return fail("You cannot remove your own role.");
  const { data, error } = await session.supabase.from("ferd_staff").delete().eq("user_id", parsed.data.user_id).select("user_id");
  if (error) return dbError(error);
  if (!data.length) return fail(NO_ROWS);
  refresh();
  return ok("Staff role removed.");
}

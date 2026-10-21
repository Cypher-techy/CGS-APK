"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { activeSession, NOT_ALLOWED } from "@/lib/auth";
import { dbError, fail, ok, optionalText, parseForm, text, uuid } from "@/lib/actions";
import { ORGANIZATION_KINDS } from "@/lib/constants";
import type { ActionState } from "@/lib/types";

const refresh = () => revalidatePath("/dashboard", "layout");
const NO_ROWS = "The organization was not found or you are not permitted to change it.";

/** Registers an organization. The person who registers it becomes its administrator; CGS verifies it later. */
export async function createOrganization(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession();
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(
    z.object({
      name: text(2, 160),
      kind: z.enum(Object.keys(ORGANIZATION_KINDS) as [string, ...string[]]),
      country: text(2, 80),
      county: optionalText(80),
      website: optionalText(200),
      description: optionalText(1000),
    }),
    formData,
  );
  if (parsed.error) return parsed.error;
  if (parsed.data.website && !/^https?:\/\//i.test(parsed.data.website)) return fail("website: must start with http:// or https://");
  const { error } = await session.supabase.from("organizations").insert(parsed.data);
  if (error) return error.code === "23505" ? fail("An organization with that name is already registered.") : dbError(error);
  refresh();
  return ok("Organization registered. A CGS administrator will verify it.");
}

/** CGS administrators confirm (or withdraw confirmation) that an organization is genuine. */
export async function setOrganizationVerified(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession(["super_admin"]);
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(z.object({ organization_id: uuid, verified: z.enum(["true", "false"]) }), formData);
  if (parsed.error) return parsed.error;
  const is_verified = parsed.data.verified === "true";
  const { data, error } = await session.supabase.from("organizations").update({ is_verified }).eq("id", parsed.data.organization_id).select("id");
  if (error) return dbError(error);
  if (!data.length) return fail(NO_ROWS);
  refresh();
  return ok(is_verified ? "Organization verified." : "Verification withdrawn.");
}

export async function addOrganizationMember(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession();
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(
    z.object({ organization_id: uuid, email: z.string().trim().email("enter a valid e-mail address").max(160), member_role: z.enum(["admin", "member"]) }),
    formData,
  );
  if (parsed.error) return parsed.error;
  const { error } = await session.supabase.rpc("add_organization_member", {
    p_org: parsed.data.organization_id,
    p_email: parsed.data.email,
    p_role: parsed.data.member_role,
  });
  if (error) return dbError(error);
  refresh();
  return ok("Member added to the organization.");
}

export async function removeOrganizationMember(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession();
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(z.object({ organization_id: uuid, user_id: uuid }), formData);
  if (parsed.error) return parsed.error;
  const { supabase } = session;
  // An organization must keep at least one administrator.
  const { data: admins } = await supabase.from("organization_members").select("user_id").eq("organization_id", parsed.data.organization_id).eq("member_role", "admin");
  if (admins && admins.length === 1 && admins[0].user_id === parsed.data.user_id) return fail("An organization must keep at least one administrator.");
  const { data, error } = await supabase
    .from("organization_members")
    .delete()
    .eq("organization_id", parsed.data.organization_id)
    .eq("user_id", parsed.data.user_id)
    .select("user_id");
  if (error) return dbError(error);
  if (!data.length) return fail(NO_ROWS);
  refresh();
  return ok("Member removed.");
}

export async function deleteOrganization(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession(["super_admin"]);
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(z.object({ organization_id: uuid }), formData);
  if (parsed.error) return parsed.error;
  const { data, error } = await session.supabase.from("organizations").delete().eq("id", parsed.data.organization_id).select("id");
  if (error) return dbError(error);
  if (!data.length) return fail(NO_ROWS);
  refresh();
  return ok("Organization deleted. Its projects are kept without an organization.");
}

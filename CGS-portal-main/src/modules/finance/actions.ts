"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { activeSession, NOT_ALLOWED } from "@/lib/auth";
import { dbError, fail, ok, optionalDate, optionalNumber, optionalText, optionalUuid, parseForm, text, uuid } from "@/lib/actions";
import type { ActionState } from "@/lib/types";

const refresh = () => revalidatePath("/dashboard", "layout");
const MANAGERS = ["super_admin", "project_manager"] as const;
const NO_ROWS = "The record was not found or you are not permitted to change it.";

/**
 * Financial records are bookkeeping entries made by the project manager or an administrator.
 * The portal does not move money: a benefit-sharing "payment" here records a payment made elsewhere.
 */
export async function addFinancialRecord(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession([...MANAGERS]);
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(
    z.object({
      project_id: uuid,
      kind: z.enum(["budget", "expense", "income", "benefit_payment"]),
      category: optionalText(80),
      description: text(3, 500),
      amount: z.coerce.number({ message: "must be a number" }).positive("must be greater than zero").max(1e13, "is too large"),
      currency: z.enum(["KES", "USD", "EUR"]),
      record_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a valid date"),
      payment_status: z.enum(["planned", "pending", "paid"]),
      beneficiary: optionalText(160),
    }),
    formData,
  );
  if (parsed.error) return parsed.error;
  if (parsed.data.kind === "benefit_payment" && !parsed.data.beneficiary) return fail("Name the beneficiary of a benefit-sharing payment.");
  const { error } = await session.supabase.from("financial_records").insert(parsed.data);
  if (error) return dbError(error);
  refresh();
  return ok("Financial record added.");
}

export async function setPaymentStatus(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession([...MANAGERS]);
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(z.object({ record_id: uuid, payment_status: z.enum(["planned", "pending", "paid"]) }), formData);
  if (parsed.error) return parsed.error;
  const { data, error } = await session.supabase
    .from("financial_records")
    .update({ payment_status: parsed.data.payment_status })
    .eq("id", parsed.data.record_id)
    .select("id");
  if (error) return dbError(error);
  if (!data.length) return fail(NO_ROWS);
  refresh();
  return ok("Payment status updated.");
}

export async function deleteFinancialRecord(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession([...MANAGERS]);
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(z.object({ record_id: uuid }), formData);
  if (parsed.error) return parsed.error;
  const { data, error } = await session.supabase.from("financial_records").delete().eq("id", parsed.data.record_id).select("id");
  if (error) return dbError(error);
  if (!data.length) return fail(NO_ROWS);
  refresh();
  return ok("Financial record deleted.");
}

export async function addBenefitTerm(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession([...MANAGERS]);
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(
    z.object({
      project_id: uuid,
      beneficiary: text(2, 160),
      share_percent: optionalNumber(0, 100),
      description: text(5, 2000),
      agreed_on: optionalDate,
      document_id: optionalUuid,
    }),
    formData,
  );
  if (parsed.error) return parsed.error;
  const { supabase } = session;
  if (parsed.data.share_percent !== null) {
    const { data: existing } = await supabase.from("benefit_sharing_terms").select("share_percent").eq("project_id", parsed.data.project_id);
    const total = (existing ?? []).reduce((sum, t) => sum + Number(t.share_percent ?? 0), 0) + parsed.data.share_percent;
    if (total > 100) return fail(`Shares would add up to ${total}%. The total cannot exceed 100%.`);
  }
  const { error } = await supabase.from("benefit_sharing_terms").insert(parsed.data);
  if (error) return dbError(error);
  refresh();
  return ok("Benefit-sharing term recorded.");
}

export async function deleteBenefitTerm(_: ActionState, formData: FormData): Promise<ActionState> {
  const session = await activeSession([...MANAGERS]);
  if (!session) return fail(NOT_ALLOWED);
  const parsed = parseForm(z.object({ term_id: uuid }), formData);
  if (parsed.error) return parsed.error;
  const { data, error } = await session.supabase.from("benefit_sharing_terms").delete().eq("id", parsed.data.term_id).select("id");
  if (error) return dbError(error);
  if (!data.length) return fail(NO_ROWS);
  refresh();
  return ok("Benefit-sharing term removed.");
}

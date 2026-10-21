import { z } from "zod";
import type { ActionState } from "@/lib/types";

export const ok = (message: string): ActionState => ({ ok: true, message });
export const fail = (message: string): ActionState => ({ ok: false, message });

/** Turns a database error into a message that is safe and useful to show to the user. */
export function dbError(error: { message: string; code?: string }): ActionState {
  switch (error.code) {
    case "P0001": // raised by a workflow trigger; the text is written for end users
      return fail(error.message);
    case "42501":
      return fail("You do not have permission to perform this action.");
    case "23505":
      return fail("A record with these details already exists.");
    case "23503":
      return fail("This record is still referenced by other records and cannot be changed that way.");
    case "23514":
      return fail("One or more values are outside the allowed range.");
    default:
      console.error("Database error:", error.code, error.message);
      return fail("The operation could not be completed. Please try again.");
  }
}

/** Validates form fields (files excluded) against a schema. */
export function parseForm<T extends z.ZodType>(
  schema: T,
  formData: FormData,
): { data: z.infer<T>; error?: undefined } | { data?: undefined; error: NonNullable<ActionState> } {
  const raw: Record<string, unknown> = {};
  formData.forEach((value, key) => {
    if (typeof value === "string") raw[key] = value;
  });
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue.path.length ? `${String(issue.path[0]).replace(/_/g, " ")}: ` : "";
    return { error: { ok: false, message: `${field}${issue.message}` } };
  }
  return { data: result.data };
}

// Reusable field schemas. Empty form inputs become null.
const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);

export const text = (min: number, max: number) => z.string().trim().min(min, `must be at least ${min} characters`).max(max, `must be at most ${max} characters`);
export const optionalText = (max: number) => z.preprocess(blankToNull, z.string().trim().max(max, `must be at most ${max} characters`).nullable().default(null));
export const uuid = z.string().uuid("is not a valid reference");
export const optionalUuid = z.preprocess(blankToNull, z.string().uuid("is not a valid reference").nullable().default(null));
export const optionalDate = z.preprocess(blankToNull, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a valid date").nullable().default(null));
export const optionalNumber = (min: number, max: number) =>
  z.preprocess(blankToNull, z.coerce.number().min(min, `must be at least ${min}`).max(max, `must be at most ${max}`).nullable().default(null));

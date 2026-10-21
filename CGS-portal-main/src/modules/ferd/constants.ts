import type { Tone } from "@/lib/constants";

/** Same normalisation as private.ferd_regno_key in the database: upper case, letters, digits and "/" only. */
export const regnoKey = (value: string) => value.trim().toUpperCase().replace(/[^A-Z0-9/]/g, "");
/**
 * A registration number is written N12/12345/25: a letter and two digits (the programme prefix), the
 * student's serial number, and the two-digit year of admission. The database enforces the same shape.
 */
export const REGNO_PATTERN = /^[A-Z][0-9]{2}\/[0-9]{3,6}\/[0-9]{2}$/;
export const REGNO_EXAMPLE = "N12/12345/25";

/**
 * Accepts a Kenyan mobile number written as 07XX XXX XXX, 01XX XXX XXX or +254 7XX / +254 1XX (with or
 * without the plus sign, spaces or dashes) and returns it as 2547XXXXXXXX or 2541XXXXXXXX, the form M-Pesa
 * expects. Null for anything else. Every student has one on file: it is where the payment prompt is sent.
 */
export function normalizePhone(input: string): string | null {
  // Digits in other scripts (for example from a phone keyboard) are read as ordinary digits.
  let digits = input.normalize("NFKC").replace(/[^0-9]/g, "");
  // Strip whatever stands in front of the nine-digit subscriber number: an international call prefix (00),
  // the country code (254), and the trunk zero, which people often keep after the country code (+254 07…).
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("254")) digits = digits.slice(3);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return /^[17][0-9]{8}$/.test(digits) ? `254${digits}` : null;
}
/** 254712345678 → 0712 345 678, for display. */
/** The accepted ways of writing a phone number, for hints and error messages. */
export const PHONE_FORMATS = "07XX XXX XXX, 01XX XXX XXX or +254 7XX XXX XXX";

/**
 * Says what is wrong with a phone number that normalizePhone rejected, so the person can fix it:
 * most rejections are one digit too many or too few.
 */
export function phoneProblem(input: string): string {
  let digits = input.normalize("NFKC").replace(/[^0-9]/g, "");
  if (!digits) return `Enter your mobile number as ${PHONE_FORMATS}.`;
  const typed = digits.length;
  if (digits.startsWith("00")) digits = digits.slice(2);
  const international = digits.startsWith("254");
  if (international) digits = digits.slice(3);
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (!/^[17]/.test(digits)) return `That does not look like a Kenyan mobile number. It should start with 07 or 01 (or +254 7 / +254 1). Use ${PHONE_FORMATS}.`;
  if (digits.length !== 9) {
    const expected = typed - digits.length + 9;
    return `That number has ${typed} digits; written this way it should have ${expected}. Check for ${digits.length > 9 ? "an extra" : "a missing"} digit. Example: ${international ? "+254 712 345 678" : "0712 345 678"}.`;
  }
  return `Enter your mobile number as ${PHONE_FORMATS}.`;
}
export const displayPhone = (phone: string | null | undefined) => (phone && /^254[0-9]{9}$/.test(phone) ? `0${phone.slice(3, 6)} ${phone.slice(6, 9)} ${phone.slice(9)}` : (phone ?? ""));

export type FerdRole = "super_admin" | "department_admin" | "content_manager" | "opportunities_manager" | "finance_admin" | "project_manager";

export const FERD_ROLES: Record<FerdRole, { label: string; summary: string }> = {
  super_admin: { label: "Platform Super Admin", summary: "Global control over FERD, departments, roles, features and settings." },
  department_admin: { label: "Department Admin", summary: "Manages content and students of one department." },
  content_manager: { label: "Content / Resource Manager", summary: "Manages learning content (all departments, or one if scoped)." },
  opportunities_manager: { label: "Opportunities Manager", summary: "Manages internships, scholarships, jobs and related listings." },
  finance_admin: { label: "Finance Admin", summary: "Views and reconciles payments. Cannot change them." },
  project_manager: { label: "Environmental Project Manager", summary: "Manages projects, datasets and reports." },
};

export const STUDENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Pending review", tone: "warning" },
  verified: { label: "Verified", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  suspended: { label: "Suspended", tone: "danger" },
};

export const CONTENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  published: { label: "Published", tone: "success" },
  scheduled: { label: "Scheduled", tone: "info" },
  expired: { label: "Expired", tone: "neutral" },
  unpublished: { label: "Unpublished", tone: "warning" },
  archived: { label: "Archived", tone: "neutral" },
};

export const PAYMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "warning" },
  success: { label: "Successful", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  expired: { label: "Expired", tone: "neutral" },
};

export type ContentGroup = "learning" | "manual" | "opportunity" | "event" | "community";

/** Every content type the CMS can publish, and the student page it appears on. */
export const CONTENT_TYPES: Record<string, { label: string; plural: string; group: ContentGroup }> = {
  note: { label: "Notes", plural: "Notes", group: "learning" },
  document: { label: "Document", plural: "Documents", group: "learning" },
  resource: { label: "Learning resource", plural: "Learning resources", group: "learning" },
  video: { label: "Video", plural: "Videos", group: "learning" },
  link: { label: "External link", plural: "External links", group: "learning" },
  dataset: { label: "Dataset / GIS resource", plural: "Datasets and GIS resources", group: "learning" },
  report: { label: "Report", plural: "Reports", group: "learning" },
  manual: { label: "Manual / study pack", plural: "Manuals and study packs", group: "manual" },
  internship: { label: "Internship", plural: "Internships", group: "opportunity" },
  attachment: { label: "Attachment", plural: "Attachments", group: "opportunity" },
  scholarship: { label: "Scholarship", plural: "Scholarships", group: "opportunity" },
  job: { label: "Job", plural: "Jobs", group: "opportunity" },
  graduate: { label: "Graduate opportunity", plural: "Graduate opportunities", group: "opportunity" },
  volunteering: { label: "Volunteering", plural: "Volunteering", group: "opportunity" },
  competition: { label: "Competition", plural: "Competitions", group: "opportunity" },
  research: { label: "Research opportunity", plural: "Research opportunities", group: "opportunity" },
  fellowship: { label: "Fellowship", plural: "Fellowships", group: "opportunity" },
  event: { label: "Event / field trip / workshop", plural: "Events", group: "event" },
  announcement: { label: "Announcement", plural: "Announcements", group: "community" },
  gallery: { label: "Photo gallery", plural: "Galleries", group: "community" },
  project: { label: "Project", plural: "Projects", group: "community" },
};

export const typesIn = (...groups: ContentGroup[]) => Object.keys(CONTENT_TYPES).filter((type) => groups.includes(CONTENT_TYPES[type].group));
export const OPPORTUNITY_TYPES = typesIn("opportunity");

/** Per file. Uploads travel through a server action, whose request body is capped at 32 MB (next.config.ts). */
/** Files that can be chosen in one go. They are sent to the server in batches of FERD_UPLOAD_BATCH. */
export const FERD_UPLOAD_MAX_FILES = 100;
export const FERD_UPLOAD_BATCH = 10;
// The storage bucket carries the same limit, and the Supabase project's own upload limit must allow it too
// (50 MB on the Free plan, whatever this says).
export const FERD_UPLOAD_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export const FERD_UPLOAD_MAX_LABEL = "2 GB";
/** Allowed uploads by extension. The storage bucket enforces the same list of types. */
export const FERD_UPLOAD_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  geojson: "application/geo+json",
  kml: "application/vnd.google-earth.kml+xml",
  zip: "application/zip",
  csv: "text/csv",
};

/** How a content row is shown to staff: its stored status, refined by the publication window. */
export function displayStatus(row: { status: string; publish_at: string | null; expires_at: string | null }, now = Date.now()): string {
  if (row.status !== "published") return row.status;
  if (row.expires_at && new Date(row.expires_at).getTime() <= now) return "expired";
  if (row.publish_at && new Date(row.publish_at).getTime() > now) return "scheduled";
  return "published";
}

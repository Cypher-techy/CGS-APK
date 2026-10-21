import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import type { FerdRole } from "@/modules/ferd/constants";

export const PREVIEW_COOKIE = "ferd_preview_dept";

export interface Department {
  id: string;
  slug: string;
  code: string;
  name: string;
  tagline: string | null;
  description: string | null;
  focus_areas: string[];
  accent: string;
}

export interface Student {
  user_id: string;
  reg_no: string;
  full_name: string;
  phone: string | null;
  year_of_study: number | null;
  department_id: string | null;
  status: "pending" | "verified" | "rejected" | "suspended";
  status_note: string | null;
}

/**
 * Who the current visitor is inside FERD: a student record, a staff role, both, or neither.
 * This only decides what the interface offers; every read and write is checked again by the database.
 */
export const getFerdSession = cache(async () => {
  const session = await getSession();
  if (!session) return null;
  const { supabase, user, profile } = session;
  const [{ data: student }, { data: staff }, { data: departments }] = await Promise.all([
    supabase.from("ferd_students").select("user_id, reg_no, full_name, phone, year_of_study, department_id, status, status_note").eq("user_id", user.id).maybeSingle(),
    supabase.from("ferd_staff").select("role, department_id").eq("user_id", user.id).maybeSingle(),
    supabase.from("ferd_departments").select("id, slug, code, name, tagline, description, focus_areas, accent").eq("is_active", true).order("sort_order"),
  ]);
  const suspended = profile.status === "suspended" || profile.status === "terminated";
  const cgsAdmin = profile.role === "super_admin" && profile.status === "active";
  const role: FerdRole | null = suspended ? null : cgsAdmin ? "super_admin" : ((staff?.role as FerdRole | undefined) ?? null);
  return {
    supabase,
    user,
    profile,
    student: (student as Student | null) ?? null,
    role,
    staffDepartmentId: (staff?.department_id as string | null | undefined) ?? null,
    departments: (departments ?? []) as Department[],
  };
});

export type FerdSession = NonNullable<Awaited<ReturnType<typeof getFerdSession>>>;

/** Any signed-in FERD user (student in any state, or staff). Others go to the FERD sign-in page. */
export async function requireFerdUser() {
  const session = await getFerdSession();
  if (!session) redirect("/ferd/login");
  // A Cypher Green Systems account without a student record can add one.
  if (!session.student && !session.role) redirect("/ferd/register");
  return session;
}

/**
 * A viewer of the student portal: a verified student in their own department, or a member of staff
 * previewing a department. Unverified students are sent to their status page.
 */
export async function requireViewer() {
  const session = await requireFerdUser();
  // Staff choose which department to preview; the choice is remembered in a cookie (see /ferd/preview).
  const deptSlug = (await cookies()).get(PREVIEW_COOKIE)?.value;
  const { student, role, departments, staffDepartmentId } = session;
  if (student?.status === "verified" && student.department_id) {
    const department = departments.find((d) => d.id === student.department_id);
    if (department) return { ...session, department, preview: false };
  }
  if (role) {
    const department = departments.find((d) => d.slug === deptSlug) ?? departments.find((d) => d.id === staffDepartmentId) ?? departments[0];
    if (department) return { ...session, department, preview: true };
  }
  redirect("/ferd/status");
}

export async function requireStaff(roles?: FerdRole[]) {
  const session = await requireFerdUser();
  if (!session.role) redirect("/ferd/dashboard");
  if (roles && session.role !== "super_admin" && !roles.includes(session.role)) redirect("/ferd/admin");
  return { ...session, role: session.role };
}

/** For server actions: null unless the caller is staff with one of the roles. */
export async function staffSession(roles?: FerdRole[]) {
  const session = await getFerdSession();
  if (!session?.role) return null;
  if (roles && session.role !== "super_admin" && !roles.includes(session.role)) return null;
  return { ...session, role: session.role };
}

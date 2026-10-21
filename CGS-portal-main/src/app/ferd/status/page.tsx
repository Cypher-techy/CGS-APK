import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { StatusBadge } from "@/components/ui";
import { ferdSignOut } from "@/modules/ferd/auth-actions";
import { STUDENT_STATUS } from "@/modules/ferd/constants";
import { FerdAuthCard } from "@/modules/ferd/FerdAuthCard";
import { requireFerdUser } from "@/modules/ferd/session";

export const metadata: Metadata = { title: "FERD account status" };
export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  pending: "Your registration has been received, but your account could not be opened automatically. This usually means your registration number did not match a department. A FERD administrator will review it, and you will be notified here.",
  rejected: "Your registration was not approved. If you believe this is a mistake, contact FERD support with your student ID.",
  suspended: "Your account is suspended. Contact FERD support for details.",
};

/** Where a signed-in student lands until their account is verified. */
export default async function FerdStatusPage() {
  const { student, role, departments } = await requireFerdUser();
  if (!student) redirect(role ? "/ferd/admin" : "/ferd/login");
  const department = departments.find((d) => d.id === student.department_id);
  if (student.status === "verified" && department) redirect("/ferd/dashboard");

  return (
    <FerdAuthCard title="Account status" lead={`${student.full_name} · ${student.reg_no}`}>
      <div className="space-y-4 text-sm">
        <p className="flex items-center gap-2">
          Status: <StatusBadge map={STUDENT_STATUS} value={student.status} />
        </p>
        <p className="text-charcoal">
          {student.status === "verified"
            ? "Your identity is verified, but your registration number does not match a department yet. An administrator will assign your department."
            : MESSAGES[student.status]}
        </p>
        {student.status_note && <p className="alert alert-info">Note from the administrator: {student.status_note}</p>}
        <p className="text-muted-grey">Department: {department?.name ?? "Not yet assigned"}</p>
        <div className="flex flex-wrap gap-2">
          <Link href="/ferd/help" className="btn btn-secondary">Help and support</Link>
          <form action={ferdSignOut}>
            <button type="submit" className="btn btn-secondary">Sign out</button>
          </form>
        </div>
      </div>
    </FerdAuthCard>
  );
}

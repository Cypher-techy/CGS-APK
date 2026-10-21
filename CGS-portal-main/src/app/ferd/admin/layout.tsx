import type { Metadata } from "next";
import type { ReactNode } from "react";
import { FERD_ROLES, type FerdRole } from "@/modules/ferd/constants";
import { FerdShell, type FerdNavItem } from "@/modules/ferd/FerdShell";
import { requireStaff } from "@/modules/ferd/session";

export const metadata: Metadata = { title: { default: "FERD administration", template: "%s | FERD admin" } };
export const dynamic = "force-dynamic";

// Which roles see which section. The pages and the database check again; this only shapes the menu.
const SECTIONS: (FerdNavItem & { roles: FerdRole[] | "all" })[] = [
  { label: "Overview", href: "/ferd/admin", icon: "dashboard", roles: "all" },
  { label: "Students", href: "/ferd/admin/students", icon: "user", roles: ["department_admin"] },
  { label: "Content library", href: "/ferd/admin/content", icon: "file", roles: ["department_admin", "content_manager", "opportunities_manager", "project_manager"] },
  { label: "Units", href: "/ferd/admin/courses", icon: "book", roles: ["department_admin"] },
  { label: "Libraries and access", href: "/ferd/admin/products", icon: "library", roles: ["finance_admin"] },
  { label: "Payments", href: "/ferd/admin/payments", icon: "briefcase", roles: ["finance_admin"] },
  { label: "Departments and features", href: "/ferd/admin/settings", icon: "folder", roles: [] },
  { label: "Staff and roles", href: "/ferd/admin/staff", icon: "shield", roles: [] },
  { label: "Audit log", href: "/ferd/admin/audit", icon: "megaphone", roles: [] },
  { label: "Student portal preview", href: "/ferd/dashboard", icon: "help", roles: "all" },
];

export default async function FerdAdminLayout({ children }: { children: ReactNode }) {
  const { role, profile } = await requireStaff();
  const nav = SECTIONS.filter((s) => s.roles === "all" || role === "super_admin" || s.roles.includes(role)).map(({ label, href, icon }) => ({ label, href, icon }));
  return (
    <FerdShell nav={nav} title="Administration" subtitle="FERD" accent="#f4783e" userName={profile.full_name} userLabel={FERD_ROLES[role].label}>
      {children}
    </FerdShell>
  );
}

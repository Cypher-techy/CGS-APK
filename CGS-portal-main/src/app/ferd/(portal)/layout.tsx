import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { FerdShell, type FerdNavItem } from "@/modules/ferd/FerdShell";
import { requireViewer } from "@/modules/ferd/session";

export const metadata: Metadata = { title: { default: "FERD Student Portal", template: "%s | FERD" } };
export const dynamic = "force-dynamic";

/**
 * Student portal frame. The menu is built from the module configuration in the database:
 * global order and labels, overridden per department, so it changes without a deployment.
 */
export default async function FerdPortalLayout({ children }: { children: ReactNode }) {
  const { supabase, user, student, role, department, departments, preview, profile } = await requireViewer();
  const [{ data: modules }, { data: overrides }, { count: unread }] = await Promise.all([
    supabase.from("ferd_modules").select("key, label, href, icon, sort_order, is_enabled").order("sort_order"),
    supabase.from("ferd_department_modules").select("module_key, is_enabled, label, sort_order").eq("department_id", department.id),
    supabase.from("ferd_notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("read_at", null),
  ]);
  const override = new Map((overrides ?? []).map((o) => [o.module_key, o]));
  const nav: FerdNavItem[] = (modules ?? [])
    .map((m) => {
      const o = override.get(m.key);
      return { key: m.key, label: o?.label ?? m.label, href: m.href, icon: m.icon, enabled: m.is_enabled && (o?.is_enabled ?? true), order: o?.sort_order ?? m.sort_order };
    })
    .filter((m) => m.enabled)
    .sort((a, b) => a.order - b.order)
    .map((m) => ({ label: m.label, href: m.href, icon: m.icon, badge: m.key === "notifications" ? (unread ?? 0) : undefined }));
  nav.push({ label: "Profile", href: "/ferd/profile", icon: "user" });
  if (role) nav.push({ label: "Administration", href: "/ferd/admin", icon: "shield" });

  return (
    <FerdShell
      nav={nav}
      title={department.name}
      accent={department.accent}
      userName={student?.full_name ?? profile.full_name}
      userLabel={student ? student.reg_no : "Staff preview"}
      notice={
        preview && (
          <div className="flex flex-wrap items-center gap-2 border-b border-amber-400/30 bg-amber-400/10 px-4 py-2 text-xs text-amber-200">
            <span>Staff preview of the student portal. Premium items are shown unlocked. Department:</span>
            {departments.map((d) => (
              <Link key={d.id} href={`/ferd/preview?dept=${d.slug}`} className={`rounded-full border px-2 py-0.5 ${d.id === department.id ? "border-amber-200 font-semibold" : "border-amber-400/30 hover:border-amber-200"}`}>
                {d.code}
              </Link>
            ))}
          </div>
        )
      }
    >
      {children}
    </FerdShell>
  );
}

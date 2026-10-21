import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { requireSession } from "@/lib/auth";
import { navFor, ROLE_LABELS } from "@/lib/constants";
import { signOut } from "@/modules/auth/actions";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const { supabase, profile } = await requireSession();
  const active = profile.status === "active" && !!profile.terms_accepted_at;

  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);

  return (
    <DashboardShell
      nav={active ? navFor(profile.role) : [{ label: "Dashboard", href: "/dashboard", icon: "dashboard" }]}
      userName={profile.full_name}
      roleLabel={ROLE_LABELS[profile.role]}
      unread={count ?? 0}
      signOut={signOut}
    >
      {children}
    </DashboardShell>
  );
}

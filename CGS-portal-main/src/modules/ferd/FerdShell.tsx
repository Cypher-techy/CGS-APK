import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import {
  ArrowLeft, Bell, BookOpen, Briefcase, CalendarDays, CircleHelp, FileText, Folder, GraduationCap, LayoutDashboard, Library, LogOut, Megaphone, Menu, ShieldCheck, Sparkles, User,
  type LucideIcon,
} from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { ferdSignOut } from "@/modules/ferd/auth-actions";

const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard, book: BookOpen, file: FileText, library: Library, briefcase: Briefcase,
  calendar: CalendarDays, megaphone: Megaphone, sparkles: Sparkles, bell: Bell, help: CircleHelp, folder: Folder, shield: ShieldCheck, user: User,
};

export interface FerdNavItem {
  label: string;
  href: string;
  icon: string;
  badge?: number;
}

/** Link back to the Cypher Green Systems home page, shown at the top of every FERD screen. */
export function BackToCgs({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`btn btn-secondary ${className}`} title="Back to the Cypher Green Systems home page">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      <span className="hidden sm:inline">Cypher Green Systems</span>
      <span className="sm:hidden">CGS</span>
    </Link>
  );
}

export function FerdBrand({ href = "/ferd" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--ferd-accent,#4cc38a)] text-night">
        <GraduationCap className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="leading-tight">
        <span className="block font-display text-[15px] font-bold text-white">FERD Student Portal</span>
        <span className="block text-[10px] uppercase tracking-[0.16em] text-muted-grey">Cypher Green Systems</span>
      </span>
    </Link>
  );
}

/** Frame of the signed-in FERD area (student portal and administration). The accent colour is the department's. */
export function FerdShell({
  nav,
  title,
  subtitle,
  accent = "#4cc38a",
  userName,
  userLabel,
  notice,
  children,
}: {
  nav: FerdNavItem[];
  title: string;
  subtitle?: string;
  accent?: string;
  userName: string;
  userLabel: string;
  notice?: ReactNode;
  children: ReactNode;
}) {
  const links = (
    <nav aria-label={`${title} navigation`} className="space-y-0.5">
      {nav.map((item) => {
        const Icon = ICONS[item.icon] ?? Folder;
        return (
          <Link key={item.href} href={item.href} className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-charcoal hover:bg-white/10">
            <Icon className="h-4 w-4 shrink-0 text-[var(--ferd-accent)]" aria-hidden="true" />
            <span className="truncate">{item.label}</span>
            {!!item.badge && <span className="ml-auto rounded-full bg-clay px-1.5 text-xs font-semibold tabular-nums text-white">{item.badge}</span>}
          </Link>
        );
      })}
    </nav>
  );
  return (
    <div className="flex min-h-screen bg-off-white" style={{ "--ferd-accent": accent } as CSSProperties}>
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-subtle-border bg-cream lg:flex">
        <div className="border-b border-subtle-border px-4 py-4">
          <FerdBrand />
        </div>
        <div className="border-b border-subtle-border px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ferd-accent)]">{subtitle ?? "Department"}</p>
          <p className="font-display text-base font-bold text-white">{title}</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2">{links}</div>
        <div className="border-t border-subtle-border p-3 text-xs text-muted-grey">
          <Link href="/" className="flex items-center gap-2 hover:text-white">
            <BrandMark className="h-5 w-5" /> Back to Cypher Green Systems
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-subtle-border bg-cream/90 px-3 backdrop-blur sm:px-5">
          <details className="relative lg:hidden">
            <summary className="btn btn-secondary list-none px-2.5 [&::-webkit-details-marker]:hidden" aria-label="Open menu">
              <Menu className="h-4 w-4" />
            </summary>
            <div className="glass-strong absolute left-0 top-full z-40 mt-2 w-64 rounded-3xl p-3 shadow-xl">{links}</div>
          </details>
          <p className="truncate font-display text-sm font-bold text-white lg:hidden">{title}</p>
          <div className="ml-auto flex items-center gap-2">
            <BackToCgs />
            <Link href="/ferd/profile" className="hidden text-right leading-tight sm:block">
              <span className="block max-w-48 truncate text-sm font-medium text-charcoal">{userName}</span>
              <span className="block max-w-48 truncate text-xs text-muted-grey">{userLabel}</span>
            </Link>
            <form action={ferdSignOut}>
              <button type="submit" className="btn btn-secondary px-2.5" title="Sign out" aria-label="Sign out">
                <LogOut className="h-4 w-4" />
              </button>
            </form>
          </div>
        </header>
        {notice}
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}

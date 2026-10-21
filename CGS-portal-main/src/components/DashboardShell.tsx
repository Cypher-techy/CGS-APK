"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import {
  Bell,
  Bookmark,
  Building2,
  Globe2,
  GraduationCap,
  Handshake,
  Map as MapIcon,
  Megaphone,
  Store,
  ChartColumn,
  CircleHelp,
  ClipboardCheck,
  FileText,
  Flag,
  Folder,
  History,
  LayoutDashboard,
  Leaf,
  ListTodo,
  LogOut,
  Menu,
  PanelLeft,
  Plus,
  Search,
  Settings,
  User,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import type { NavItem } from "@/lib/constants";

const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  users: Users,
  folder: Folder,
  check: ClipboardCheck,
  history: History,
  chart: ChartColumn,
  settings: Settings,
  tasks: ListTodo,
  flag: Flag,
  file: FileText,
  leaf: Leaf,
  bell: Bell,
  user: User,
  plus: Plus,
  map: MapIcon,
  store: Store,
  bookmark: Bookmark,
  handshake: Handshake,
  megaphone: Megaphone,
  globe: Globe2,
  building: Building2,
  graduation: GraduationCap,
};

function isActive(pathname: string, rawHref: string, all: NavItem[]): boolean {
  if (rawHref.includes("?")) return false;
  const href = rawHref;
  if (pathname === href) return true;
  if (href === "/dashboard" || !pathname.startsWith(`${href}/`)) return false;
  // A longer nav entry (e.g. "Submit Project") wins over its parent ("My Projects").
  return !all.some((item) => item.href.length > href.length && pathname.startsWith(item.href));
}

// The sidebar preference lives in localStorage so it survives navigation and reloads.
const SIDEBAR_KEY = "cgs-sidebar";
function subscribeSidebar(onChange: () => void) {
  window.addEventListener(SIDEBAR_KEY, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(SIDEBAR_KEY, onChange);
    window.removeEventListener("storage", onChange);
  };
}
function readSidebar() {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === "collapsed";
  } catch {
    return false;
  }
}

/** Application frame shared by every role: collapsible sidebar, top bar and content area. */
export function DashboardShell({
  nav,
  userName,
  roleLabel,
  unread,
  signOut,
  children,
}: {
  nav: NavItem[];
  userName: string;
  roleLabel: string;
  unread: number;
  signOut: () => Promise<void>;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(subscribeSidebar, readSidebar, () => false);
  const [mobileOpen, setMobileOpen] = useState(false);

  function toggleCollapsed() {
    try {
      window.localStorage.setItem(SIDEBAR_KEY, collapsed ? "open" : "collapsed");
    } catch {}
    window.dispatchEvent(new Event(SIDEBAR_KEY));
  }

  const sidebar = (compact: boolean) => (
    <nav aria-label="Main navigation" className="flex-1 space-y-0.5 overflow-y-auto p-2">
      {nav.map((item) => {
        const Icon = ICONS[item.icon] ?? Folder;
        const active = isActive(pathname, item.href, nav);
        return (
          <Link
            key={item.href}
            href={item.href}
            title={compact ? item.label : undefined}
            onClick={() => setMobileOpen(false)}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm ${
              active ? "bg-forest font-medium text-white" : "text-charcoal hover:bg-sand"
            } ${compact ? "justify-center px-0" : ""}`}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {!compact && <span className="truncate">{item.label}</span>}
            {!compact && item.icon === "bell" && unread > 0 && (
              <span className={`ml-auto rounded px-1.5 text-xs tabular-nums ${active ? "bg-white/20" : "bg-amber-400/20 text-amber-200"}`}>{unread}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  const brand = (compact: boolean) => (
    <Link href="/dashboard" className="flex h-14 items-center gap-2.5 border-b border-subtle-border px-3">
      <BrandMark className="h-8 w-8 shrink-0" />
      {!compact && <span className="truncate font-display text-sm font-semibold text-heading">Cypher Green Systems</span>}
    </Link>
  );

  return (
    <div className="flex min-h-screen bg-off-white">
      {/* Desktop sidebar */}
      <aside className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-subtle-border bg-cream md:flex ${collapsed ? "w-14" : "w-60"}`}>
        {brand(collapsed)}
        {sidebar(collapsed)}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="relative flex h-full w-64 flex-col bg-cream shadow-lg">
            {brand(false)}
            {sidebar(false)}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-subtle-border bg-cream/90 px-3 backdrop-blur sm:px-5">
          <button type="button" className="btn btn-secondary px-2 md:hidden" aria-label="Open menu" onClick={() => setMobileOpen(true)}>
            {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
          <button type="button" className="btn btn-secondary hidden px-2 md:inline-flex" aria-label="Toggle sidebar" aria-pressed={collapsed} onClick={toggleCollapsed}>
            <PanelLeft className="h-4 w-4" />
          </button>

          <form action="/dashboard/projects" role="search" className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-grey" aria-hidden="true" />
            <input name="q" type="search" placeholder="Search projects" aria-label="Search projects" className="input pl-8" />
          </form>

          <div className="ml-auto flex items-center gap-1.5">
            <Link href="/explore" className="btn btn-secondary hidden sm:inline-flex" title="Return to the Earth">
              <Globe2 className="h-4 w-4" /> <span className="hidden lg:inline">Explore Earth</span>
            </Link>
            <Link href="/contact" className="btn btn-secondary px-2" title="Help and support" aria-label="Help and support">
              <CircleHelp className="h-4 w-4" />
            </Link>
            <Link href="/dashboard/notifications" className="btn btn-secondary relative px-2" aria-label={`Notifications, ${unread} unread`}>
              <Bell className="h-4 w-4" />
              {unread > 0 && (
                <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-amber-500 px-1 text-center text-[10px] font-semibold leading-4 text-white">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </Link>
            <Link href="/dashboard/profile" className="hidden items-center gap-2 rounded-md px-2 py-1 hover:bg-sand sm:flex" title="Profile settings">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sage/40 text-xs font-semibold text-heading">
                {userName.slice(0, 1).toUpperCase()}
              </span>
              <span className="max-w-40 text-left leading-tight">
                <span className="block truncate text-sm font-medium text-charcoal">{userName}</span>
                <span className="block truncate text-xs text-muted-grey">{roleLabel}</span>
              </span>
            </Link>
            <Link href="/dashboard/profile" className="btn btn-secondary px-2 sm:hidden" aria-label="Profile settings">
              <User className="h-4 w-4" />
            </Link>
            <form action={signOut}>
              <button type="submit" className="btn btn-secondary px-2" title="Sign out" aria-label="Sign out">
                <LogOut className="h-4 w-4" />
              </button>
            </form>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}

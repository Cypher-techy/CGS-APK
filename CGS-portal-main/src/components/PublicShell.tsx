import Link from "next/link";
import type { ReactNode } from "react";
import { GraduationCap, Menu } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { CtaButton } from "@/components/Motion";
import { getSession } from "@/lib/auth";
import { PUBLIC_NAV, SITE } from "@/lib/site";

export function Brand({ href = "/" }: { light?: boolean; href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5">
      <BrandMark />
      <span className="leading-tight">
        <span className="block font-display text-[15px] font-bold text-white">{SITE.name}</span>
        <span className="block text-[10px] uppercase tracking-[0.16em] text-muted-grey">Environmental intelligence</span>
      </span>
    </Link>
  );
}

/**
 * Header and footer shared by all public pages: a fixed, transparent bar with a glass pill of links.
 * `immersive` is for the full-screen Earth: no footer and the page fills the viewport.
 */
export async function PublicShell({ children, immersive = false, cta = true }: { children: ReactNode; immersive?: boolean; cta?: boolean }) {
  const session = await getSession();
  const actions = session ? (
    <Link href="/dashboard" className="btn btn-primary">Open workspace</Link>
  ) : (
    <>
      <Link href="/login" className="btn btn-secondary">Sign in</Link>
      <Link href="/register" className="btn btn-primary">Register</Link>
    </>
  );

  return (
    <div className={`flex flex-col bg-off-white ${immersive ? "h-dvh" : "min-h-screen"}`}>
      {/* The bar is transparent; a fade to black keeps it readable over content that scrolls beneath it. */}
      <header className={`${immersive ? "relative" : "fixed inset-x-0 top-0 bg-gradient-to-b from-night from-40% to-transparent"} z-40`}>
        <div className="mx-auto flex max-w-[92rem] items-center justify-between gap-4 px-4 py-4 sm:px-8">
          <Brand />
          <nav aria-label="Main" className="glass hidden items-center gap-1 rounded-full p-1.5 text-sm text-white xl:flex">
            {PUBLIC_NAV.map((link) => (
              <Link key={link.href} href={link.href} className="rounded-full px-3.5 py-1.5 transition-colors hover:bg-white/15">
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="hidden items-center gap-2 sm:flex">
            <Link href="/ferd" className="btn btn-accent">
              <GraduationCap className="h-4 w-4" aria-hidden="true" /> FERD Student Portal
            </Link>
            {actions}
          </div>
          {/* Compact navigation for phones and tablets; works without JavaScript. */}
          <details className="relative xl:hidden">
            <summary className="btn btn-secondary list-none px-2.5 [&::-webkit-details-marker]:hidden" aria-label="Open menu">
              <Menu className="h-4 w-4" />
            </summary>
            <div className="glass-strong absolute right-0 top-full mt-2 w-64 rounded-3xl p-3 shadow-xl">
              <nav aria-label="Main (compact)" className="flex flex-col text-sm text-white">
                {PUBLIC_NAV.map((link) => (
                  <Link key={link.href} href={link.href} className="rounded-xl px-3 py-2 hover:bg-white/10">
                    {link.label}
                  </Link>
                ))}
              </nav>
              <Link href="/ferd" className="btn btn-accent mt-2 w-full sm:hidden">
                <GraduationCap className="h-4 w-4" aria-hidden="true" /> FERD Student Portal
              </Link>
              <div className="mt-2 flex flex-wrap gap-2 border-t border-subtle-border pt-3 sm:hidden">{actions}</div>
            </div>
          </details>
        </div>
      </header>

      <main className={immersive ? "min-h-0 flex-1" : "flex-1"}>{children}</main>

      {!immersive && (
        <footer className="relative overflow-hidden border-t border-subtle-border">
          {cta && (
            <div className="rings relative border-b border-subtle-border">
              <div className="mx-auto flex max-w-[92rem] flex-col items-center px-4 py-24 text-center sm:px-8 sm:py-32">
                <p className="kicker">It starts with a place</p>
                <h2 className="mt-4 max-w-4xl text-5xl font-bold leading-[0.95] text-white sm:text-7xl">Are you ready to explore the Earth?</h2>
                <div className="mt-10 flex flex-wrap justify-center gap-3">
                  <CtaButton href="/explore">Explore the Earth</CtaButton>
                  <CtaButton href="/dashboard/projects/new" clear>Create a Project</CtaButton>
                </div>
              </div>
            </div>
          )}
          <div className="mx-auto grid max-w-[92rem] gap-10 px-4 py-14 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div>
              <Brand />
              <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-grey">{SITE.positioning}. {SITE.descriptor}.</p>
            </div>
            <FooterColumn title="Platform" links={[["Explore the Earth", "/explore"], ["Environmental projects", "/projects"], ["Carbon marketplace", "/marketplace"], ["Features", "/features"], ["How it works", "/how-it-works"]]} />
            <FooterColumn title="Company" links={[["About CGS", "/about"], ["FAQ", "/faq"], ["Contact", "/contact"], ["Terms", "/terms"], ["Privacy Policy", "/privacy"]]} />
            <div>
              <h2 className="font-sans text-xs font-semibold uppercase tracking-[0.16em] text-white">We are always here</h2>
              <ul className="mt-4 space-y-2 text-sm text-muted-grey">
                <li>
                  <a href={`tel:+${SITE.phoneIntl}`} className="hover:text-white">{SITE.phoneDisplay}</a>
                </li>
                <li>
                  <a href={`https://wa.me/${SITE.phoneIntl}`} target="_blank" rel="noopener noreferrer" className="hover:text-white">WhatsApp</a>
                </li>
                {SITE.email && (
                  <li>
                    <a href={`mailto:${SITE.email}`} className="hover:text-white">{SITE.email}</a>
                  </li>
                )}
                <li>
                  <Link href="/contact" className="hover:text-white">Send a message</Link>
                </li>
              </ul>
            </div>
          </div>
          <div className="border-t border-subtle-border">
            <p className="mx-auto max-w-[92rem] px-4 py-5 text-xs text-muted-grey sm:px-8">
              © {new Date().getFullYear()} {SITE.name} ({SITE.short}). Carbon figures shown on this platform are estimates unless marked verified.
            </p>
          </div>
        </footer>
      )}
    </div>
  );
}

function FooterColumn({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h2 className="font-sans text-xs font-semibold uppercase tracking-[0.16em] text-white">{title}</h2>
      <ul className="mt-4 space-y-2 text-sm text-muted-grey">
        {links.map(([label, href]) => (
          <li key={href}>
            <Link href={href} className="hover:text-white">{label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Narrow text page (about, legal). */
export function Article({ title, lead, kicker, children }: { title: string; lead?: string; kicker?: string; children: ReactNode }) {
  return (
    <>
      <div className="contours border-b border-subtle-border">
        <div className="mx-auto max-w-4xl px-4 pb-14 pt-36 sm:px-8 sm:pt-44">
          {kicker && <p className="kicker">{kicker}</p>}
          <h1 className="mt-3 text-5xl font-bold leading-[0.98] text-white sm:text-7xl">{title}</h1>
          {lead && <p className="mt-6 max-w-2xl text-lg text-muted-grey sm:text-xl">{lead}</p>}
        </div>
      </div>
      <article className="mx-auto max-w-4xl px-4 py-14 sm:px-8">
        <div className="space-y-5 text-base leading-relaxed text-charcoal [&_h2]:mt-12 [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:text-white [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">
          {children}
        </div>
      </article>
    </>
  );
}

/** Section wrapper used by the marketing pages. `first` leaves room for the fixed navbar. */
export function Section({ kicker, title, lead, children, tone = "plain", first = false }: { kicker?: string; title: string; lead?: string; children: ReactNode; tone?: "plain" | "cream" | "dark"; first?: boolean }) {
  const tones = { plain: "", cream: "contours border-y border-subtle-border", dark: "rings border-y border-subtle-border" };
  return (
    <section className={tones[tone]}>
      <div className={`mx-auto max-w-[92rem] px-4 pb-20 sm:px-8 sm:pb-28 ${first ? "pt-36 sm:pt-44" : "pt-20 sm:pt-28"}`}>
        {kicker && <p className="kicker">{kicker}</p>}
        <h2 className="mt-3 max-w-4xl text-4xl font-bold leading-[1] text-white sm:text-6xl">{title}</h2>
        {lead && <p className="mt-5 max-w-2xl text-lg text-muted-grey">{lead}</p>}
        <div className="mt-12">{children}</div>
      </div>
    </section>
  );
}

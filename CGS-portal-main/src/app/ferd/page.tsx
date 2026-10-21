import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, Briefcase, CalendarDays, Library, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { BackToCgs, FerdBrand } from "@/modules/ferd/FerdShell";

export const metadata: Metadata = {
  title: "FERD Student Portal",
  description: "The FERD student portal: notes, manuals, opportunities and events for Environmental Science, Natural Resources and Geography students.",
};
export const dynamic = "force-dynamic";

const FEATURES = [
  { icon: BookOpen, title: "Notes and learning resources", body: "Unit notes, revision material, practical and fieldwork guides, datasets and GIS exercises published by your department." },
  { icon: Library, title: "All Units Manuals", body: "A premium manuals library per department, unlocked once with M-Pesa and kept on your account." },
  { icon: Briefcase, title: "Opportunities hub", body: "Internships, attachments, scholarships, jobs, competitions and research openings, each with its official link and deadline." },
  { icon: CalendarDays, title: "Events and fieldwork", body: "Field trips, workshops, practical sessions and photo galleries from your department." },
];

/** Public entry page of the FERD Student Portal. Separate from the CGS home page. */
export default async function FerdLandingPage() {
  const supabase = await createClient();
  const { data: departments } = await supabase.from("ferd_departments").select("id, code, name, tagline, focus_areas, accent").eq("is_active", true).order("sort_order");

  return (
    <div className="min-h-screen bg-off-white">
      <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-5 sm:px-8">
        <FerdBrand />
        <nav className="flex items-center gap-2" aria-label="FERD">
          <BackToCgs />
          <Link href="/ferd/help" className="btn btn-secondary hidden sm:inline-flex">Help</Link>
          <Link href="/ferd/login" className="btn btn-secondary">Sign in</Link>
          <Link href="/ferd/register" className="btn btn-primary">Register</Link>
        </nav>
      </header>

      <main>
        <section className="rings">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-8 sm:py-24">
            <p className="kicker">FERD Student Portal</p>
            <h1 className="mt-4 max-w-4xl text-5xl font-bold leading-[0.98] text-white sm:text-7xl">One portal for your department, your notes and your next opportunity.</h1>
            <p className="mt-6 max-w-2xl text-lg text-muted-grey">
              Sign in with your registration number to reach the dashboard of your own department: Environmental Science, Natural Resources or Geography.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/ferd/login" className="btn btn-accent btn-lg">Student sign in</Link>
              <Link href="/ferd/register" className="btn btn-secondary btn-lg">Create an account</Link>
            </div>
            <p className="mt-6 flex items-center gap-2 text-xs text-muted-grey">
              <ShieldCheck className="h-4 w-4 text-primary-green" aria-hidden="true" /> Your department is set from your registration number. Each student sees only their own department and account.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-14 sm:px-8">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">Three departments, three dashboards</h2>
          {(departments ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-muted-grey">Department information is not available right now.</p>
          ) : (
            <ul className="mt-8 grid gap-4 md:grid-cols-3">
              {(departments ?? []).map((d) => (
                <li key={d.id} className="card p-6" style={{ backgroundImage: `radial-gradient(ellipse 80% 80% at 100% 0%, ${d.accent}26, transparent 70%)` }}>
                  <span className="inline-block rounded-full px-2.5 py-0.5 text-xs font-bold text-night" style={{ background: d.accent }}>{d.code}</span>
                  <h3 className="mt-3 font-display text-2xl font-bold text-white">{d.name}</h3>
                  {d.tagline && <p className="mt-1.5 text-sm text-muted-grey">{d.tagline}</p>}
                  <ul className="mt-4 flex flex-wrap gap-1.5">
                    {((d.focus_areas ?? []) as string[]).map((area) => (
                      <li key={area} className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-charcoal">{area}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-8">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">What you will find inside</h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="card flex gap-4 p-6">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-clay text-white">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span>
                  <span className="block font-display text-xl font-bold text-white">{title}</span>
                  <span className="mt-1 block text-sm text-muted-grey">{body}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="border-t border-subtle-border">
        <p className="mx-auto flex max-w-6xl flex-wrap justify-between gap-3 px-4 py-6 text-xs text-muted-grey sm:px-8">
          <span>FERD Student Portal, part of Cypher Green Systems.</span>
          <span className="flex gap-4">
            <Link href="/" className="hover:text-white">Cypher Green Systems</Link>
            <Link href="/terms" className="hover:text-white">Terms</Link>
            <Link href="/privacy" className="hover:text-white">Privacy</Link>
            <Link href="/ferd/help" className="hover:text-white">Help</Link>
          </span>
        </p>
      </footer>
    </div>
  );
}

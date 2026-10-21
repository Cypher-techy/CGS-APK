import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell, Section } from "@/components/PublicShell";

export const metadata: Metadata = { title: "How It Works" };

const STEPS = [
  ["Register", "Create an account with e-mail or Google and confirm your address. CGS activates the account after review."],
  ["Place the project on the Earth", "The owner describes the project, selects its country and county, drops its location on the map and can draw or upload the boundary."],
  ["Review", "A CGS administrator approves the project, rejects it or asks for a revision, and assigns a project manager."],
  ["Map and organise", "GIS analysts refine the boundary and add sites. The manager builds the team, sets milestones and assigns tasks."],
  ["Monitor", "Field officers submit observations with measurements, GPS and photographs, online or offline. Each record is reviewed."],
  ["Report and assess", "MRV specialists record carbon estimates with their method. Summaries export as PDF or CSV from recorded data."],
  ["Publish and list", "The manager can publish the project to the public Explore map, and the owner can list it on the marketplace after CGS review."],
];

const DATA_LABELS = [
  ["User-submitted", "Entered by a project owner, such as the declared area. Not independently checked."],
  ["Derived", "Calculated by CGS from stored geometry, such as the mapped area in hectares."],
  ["Estimated", "Produced by a stated method and assumptions, such as carbon potential or satellite land cover."],
  ["Verified", "Confirmed by an independent body under a named standard. Shown only when that evidence is on file."],
];

export default function HowItWorksPage() {
  return (
    <PublicShell>
      <Section first kicker="How it works" title="A project's journey through CGS, from first idea to the public map" lead="Every step is recorded against the project and its location, with an audit trail of who did what.">
        <ol className="grid gap-4 md:grid-cols-2">
          {STEPS.map(([title, text], i) => (
            <li key={title} className="card flex gap-5 p-6">
              <span className="font-display text-5xl font-semibold leading-none text-sand">{i + 1}</span>
              <div>
                <h3 className="font-display text-xl font-semibold text-heading">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-grey">{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>
      <Section tone="cream" kicker="Data you can trust" title="Every figure states where it came from">
        <div className="grid gap-4 md:grid-cols-4">
          {DATA_LABELS.map(([label, text]) => (
            <div key={label} className="card p-5">
              <h3 className="font-display text-lg font-semibold text-heading">{label}</h3>
              <p className="mt-1.5 text-sm text-muted-grey">{text}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/register" className="btn btn-primary btn-lg">Create an account</Link>
          <Link href="/explore" className="btn btn-secondary btn-lg">Explore the Earth</Link>
        </div>
      </Section>
    </PublicShell>
  );
}

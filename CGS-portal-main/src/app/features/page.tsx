import type { Metadata } from "next";
import { PublicShell, Section } from "@/components/PublicShell";
import { Badge } from "@/components/ui";

export const metadata: Metadata = { title: "Features" };

type Status = "Available" | "Planned" | "Not offered";
const GROUPS: { title: string; items: [string, Status][] }[] = [
  {
    title: "Earth and GIS",
    items: [
      ["Interactive 3D Earth with drill-down from Earth to site", "Available"],
      ["2D GIS map with satellite, light and street basemaps", "Available"],
      ["Project boundaries in PostGIS with calculated area", "Available"],
      ["Boundary drawing and import (GeoJSON, KML, zipped shapefile)", "Available"],
      ["Project sites and monitoring points", "Available"],
      ["Kenya county outlines and country borders", "Available"],
      ["Land-cover classes per year inside a boundary (third-party satellite classification)", "Available"],
      ["Protected-area and forest-change layers", "Planned"],
      ["Sub-county outlines and other countries' administrative units", "Planned"],
    ],
  },
  {
    title: "Project operations",
    items: [
      ["Project registration, approval and public publishing", "Available"],
      ["Organizations with CGS verification", "Available"],
      ["Tasks, milestones, teams and comments", "Available"],
      ["Private documents and evidence with review status", "Available"],
      ["Notifications, deadline reminders and audit log", "Available"],
      ["Benefit-sharing terms and financial records", "Available"],
    ],
  },
  {
    title: "Monitoring and MRV",
    items: [
      ["Field reports with GPS, measurements and photographs", "Available"],
      ["Offline field capture with later synchronisation", "Available"],
      ["Monitoring schedules and data-quality checks", "Available"],
      ["Carbon estimates with method and assumptions", "Available"],
      ["Carbon project lifecycle stage per project", "Available"],
      ["Automated change alerts from satellite imagery", "Planned"],
    ],
  },
  {
    title: "Marketplace",
    items: [
      ["Reviewed project listings for investors and developers", "Available"],
      ["Enquiries with due diligence and negotiation status", "Available"],
      ["Investment workflows and registry integrations", "Planned"],
      ["Credit trading, pricing and payments", "Not offered"],
    ],
  },
];

export default function FeaturesPage() {
  return (
    <PublicShell>
      <Section first kicker="Features" title="What CGS does today, and what is still to come" lead="A feature is marked available only when it works in the current release.">
        <div className="grid gap-5 md:grid-cols-2">
          {GROUPS.map((group) => (
            <div key={group.title} className="card overflow-hidden">
              <h3 className="border-b border-subtle-border bg-cream px-5 py-3 font-display text-lg font-semibold text-heading">{group.title}</h3>
              <ul className="divide-y divide-subtle-border">
                {group.items.map(([name, status]) => (
                  <li key={name} className="flex items-start justify-between gap-4 px-5 py-3 text-sm">
                    <span>{name}</span>
                    <Badge tone={status === "Available" ? "success" : status === "Planned" ? "info" : "neutral"}>{status}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>
    </PublicShell>
  );
}

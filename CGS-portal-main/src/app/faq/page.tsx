import type { Metadata } from "next";
import Link from "next/link";
import { Article, PublicShell } from "@/components/PublicShell";

export const metadata: Metadata = { title: "FAQ" };

const FAQ: [string, string][] = [
  ["Who can use CGS?", "Project owners and landowners, project managers, GIS analysts, field officers, MRV specialists, investors and project developers, and community members. Each role sees only the tools and data it is permitted to see."],
  ["Why does my account say pending?", "New accounts are activated by a CGS administrator after review. You will be notified when your account is active."],
  ["Which projects appear on the public Earth?", "Only projects that CGS has approved and whose manager has chosen to publish them. A published project shows its name, category, location, boundary, sites and area. Owner identity, documents and individual field records stay private."],
  ["How do I put my project on the map?", "When you register a project, choose its country and county and click its location on the map. You can also draw the boundary or upload it as GeoJSON, KML or a zipped shapefile. CGS calculates the area from the boundary."],
  ["Are the carbon figures verified credits?", "No. Carbon figures in CGS are estimates recorded with their method and assumptions. A project is shown as verified or issued only when an independent body has confirmed it under a named standard and the evidence is on file."],
  ["Can I buy or sell carbon credits here?", "No. The marketplace is for discovering projects and making enquiries. CGS does not trade credits, process payments or promise financial returns."],
  ["Where does the map data come from?", "Country borders are from Natural Earth, Kenya county outlines from geoBoundaries (RCMRD), imagery from Esri and street maps from OpenStreetMap. Land cover is a third-party satellite classification that CGS has not ground-truthed. Layers that are not connected are shown as unavailable."],
  ["Does it work in the field without a connection?", "Field officers can capture reports offline on a device where they have signed in; the reports are sent when the connection returns."],
  ["Who can see my documents?", "Files are stored privately. Only authorised participants of the project can open them."],
];

export default function FaqPage() {
  return (
    <PublicShell>
      <Article kicker="FAQ" title="Frequently asked questions" lead="Short answers about accounts, the map, data and carbon claims.">
        <div className="space-y-3">
          {FAQ.map(([question, answer]) => (
            <details key={question} className="card px-5 py-4">
              <summary className="cursor-pointer list-none font-display text-lg font-semibold text-heading [&::-webkit-details-marker]:hidden">
                {question}
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-charcoal">{answer}</p>
            </details>
          ))}
        </div>
        <p>
          Something else? <Link href="/contact" className="link">Contact CGS</Link>.
        </p>
      </Article>
    </PublicShell>
  );
}

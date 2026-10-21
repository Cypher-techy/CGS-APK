import type { Metadata } from "next";
import Link from "next/link";
import { Article, PublicShell } from "@/components/PublicShell";

export const metadata: Metadata = { title: "About CGS" };

export default function AboutPage() {
  return (
    <PublicShell>
      <Article
        kicker="About"
        title="Environmental intelligence infrastructure, built in Africa for Africa"
        lead="Cypher Green Systems (CGS) builds the shared record that environmental and carbon projects need: where a project is, what is happening there, and what evidence supports it."
      >
        <h2>Our purpose</h2>
        <p>
          Environmental projects involve many parties: landowners, community groups, project managers, field teams and,
          later, developers and investors. CGS gives them one structured, access-controlled record of each project, anchored
          to its place on the Earth, so that everyone works from the same information.
        </p>
        <h2>What we have built</h2>
        <p>
          CGS combines project management, GIS, field monitoring, MRV records, document and evidence management, analytics
          and a carbon project marketplace. The interactive Earth is the way in: you move from the globe to Africa, to a
          country, a county, a project and a single site, and the tools you need are there at each level.
        </p>
        <h2>How we treat data</h2>
        <ul>
          <li>Each user sees only their own records and the projects they take part in. Publishing a project to the public map is a deliberate choice.</li>
          <li>Figures are labelled as user-submitted, derived, estimated or verified, and reports are generated from recorded data.</li>
          <li>Monitoring in CGS does not replace independent validation or verification under a carbon standard.</li>
          <li>We do not display sample or decorative statistics. Where there is no data, the platform says so.</li>
        </ul>
        <h2>Where we work</h2>
        <p>
          CGS starts in Kenya, with county-level navigation across all 47 counties, and is designed to extend to projects
          across the continent.
        </p>
        <p>
          <Link href="/explore" className="btn btn-primary">Explore the Earth</Link>
        </p>
      </Article>
    </PublicShell>
  );
}

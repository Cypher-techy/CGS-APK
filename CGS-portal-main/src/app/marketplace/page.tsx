import type { Metadata } from "next";
import Link from "next/link";
import { Article, PublicShell } from "@/components/PublicShell";
import { LIFECYCLE_STAGES } from "@/lib/constants";

export const metadata: Metadata = { title: "Carbon Project Marketplace" };

export default function MarketplaceInfoPage() {
  return (
    <PublicShell>
      <Article
        kicker="Carbon marketplace"
        title="A marketplace for discovering carbon projects, not for trading credits"
        lead="Registered investors and project developers browse approved listings, see each project's stage and evidence status, and enquire through a tracked workflow."
      >
        <h2>What is available today</h2>
        <ul>
          <li>Project owners list an approved project; CGS reviews the listing before it is published.</li>
          <li>Each listing states its development stage, the carbon standard where one applies, and whether supporting evidence is on file.</li>
          <li>Carbon figures are estimates, shown with the method and assumptions behind them.</li>
          <li>Investors save listings and send an expression of interest or a partnership enquiry, which moves through review, due diligence and negotiation statuses.</li>
        </ul>
        <h2>What it does not do</h2>
        <p>
          CGS does not trade, price or issue carbon credits, hold funds or process payments, and it does not promise financial returns.
          Investment workflows and registry integrations are planned for a later phase.
        </p>
        <h2>Carbon project lifecycle</h2>
        <ol className="grid gap-2 sm:grid-cols-2">
          {Object.values(LIFECYCLE_STAGES).map((stage, i) => (
            <li key={stage.label} className="card !ml-0 flex !list-none items-center gap-3 px-4 py-3">
              <span className="font-display text-2xl font-semibold text-sand">{String(i + 1).padStart(2, "0")}</span>
              <span>
                <span className="block font-semibold text-heading">{stage.label}</span>
                <span className="block text-xs text-muted-grey">Figures at this stage: {stage.evidence.toLowerCase()}</span>
              </span>
            </li>
          ))}
        </ol>
        <p>
          A stage describes the work in progress. A project is shown as validated, verified or issued only with a named standard and
          supporting evidence on file.
        </p>
        <p className="flex flex-wrap gap-3 pt-2">
          <Link href="/register" className="btn btn-primary">Register as an investor or developer</Link>
          <Link href="/dashboard/marketplace" className="btn btn-secondary">Open the marketplace</Link>
        </p>
      </Article>
    </PublicShell>
  );
}

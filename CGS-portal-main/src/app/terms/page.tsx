import type { Metadata } from "next";
import { Article, PublicShell } from "@/components/PublicShell";

export const metadata: Metadata = { title: "Terms and Conditions" };

export default function TermsPage() {
  return (
    <PublicShell>
      <Article title="Terms and Conditions" lead="Terms governing use of the Cypher Green Systems (CGS) platform.">
        <p className="alert alert-warning">
          Draft for pilot use. This text has not yet been reviewed by legal counsel and must be reviewed and approved
          by CGS before public launch.
        </p>
        <h2>1. The service</h2>
        <p>
          The platform is operated by Cypher Green Systems (CGS). It provides tools for registering,
          managing, monitoring and reporting on environmental projects. Features described as planned are not part of
          the service until released.
        </p>
        <h2>2. Accounts</h2>
        <ul>
          <li>You must provide accurate information and keep your password confidential.</li>
          <li>Accounts are activated by CGS and are assigned a role that determines what you can access.</li>
          <li>CGS may suspend or terminate an account that is misused or that breaches these terms.</li>
        </ul>
        <h2>3. Project submissions</h2>
        <ul>
          <li>You confirm that you are entitled to submit the project and the documents you upload.</li>
          <li>Submissions are reviewed by CGS, which may approve them, reject them or request a revision.</li>
          <li>Approval in the portal is an internal CGS decision. It is not certification under any carbon standard.</li>
        </ul>
        <h2>4. Monitoring data and carbon claims</h2>
        <p>
          Monitoring records are evidence supplied by project participants. Estimates are labelled as estimates. The
          portal does not verify emission reductions, issue carbon credits or facilitate their trade.
        </p>
        <h2>5. Acceptable use</h2>
        <p>
          You must not attempt to access records you are not authorised to see, upload unlawful or malicious content,
          or interfere with the operation of the service.
        </p>
        <h2>6. Changes and contact</h2>
        <p>
          CGS may update these terms and will notify registered users of material changes. Questions can be sent
          through the Contact and Support page.
        </p>
      </Article>
    </PublicShell>
  );
}

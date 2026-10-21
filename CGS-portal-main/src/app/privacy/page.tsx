import type { Metadata } from "next";
import { Article, PublicShell } from "@/components/PublicShell";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <PublicShell>
      <Article title="Privacy Policy" lead="How CGS handles personal data on the CGS platform, with reference to the Kenya Data Protection Act, 2019.">
        <p className="alert alert-warning">
          Draft for pilot use. This text has not yet been reviewed by legal counsel and must be reviewed and approved
          by CGS before public launch.
        </p>
        <h2>1. Data we collect</h2>
        <ul>
          <li>Account details: name, e-mail address and, if you provide them, phone number, organisation and location.</li>
          <li>Project information you submit, including land and location details and uploaded documents.</li>
          <li>Field monitoring records, including GPS coordinates and photographs.</li>
          <li>A record of important actions in the portal (audit log), linked to the account that performed them.</li>
        </ul>
        <h2>2. Why we use it</h2>
        <p>
          To operate your account, review and manage projects, send notifications about your projects and tasks, and
          keep the audit trail needed to run the platform securely.
        </p>
        <h2>3. Who can see it</h2>
        <p>
          Access is restricted by role and by project. Other users see your records only where they take part in the
          same project or are CGS administrators. CGS does not sell personal data.
        </p>
        <h2>4. Storage and security</h2>
        <p>
          Data is stored with our hosting and database providers, which may process it outside Kenya. Data is encrypted
          in transit, uploaded files are kept in private storage, and access rules are enforced in the database.
        </p>
        <h2>5. Cookies</h2>
        <p>The portal uses only the cookies required to keep you signed in. It does not use advertising or tracking cookies.</p>
        <h2>6. Your rights</h2>
        <p>
          Under the Data Protection Act, 2019 you may request access to your personal data, correction of inaccurate
          data, deletion where there is no lawful reason to keep it, and you may object to processing. Send requests
          through the Contact and Support page. You may also complain to the Office of the Data Protection Commissioner.
        </p>
        <h2>7. Retention</h2>
        <p>
          Account and project records are kept while the account or project is active and for as long as required
          afterwards for legal and audit purposes.
        </p>
      </Article>
    </PublicShell>
  );
}

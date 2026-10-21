import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { FerdAuthCard } from "@/modules/ferd/FerdAuthCard";

export const metadata: Metadata = { title: "FERD help" };

const FAQ: [string, string][] = [
  ["How do I sign in?", "With your university registration number (written like N12/12345/25) and the password you chose when you registered. You never sign in with an e-mail address."],
  ["Why can I not open the portal after registering?", "Normally you can sign in as soon as your account is created. If your account shows “Pending review”, your registration number did not match a department, or FERD has switched on manual review. An administrator will assign your department; you will see a notification when it is done."],
  ["My department is wrong or missing.", "The department is taken from your registration number. If the number does not match a known pattern, or the department is wrong, an administrator can correct it. Contact support with your student ID."],
  ["I forgot my password.", "Use “Forgot your password?” on the sign-in page and enter your registration number. The reset link is sent to the e-mail address on your account."],
  ["How do premium manuals work?", "A premium library is unlocked by one M-Pesa payment. After the payment is confirmed by Safaricom, every item in that library opens for your account. You are not charged per file."],
  ["I paid but the library is still locked.", "Open the checkout page again: it re-checks the payment with Safaricom. If it still shows pending after a few minutes, contact support with the M-Pesa confirmation code. Access is granted only from the confirmed transaction, never from a screenshot."],
  ["Can I share the manuals?", "No. They are for your personal study. Downloads are logged against your account."],
];

/** Public help page: reachable before sign-in and by students whose account is not yet verified. */
export default function FerdHelpPage() {
  return (
    <FerdAuthCard wide title="Help and support" lead="Answers to common questions about the FERD Student Portal." footer={<Link href="/ferd/login" className="link">Back to sign in</Link>}>
      <div className="space-y-2">
        {FAQ.map(([question, answer]) => (
          <details key={question} className="rounded-2xl border border-subtle-border bg-white/5 px-4 py-3">
            <summary className="cursor-pointer list-none text-sm font-semibold text-white [&::-webkit-details-marker]:hidden">{question}</summary>
            <p className="mt-2 text-sm leading-relaxed text-charcoal">{answer}</p>
          </details>
        ))}
      </div>
      <div className="mt-5 rounded-2xl bg-white/5 p-4 text-sm">
        <p className="font-semibold text-white">Contact support</p>
        <p className="mt-1 text-muted-grey">
          Phone: <a className="link" href={`tel:+${SITE.phoneIntl}`}>{SITE.phoneDisplay}</a> · <a className="link" href={`https://wa.me/${SITE.phoneIntl}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
          {SITE.email && <> · <a className="link" href={`mailto:${SITE.email}`}>{SITE.email}</a></>} · <Link className="link" href="/contact">Contact form</Link>
        </p>
      </div>
    </FerdAuthCard>
  );
}

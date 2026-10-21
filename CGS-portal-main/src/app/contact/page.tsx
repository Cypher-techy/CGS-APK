import type { Metadata } from "next";
import { Mail, MessageCircle, Phone } from "lucide-react";
import { z } from "zod";
import { ActionForm } from "@/components/ActionForm";
import { PublicShell } from "@/components/PublicShell";
import { Field } from "@/components/ui";
import { dbError, ok, parseForm, text } from "@/lib/actions";
import { SITE } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";

export const metadata: Metadata = { title: "Contact" };

async function sendMessage(_: ActionState, formData: FormData): Promise<ActionState> {
  "use server";
  const parsed = parseForm(
    z.object({
      full_name: text(2, 120),
      email: z.string().trim().email("enter a valid e-mail address").max(160),
      subject: text(3, 160),
      message: text(10, 4000),
    }),
    formData,
  );
  if (parsed.error) return parsed.error;
  const supabase = await createClient();
  const { error } = await supabase.from("contact_messages").insert(parsed.data);
  if (error) return dbError(error);
  return ok("Thank you. Your message has been received and CGS will reply by e-mail.");
}

export default function ContactPage() {
  const channels = [
    { icon: Phone, label: "Phone", value: SITE.phoneDisplay, href: `tel:+${SITE.phoneIntl}` },
    { icon: MessageCircle, label: "WhatsApp", value: "Chat with CGS", href: `https://wa.me/${SITE.phoneIntl}`, external: true },
    { icon: Mail, label: "E-mail", value: SITE.email ?? "Address to be announced. Use the form.", href: SITE.email ? `mailto:${SITE.email}` : undefined },
  ];
  return (
    <PublicShell>
      <div className="contours border-b border-subtle-border">
        <div className="mx-auto max-w-[92rem] px-4 pb-14 pt-36 sm:px-8 sm:pt-44">
          <p className="kicker">Contact</p>
          <h1 className="mt-3 max-w-4xl text-5xl font-bold leading-[0.98] text-white sm:text-7xl">Talk to {SITE.name}</h1>
          <p className="mt-4 max-w-2xl text-lg text-muted-grey">Questions about the platform, your account, a project submission or a partnership.</p>
        </div>
      </div>

      <div className="mx-auto grid max-w-[92rem] gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_1.4fr]">
        <div className="space-y-3">
          {channels.map(({ icon: Icon, label, value, href, external }) => {
            const body = (
              <>
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-forest text-white">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span>
                  <span className="block text-xs font-semibold uppercase tracking-wider text-muted-grey">{label}</span>
                  <span className="block font-display text-lg font-semibold text-heading">{value}</span>
                </span>
              </>
            );
            return href ? (
              <a key={label} href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})} className="card flex items-center gap-4 p-5 hover:border-sage">
                {body}
              </a>
            ) : (
              <div key={label} className="card flex items-center gap-4 p-5">{body}</div>
            );
          })}
          <div className="rounded-2xl bg-sand/60 p-5 text-sm text-charcoal">
            <p className="font-display text-lg font-semibold text-heading">{SITE.name} ({SITE.short})</p>
            <p className="mt-1">{SITE.positioning}</p>
            <p className="mt-1 text-muted-grey">{SITE.descriptor}</p>
          </div>
        </div>

        <div className="card p-6 sm:p-8">
          <h2 className="text-2xl font-semibold text-heading">Send a message</h2>
          <ActionForm action={sendMessage} submitLabel="Send message" className="mt-5 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name">
                <input name="full_name" className="input" required maxLength={120} autoComplete="name" />
              </Field>
              <Field label="E-mail address">
                <input name="email" type="email" className="input" required maxLength={160} autoComplete="email" />
              </Field>
            </div>
            <Field label="Subject">
              <input name="subject" className="input" required maxLength={160} />
            </Field>
            <Field label="Message">
              <textarea name="message" className="input" rows={6} required maxLength={4000} />
            </Field>
          </ActionForm>
          <p className="mt-4 text-xs text-muted-grey">The details you send are used only to answer your enquiry, as described in the Privacy Policy.</p>
        </div>
      </div>
    </PublicShell>
  );
}

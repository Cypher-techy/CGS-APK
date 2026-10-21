// Sends pending in-app notifications to each user's registered e-mail address.
//
// Called every few minutes by pg_cron (see README). It takes no input: it reads the queue
// (notifications with emailed_at and email_error both null), so calling it more often is harmless.
//
// Required function secrets (Supabase dashboard > Edge Functions > Secrets):
//   RESEND_API_KEY  API key of a Resend account (https://resend.com)
//   EMAIL_FROM      Sender on a domain verified in Resend, e.g. "CGS Project Portal <notifications@example.org>"
//   SITE_URL        Public URL of the portal, e.g. https://portal.example.org
// Until RESEND_API_KEY and EMAIL_FROM are set the function does nothing and leaves the queue untouched.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const BATCH = 40;
const MAX_AGE_HOURS = 48;

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async () => {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("EMAIL_FROM");
  const siteUrl = (Deno.env.get("SITE_URL") ?? "").replace(/\/$/, "");
  if (!apiKey || !from) return json({ status: "not_configured", sent: 0 });

  // Runs inside Supabase with the service role: it must read every user's queue and address.
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const since = new Date(Date.now() - MAX_AGE_HOURS * 3600 * 1000).toISOString();
  const { data: pending, error } = await db
    .from("notifications")
    .select("id")
    .is("emailed_at", null)
    .is("email_error", null)
    .gte("created_at", since)
    .order("created_at")
    .limit(BATCH);
  if (error) return json({ status: "error", message: error.message }, 500);
  if (!pending?.length) return json({ status: "ok", sent: 0 });

  // Claim the rows so that an overlapping run cannot send the same message twice.
  const { data: claimed } = await db
    .from("notifications")
    .update({ email_error: "sending" })
    .in("id", pending.map((n) => n.id))
    .is("emailed_at", null)
    .is("email_error", null)
    .select("id, user_id, title, body, link");
  if (!claimed?.length) return json({ status: "ok", sent: 0 });

  const { data: profiles } = await db
    .from("profiles")
    .select("id, email, full_name, status, email_notifications")
    .in("id", [...new Set(claimed.map((n) => n.user_id))]);
  const people = new Map((profiles ?? []).map((p) => [p.id, p]));

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const notification of claimed) {
    const person = people.get(notification.user_id);
    if (!person || person.status !== "active" || !person.email_notifications || person.email.endsWith(".test")) {
      await db.from("notifications").update({ email_error: "skipped" }).eq("id", notification.id);
      skipped++;
      continue;
    }
    const link = siteUrl && notification.link?.startsWith("/") ? `${siteUrl}${notification.link}` : siteUrl;
    const text = [
      `Hello ${person.full_name},`,
      "",
      notification.title,
      notification.body ?? "",
      "",
      link ? `Open in the portal: ${link}` : "",
      "",
      "You receive this message because you have an account on the CGS Project Portal.",
      "To stop these e-mails, sign in and change Notification e-mails under Profile.",
    ].join("\n");
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#202b26;line-height:1.5">
<p>Hello ${escapeHtml(person.full_name)},</p>
<p style="font-size:16px;font-weight:bold;color:#123c2b;margin-bottom:4px">${escapeHtml(notification.title)}</p>
<p style="margin-top:0">${escapeHtml(notification.body ?? "")}</p>
${link ? `<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#216b45;color:#ffffff;padding:9px 16px;border-radius:6px;text-decoration:none">Open in the portal</a></p>` : ""}
<p style="font-size:12px;color:#5f6a63;border-top:1px solid #e0e5df;padding-top:10px;margin-top:24px">You receive this message because you have an account on the CGS Project Portal. To stop these e-mails, sign in and change Notification e-mails under Profile.</p>
</div>`;

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [person.email], subject: `CGS Project Portal: ${notification.title}`, text, html }),
      });
      if (response.ok) {
        await db.from("notifications").update({ emailed_at: new Date().toISOString(), email_error: null }).eq("id", notification.id);
        sent++;
      } else {
        const detail = (await response.text()).slice(0, 300);
        await db.from("notifications").update({ email_error: `provider ${response.status}: ${detail}` }).eq("id", notification.id);
        failed++;
      }
    } catch (cause) {
      await db.from("notifications").update({ email_error: `network: ${String(cause).slice(0, 200)}` }).eq("id", notification.id);
      failed++;
    }
  }
  return json({ status: "ok", sent, skipped, failed });
});

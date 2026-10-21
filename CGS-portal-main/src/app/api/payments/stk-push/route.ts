import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone, phoneProblem } from "@/modules/ferd/constants";
import { mpesaConfig, stkPush } from "@/modules/ferd/mpesa";
import { getFerdSession } from "@/modules/ferd/session";

// `phone` is optional in the request: without it the prompt goes to the number on the student's record.
const body = z.object({ product: z.string().regex(/^[a-z0-9-]{3,60}$/), phone: z.string().max(20).optional() });
const deny = (status: number, message: string) => NextResponse.json({ error: message }, { status });

/**
 * Starts an M-Pesa payment for a premium library. The price and the buyer come from the server (the product
 * row and the session), never from the request. Returns the payment id to poll at /api/payments/status.
 */
export async function POST(request: NextRequest) {
  const session = await getFerdSession();
  if (!session) return deny(401, "Authentication required");
  const { supabase, user, student } = session;
  if (!student || student.status !== "verified" || !student.department_id) return deny(403, "Only verified students can buy a library.");

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return deny(400, "Choose a library to pay for.");
  // A payment always needs a phone number: the one typed at checkout, or else the one on the student's record.
  const typed = parsed.data.phone?.trim();
  const phone = normalizePhone(typed || student.phone || "");
  if (!phone) return deny(400, typed ? phoneProblem(typed) : "Your account has no phone number. Add your M-Pesa number in your profile, then try again.");

  const config = mpesaConfig();
  if (!config.enabled || !adminConfigured()) return deny(503, "M-Pesa payments are not available yet. Please check back later.");

  // Read as the student: RLS only returns a product they are allowed to see.
  const { data: product } = await supabase.from("ferd_products").select("id, name, price_kes, department_id, is_active").eq("slug", parsed.data.product).maybeSingle();
  if (!product || !product.is_active) return deny(404, "This library is not on sale.");
  if (product.department_id && product.department_id !== student.department_id) return deny(403, "This library belongs to another department.");

  const admin = createAdminClient();
  const { data: owned } = await admin.from("ferd_entitlements").select("id").eq("user_id", user.id).eq("product_id", product.id).is("revoked_at", null).maybeSingle();
  if (owned) return deny(409, "You already own this library.");

  // At most three requests in five minutes, and never two prompts on the phone at once.
  const since = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data: recent } = await admin.from("ferd_payments").select("id, status, product_id, created_at").eq("user_id", user.id).gte("created_at", since).order("created_at", { ascending: false });
  const waiting = (recent ?? []).find((p) => p.status === "pending" && p.product_id === product.id && Date.now() - new Date(p.created_at).getTime() < 90_000);
  if (waiting) return NextResponse.json({ payment_id: waiting.id, status: "pending", message: "A payment prompt was already sent to your phone." });
  if ((recent ?? []).length >= 3) return deny(429, "Too many payment attempts. Please wait a few minutes.");

  const reference = `FERD${randomBytes(4).toString("hex").toUpperCase()}`;
  const { data: payment, error } = await admin
    .from("ferd_payments")
    .insert({ user_id: user.id, product_id: product.id, amount_kes: product.price_kes, phone, reference })
    .select("id")
    .single();
  if (error || !payment) {
    console.error("Payment record could not be created:", error?.message);
    return deny(500, "The payment could not be started. Please try again.");
  }

  const push = await stkPush(config, { amount: product.price_kes, phone, reference, description: "FERD library" });
  if (!push.ok) {
    await admin.from("ferd_payments").update({ status: "failed", result_desc: "The request was not accepted by M-Pesa", completed_at: new Date().toISOString() }).eq("id", payment.id);
    return deny(502, push.message);
  }
  await admin.from("ferd_payments").update({ merchant_request_id: push.merchantRequestId, checkout_request_id: push.checkoutRequestId }).eq("id", payment.id);
  return NextResponse.json({ payment_id: payment.id, status: "pending", message: "Check your phone and enter your M-Pesa PIN." });
}

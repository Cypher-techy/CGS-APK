import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import { reconcile } from "@/modules/ferd/mpesa";

// Safaricom expects this acknowledgement whatever happened on our side.
const ACK = { ResultCode: 0, ResultDesc: "Accepted" };

/**
 * Daraja STK Push callback. Callbacks carry no signature, so the message is treated as a hint only: the
 * payment it names is looked up and then confirmed with Safaricom directly before anything is recorded.
 * A forged or repeated callback therefore cannot unlock anything, fail a real payment or grant twice.
 * If MPESA_CALLBACK_TOKEN is set, the callback URL must also carry it as `?token=`.
 */
export async function POST(request: NextRequest) {
  const expected = process.env.MPESA_CALLBACK_TOKEN;
  if (expected) {
    const given = Buffer.from(request.nextUrl.searchParams.get("token") ?? "");
    const wanted = Buffer.from(expected);
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return NextResponse.json(ACK);
  }
  if (!adminConfigured()) return NextResponse.json(ACK);

  const payload = (await request.json().catch(() => null)) as { Body?: { stkCallback?: Record<string, unknown> } } | null;
  const callback = payload?.Body?.stkCallback;
  const checkoutRequestId = typeof callback?.CheckoutRequestID === "string" ? callback.CheckoutRequestID.slice(0, 120) : null;
  if (!checkoutRequestId) return NextResponse.json(ACK);

  const { data: payment } = await createAdminClient().from("ferd_payments").select("id, status, checkout_request_id").eq("checkout_request_id", checkoutRequestId).maybeSingle();
  if (!payment) return NextResponse.json(ACK);

  // Receipt and amount, when present, are kept with the record once Safaricom confirms the payment.
  const items = ((callback?.CallbackMetadata as { Item?: { Name?: string; Value?: unknown }[] } | undefined)?.Item ?? []).slice(0, 10);
  const value = (name: string) => items.find((item) => item.Name === name)?.Value;
  const receipt = typeof value("MpesaReceiptNumber") === "string" ? String(value("MpesaReceiptNumber")).slice(0, 30) : null;
  const amount = Number.isFinite(Number(value("Amount"))) ? Math.floor(Number(value("Amount"))) : null;

  await reconcile(payment, { receipt, amount });
  return NextResponse.json(ACK);
}

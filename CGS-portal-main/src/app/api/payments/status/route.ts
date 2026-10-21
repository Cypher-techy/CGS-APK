import { NextResponse, type NextRequest } from "next/server";
import { adminConfigured } from "@/lib/supabase/admin";
import { PAYMENT_MESSAGES, reconcile } from "@/modules/ferd/mpesa";
import { getFerdSession } from "@/modules/ferd/session";

/**
 * Status of one of the caller's own payments. While it is pending the server checks with Safaricom, so a
 * delayed or lost callback never leaves a real payment unrecognised.
 */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const session = await getFerdSession();
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  // RLS: a student can read only their own payments.
  const { data: payment } = await session.supabase.from("ferd_payments").select("id, status, checkout_request_id, mpesa_receipt, created_at").eq("id", id).maybeSingle();
  if (!payment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const status = payment.status === "pending" && adminConfigured() ? await reconcile(payment) : payment.status;
  return NextResponse.json(
    { status, message: PAYMENT_MESSAGES[status] ?? "", receipt: status === "success" ? payment.mpesa_receipt : null },
    { headers: { "Cache-Control": "no-store" } },
  );
}

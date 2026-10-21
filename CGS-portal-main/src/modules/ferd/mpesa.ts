import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Safaricom Daraja (M-Pesa) STK Push for FERD purchases. Server-only: credentials are read from the
 * environment here and never reach the browser or the logs.
 *
 * Trust model: nothing the browser or an incoming callback says is taken as proof of payment. A payment is
 * finalised only after this server asks Daraja for the state of the request it created itself
 * (`reconcile`), and the database function `ferd_finalize_payment` records the outcome exactly once.
 */

export interface MpesaConfig {
  enabled: boolean;
  /** Why payments cannot be taken, when they cannot. Safe to show to an administrator. */
  problem: string | null;
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  shortcode: string;
  passkey: string;
  callbackUrl: string;
  transactionType: "CustomerPayBillOnline" | "CustomerBuyGoodsOnline";
  partyB: string;
}

export function mpesaConfig(): MpesaConfig {
  const env = process.env;
  const environment = (env.MPESA_ENVIRONMENT ?? "sandbox").toLowerCase();
  const transactionType = env.MPESA_TRANSACTION_TYPE === "CustomerBuyGoodsOnline" ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline";
  const config: MpesaConfig = {
    enabled: false,
    problem: null,
    baseUrl: environment === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke",
    consumerKey: env.MPESA_CONSUMER_KEY ?? "",
    consumerSecret: env.MPESA_CONSUMER_SECRET ?? "",
    shortcode: (env.MPESA_SHORTCODE ?? "").trim(),
    passkey: env.MPESA_PASSKEY ?? "",
    callbackUrl: (env.MPESA_CALLBACK_URL ?? "").trim(),
    transactionType,
    // Pay Bill: the same short code. Buy Goods: the till number, while the short code is the store number.
    partyB: (env.MPESA_PARTY_B ?? env.MPESA_SHORTCODE ?? "").trim(),
  };
  const missing = (["consumerKey", "consumerSecret", "shortcode", "passkey", "callbackUrl"] as const).filter((key) => !config[key]);
  if (env.MPESA_ENABLED !== "true") config.problem = "M-Pesa payments are switched off (MPESA_ENABLED is not true).";
  else if (missing.length) config.problem = `M-Pesa is not fully configured (missing: ${missing.join(", ")}).`;
  else if (!/^https:\/\//.test(config.callbackUrl)) config.problem = "MPESA_CALLBACK_URL must be a public https address.";
  else config.enabled = true;
  return config;
}

/** Daraja timestamps are East Africa Time, yyyyMMddHHmmss. */
function timestamp(now = new Date()): string {
  const eat = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return eat.toISOString().replace(/[-:T]/g, "").slice(0, 14);
}
const passwordFor = (config: MpesaConfig, stamp: string) => Buffer.from(`${config.shortcode}${config.passkey}${stamp}`).toString("base64");

let cachedToken: { value: string; expires: number; key: string } | null = null;
async function accessToken(config: MpesaConfig): Promise<string> {
  if (cachedToken && cachedToken.key === config.consumerKey && cachedToken.expires > Date.now() + 30_000) return cachedToken.value;
  const response = await fetch(`${config.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString("base64")}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Daraja authentication failed (HTTP ${response.status})`);
  const body = (await response.json()) as { access_token?: string; expires_in?: string | number };
  if (!body.access_token) throw new Error("Daraja authentication returned no token");
  cachedToken = { value: body.access_token, key: config.consumerKey, expires: Date.now() + Number(body.expires_in ?? 3000) * 1000 };
  return cachedToken.value;
}

async function daraja(config: MpesaConfig, path: string, payload: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken(config)}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, body };
}

export type StkPushResult = { ok: true; merchantRequestId: string; checkoutRequestId: string } | { ok: false; message: string };

/** Asks Safaricom to show the payment prompt on the customer's phone. */
export async function stkPush(config: MpesaConfig, input: { amount: number; phone: string; reference: string; description: string }): Promise<StkPushResult> {
  const stamp = timestamp();
  try {
    const { status, body } = await daraja(config, "/mpesa/stkpush/v1/processrequest", {
      BusinessShortCode: config.shortcode,
      Password: passwordFor(config, stamp),
      Timestamp: stamp,
      TransactionType: config.transactionType,
      Amount: input.amount,
      PartyA: input.phone,
      PartyB: config.partyB,
      PhoneNumber: input.phone,
      CallBackURL: config.callbackUrl,
      AccountReference: input.reference.slice(0, 12),
      TransactionDesc: input.description.slice(0, 13),
    });
    if (status === 200 && body.ResponseCode === "0" && typeof body.CheckoutRequestID === "string") {
      return { ok: true, merchantRequestId: String(body.MerchantRequestID ?? ""), checkoutRequestId: body.CheckoutRequestID };
    }
    // Only Safaricom's own code and message are logged: no credentials, no phone number.
    console.error("STK push rejected:", status, body.errorCode ?? body.ResponseCode, body.errorMessage ?? body.ResponseDescription);
    return { ok: false, message: "Safaricom did not accept the payment request. Check the phone number and try again." };
  } catch (error) {
    console.error("STK push failed:", error instanceof Error ? error.message : "unknown error");
    return { ok: false, message: "M-Pesa could not be reached. Please try again in a moment." };
  }
}

export type StkQueryResult =
  | { state: "final"; resultCode: string; resultDesc: string }
  /** Still waiting for the customer, or Daraja could not answer: nothing may be concluded. */
  | { state: "unknown" };

/** Asks Daraja what happened to a request this server created. */
export async function stkQuery(config: MpesaConfig, checkoutRequestId: string): Promise<StkQueryResult> {
  const stamp = timestamp();
  try {
    const { status, body } = await daraja(config, "/mpesa/stkpushquery/v1/query", {
      BusinessShortCode: config.shortcode,
      Password: passwordFor(config, stamp),
      Timestamp: stamp,
      CheckoutRequestID: checkoutRequestId,
    });
    if (status === 200 && body.ResponseCode === "0" && body.ResultCode !== undefined) {
      const resultCode = String(body.ResultCode);
      const resultDesc = String(body.ResultDesc ?? "");
      // 4999 "The transaction is still under processing": the customer has not answered the prompt yet.
      // It is not a result, so the payment stays pending and is asked about again later.
      if (resultCode === "4999" || /still under processing|being processed/i.test(resultDesc)) return { state: "unknown" };
      return { state: "final", resultCode, resultDesc };
    }
    return { state: "unknown" }; // e.g. errorCode 500.001.1001: "The transaction is being processed"
  } catch (error) {
    console.error("STK query failed:", error instanceof Error ? error.message : "unknown error");
    return { state: "unknown" };
  }
}

/**
 * Brings one payment up to date with Safaricom and returns its status. A pending payment is finalised only
 * when Daraja itself reports a final result for it. `hints` are details from a callback (receipt, amount);
 * they are stored with a confirmed success but never decide the outcome.
 */
export async function reconcile(
  payment: { id: string; status: string; checkout_request_id: string | null },
  hints: { receipt?: string | null; amount?: number | null } = {},
): Promise<string> {
  if (payment.status !== "pending" || !payment.checkout_request_id) return payment.status;
  const config = mpesaConfig();
  if (!config.enabled) return payment.status;
  const result = await stkQuery(config, payment.checkout_request_id);
  if (result.state !== "final") return "pending";
  const success = result.resultCode === "0";
  const { data, error } = await createAdminClient().rpc("ferd_finalize_payment", {
    p_checkout_request_id: payment.checkout_request_id,
    p_result_code: result.resultCode,
    p_result_desc: result.resultDesc,
    p_receipt: success ? (hints.receipt ?? null) : null,
    p_paid_amount: success ? (hints.amount ?? null) : null,
  });
  if (error) {
    console.error("Payment could not be finalised:", error.message);
    return "pending";
  }
  return String(data);
}

export const PAYMENT_MESSAGES: Record<string, string> = {
  pending: "Waiting for you to enter your M-Pesa PIN on your phone.",
  success: "Payment confirmed. Your library is unlocked.",
  failed: "The payment did not go through. You have not been charged for a failed request.",
  cancelled: "The payment was cancelled on the phone.",
  expired: "The payment prompt timed out before a PIN was entered.",
};

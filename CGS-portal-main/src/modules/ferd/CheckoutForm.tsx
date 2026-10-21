"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

type Phase = "idle" | "sending" | "pending" | "success" | "failed" | "cancelled" | "expired" | "timeout";

const POLL_MS = 4000;
const POLL_LIMIT_MS = 150_000;

/**
 * M-Pesa checkout. It only asks the server to start a payment and then asks the server for the status;
 * the library unlocks when the server has confirmed the payment with Safaricom, not when this page says so.
 */
export function CheckoutForm({ product, price, defaultPhone, resumePaymentId }: { product: string; price: number; defaultPhone: string; resumePaymentId?: string }) {
  const [phase, setPhase] = useState<Phase>(resumePaymentId ? "pending" : "idle");
  const [message, setMessage] = useState(resumePaymentId ? "Checking your last payment with M-Pesa…" : "");
  const [paymentId, setPaymentId] = useState<string | null>(resumePaymentId ?? null);
  const started = useRef(0);

  useEffect(() => {
    if (phase !== "pending" || !paymentId) return;
    if (!started.current) started.current = Date.now();
    let cancelled = false;
    const timer = window.setInterval(async () => {
      if (Date.now() - started.current > POLL_LIMIT_MS) {
        window.clearInterval(timer);
        setPhase("timeout");
        setMessage("No confirmation has arrived yet. If you entered your PIN, this page will show the result when you check again; you will not be charged twice.");
        return;
      }
      try {
        const response = await fetch(`/api/payments/status?id=${paymentId}`, { cache: "no-store" });
        const result = (await response.json()) as { status?: Phase; message?: string };
        if (cancelled || !result.status) return;
        if (result.status !== "pending") {
          window.clearInterval(timer);
          setPhase(result.status);
        }
        setMessage(result.message ?? "");
      } catch {
        // A dropped request is retried on the next tick.
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [phase, paymentId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const phone = String(new FormData(event.currentTarget).get("phone") ?? "");
    setPhase("sending");
    setMessage("Sending the payment request to your phone…");
    try {
      const response = await fetch("/api/payments/stk-push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product, phone }) });
      const result = (await response.json()) as { payment_id?: string; message?: string; error?: string };
      if (!response.ok || !result.payment_id) {
        setPhase("failed");
        setMessage(result.error ?? "The payment could not be started.");
        return;
      }
      started.current = Date.now();
      setPaymentId(result.payment_id);
      setPhase("pending");
      setMessage(result.message ?? "Check your phone and enter your M-Pesa PIN.");
    } catch {
      setPhase("failed");
      setMessage("The payment could not be started. Check your connection and try again.");
    }
  }

  const busy = phase === "sending" || phase === "pending";
  const tone = phase === "success" ? "alert-success" : phase === "failed" || phase === "cancelled" || phase === "expired" ? "alert-error" : "alert-info";

  if (phase === "success") {
    return (
      <div>
        <p className="alert alert-success" role="status">{message || "Payment confirmed. Your library is unlocked."}</p>
        <Link href="/ferd/manuals" className="btn btn-primary mt-4">Open your library</Link>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="label">M-Pesa phone number</span>
        <input name="phone" type="tel" inputMode="tel" required defaultValue={defaultPhone} placeholder="07XX XXX XXX, 01XX XXX XXX or +254…" maxLength={20} className="input sm:max-w-xs" disabled={busy} autoComplete="tel" />
        <span className="hint block">
          {defaultPhone ? "This is the number on your FERD account. Change it here only if you are paying from another M-Pesa line. " : ""}
          A payment prompt for KSh {price.toLocaleString("en-KE")} is sent to this phone. You confirm it with your M-Pesa PIN.
        </span>
      </label>
      <button type="submit" className="btn btn-accent" disabled={busy}>
        {phase === "sending" ? "Sending…" : phase === "pending" ? "Waiting for your PIN…" : phase === "idle" ? `Pay KSh ${price.toLocaleString("en-KE")} with M-Pesa` : "Try again"}
      </button>
      {phase === "timeout" && paymentId && (
        <button type="button" className="btn btn-secondary ml-2" onClick={() => { started.current = 0; setPhase("pending"); }}>
          Check again
        </button>
      )}
      {message && <p className={`alert ${tone}`} role="status" aria-live="polite">{message}</p>}
    </form>
  );
}

"use client";

import { useState, type ReactNode } from "react";
import { ferdGoogleSignIn } from "@/modules/ferd/auth-actions";
import { isNativePlatform, startNativeGoogleSignIn } from "@/modules/auth/native-google";

/**
 * FERD portal "Continue with Google". Same interception as the main sign-in: the browser keeps
 * using the ferdGoogleSignIn server action; the Android app runs the Custom Tab flow and returns
 * to the student dashboard.
 */
export function FerdGoogleSignIn({ children }: { children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <form
        action={ferdGoogleSignIn}
        onSubmit={async (event) => {
          if (!isNativePlatform()) return;
          event.preventDefault();
          setError(null);
          setBusy(true);
          const result = await startNativeGoogleSignIn("/ferd/dashboard");
          setBusy(false);
          if (!result.ok && result.reason !== "cancelled") {
            setError("Google sign-in could not be completed. Try again, or sign in with your registration number.");
          }
        }}
      >
        <button type="submit" disabled={busy} className="btn w-full" style={{ opacity: busy ? 0.65 : 1 }}>
          {busy ? "Opening Google…" : children}
        </button>
      </form>
      {error && (
        <p role="alert" className="alert alert-error mt-3 text-sm">
          {error}
        </p>
      )}
    </>
  );
}

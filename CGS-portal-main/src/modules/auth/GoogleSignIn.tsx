"use client";

import { useState } from "react";
import { signInWithGoogle } from "@/modules/auth/actions";
import { isNativePlatform, startNativeGoogleSignIn } from "@/modules/auth/native-google";

/**
 * "Continue with Google".
 *
 * In a browser this is the original server action, unchanged. Inside the Android app the submit is
 * intercepted and the native flow runs instead (see native-google.ts) because Google blocks OAuth
 * from embedded WebViews.
 */
export function GoogleSignIn({ destination = "/dashboard" }: { destination?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div style={{ marginTop: "20px" }}>
      <div
        style={{
          textAlign: "center",
          marginBottom: "12px",
          color: "#666",
          fontSize: "14px",
        }}
      >
        OR
      </div>

      <form
        action={signInWithGoogle}
        onSubmit={async (event) => {
          // Outside the app, let the server action do exactly what it always did.
          if (!isNativePlatform()) return;
          event.preventDefault();
          setError(null);
          setBusy(true);
          const result = await startNativeGoogleSignIn(destination);
          setBusy(false);
          if (!result.ok && result.reason !== "cancelled") {
            setError(
              result.reason === "failed"
                ? "Google sign-in could not be completed. Please try again, or sign in with your e-mail address and password."
                : null,
            );
          }
        }}
      >
        <button
          type="submit"
          disabled={busy}
          style={{
            width: "100%",
            padding: "12px 16px",
            border: "1px solid #ccc",
            borderRadius: "6px",
            background: "#fff",
            color: "#222",
            cursor: busy ? "default" : "pointer",
            fontSize: "15px",
            fontWeight: "500",
            opacity: busy ? 0.65 : 1,
          }}
        >
          {busy ? "Opening Google…" : "Continue with Google"}
        </button>
      </form>

      {error && (
        <p role="alert" style={{ margin: "10px 0 0", color: "#b00020", fontSize: "13.5px", lineHeight: 1.5 }}>
          {error}
        </p>
      )}
    </div>
  );
}

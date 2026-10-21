import Link from "next/link";
import type { ReactNode } from "react";
import { BackToCgs, FerdBrand } from "@/modules/ferd/FerdShell";

/** Centred card for the FERD sign-in, registration and recovery pages. */
export function FerdAuthCard({ title, lead, children, footer, wide }: { title: string; lead?: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <div className="rings relative flex min-h-screen flex-col items-center justify-center bg-off-white px-4 py-16">
      <BackToCgs className="absolute left-4 top-4" />
      <FerdBrand />
      <div className={`card card-pad mt-8 w-full ${wide ? "max-w-xl" : "max-w-sm"}`}>
        <h1 className="text-2xl font-bold text-heading">{title}</h1>
        {lead && <p className="mt-1 text-sm text-muted-grey">{lead}</p>}
        <div className="mt-5">{children}</div>
      </div>
      {footer && <div className="mt-4 text-center text-sm text-muted-grey">{footer}</div>}
      <p className="mt-6 flex gap-3 text-xs text-muted-grey">
        <Link href="/ferd" className="hover:underline">About FERD</Link>
        <Link href="/terms" className="hover:underline">Terms</Link>
        <Link href="/privacy" className="hover:underline">Privacy</Link>
        <Link href="/" className="hover:underline">Cypher Green Systems</Link>
      </p>
    </div>
  );
}

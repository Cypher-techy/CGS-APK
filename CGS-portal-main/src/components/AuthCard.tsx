import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "@/components/PublicShell";

/** Centered card used by the sign-in, registration and password pages. */
export function AuthCard({
  title,
  lead,
  children,
  footer,
  wide,
}: {
  title: string;
  lead?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="rings flex min-h-screen flex-col items-center justify-center bg-off-white px-4 py-10">
      <Brand />
      <div className={`card card-pad mt-8 w-full ${wide ? "max-w-xl" : "max-w-sm"}`}>
        <h1 className="text-2xl font-bold text-heading">{title}</h1>
        {lead && <p className="mt-1 text-sm text-muted-grey">{lead}</p>}
        <div className="mt-5">{children}</div>
      </div>
      {footer && <div className="mt-4 text-sm text-muted-grey">{footer}</div>}
      <p className="mt-6 flex gap-3 text-xs text-muted-grey">
        <Link href="/terms" className="hover:underline">Terms</Link>
        <Link href="/privacy" className="hover:underline">Privacy</Link>
        <Link href="/contact" className="hover:underline">Support</Link>
      </p>
    </div>
  );
}

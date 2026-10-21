"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";

/**
 * Call-to-action pill: a solid icon circle and a label that rolls on hover.
 * `clear` is the neutral glass version used next to the accent one.
 */
export function CtaButton({ href, children, clear = false, className = "" }: { href: string; children: string; clear?: boolean; className?: string }) {
  return (
    <Link href={href} className={`cta ${clear ? "cta-clear" : ""} ${className}`}>
      <span className="cta-icon">
        <ArrowUpRight className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="cta-text">
        <span>{children}</span>
      </span>
    </Link>
  );
}

/**
 * Content that rises into place the first time it scrolls into view.
 * It is rendered visible on the server, so nothing is hidden when scripts do not run.
 */
export function Reveal({ children, delay = 0, className = "", as: Tag = "div" }: { children: ReactNode; delay?: number; className?: string; as?: "div" | "li" | "section" }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || !("IntersectionObserver" in window)) return;
    // Only content that starts below the fold is animated; what is already on screen stays put.
    if (element.getBoundingClientRect().top < window.innerHeight * 0.92) return;
    element.classList.add("reveal");
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        element.classList.add("is-visible");
        observer.disconnect();
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    // @ts-expect-error the three allowed tags share the same ref and attribute shape
    <Tag ref={ref} className={className} style={{ "--reveal-delay": `${delay}ms` } as CSSProperties}>
      {children}
    </Tag>
  );
}

const STAGES: Record<string, number> = { start: 12, style: 45, data: 72, ready: 100 };
export const EARTH_PROGRESS_EVENT = "cgs:earth-progress";
/** Called by the Earth as it loads, so the loader shows real progress. */
export const reportEarthProgress = (stage: keyof typeof STAGES) => window.dispatchEvent(new CustomEvent(EARTH_PROGRESS_EVENT, { detail: STAGES[stage] }));

/**
 * Opening loader: black screen, slowly rotating dashed rings, the brand mark and a percentage.
 * The percentage follows the real loading stages of the Earth and the screen lifts once it is ready
 * (or after a short limit, so a slow map never blocks the page). Shown once per browser session.
 */
export function Preloader() {
  const [progress, setProgress] = useState(0);
  const [shown, setShown] = useState(0);
  const [phase, setPhase] = useState<"loading" | "leaving" | "gone">("loading");

  useEffect(() => {
    let seen = false;
    try {
      seen = window.sessionStorage.getItem("cgs-loaded") === "1";
    } catch {}
    if (seen || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const skip = window.setTimeout(() => setPhase("gone"), 0);
      return () => window.clearTimeout(skip);
    }
    const onProgress = (event: Event) => setProgress((current) => Math.max(current, Number((event as CustomEvent).detail) || 0));
    window.addEventListener(EARTH_PROGRESS_EVENT, onProgress);
    const limit = window.setTimeout(() => setProgress(100), 7000);
    return () => {
      window.removeEventListener(EARTH_PROGRESS_EVENT, onProgress);
      window.clearTimeout(limit);
    };
  }, []);

  // The displayed number counts up towards the real progress.
  useEffect(() => {
    if (shown >= progress) return;
    const tick = window.setTimeout(() => setShown((value) => Math.min(progress, value + Math.max(1, Math.round((progress - value) / 6)))), 28);
    return () => window.clearTimeout(tick);
  }, [shown, progress]);

  useEffect(() => {
    if (shown < 100 || phase !== "loading") return;
    try {
      window.sessionStorage.setItem("cgs-loaded", "1");
    } catch {}
    const leave = window.setTimeout(() => setPhase("leaving"), 250);
    const done = window.setTimeout(() => setPhase("gone"), 1250);
    return () => {
      window.clearTimeout(leave);
      window.clearTimeout(done);
    };
  }, [shown, phase]);

  if (phase === "gone") return null;
  return (
    <div
      role="status"
      aria-label={`Loading the Earth, ${shown}%`}
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-10 overflow-hidden bg-night text-white"
      style={{ transform: phase === "leaving" ? "translateY(-100%)" : "none", transition: "transform 1s var(--ease-cgs)" }}
    >
      <svg viewBox="0 0 1000 1000" className="pointer-events-none absolute left-1/2 top-1/2 h-[170vmax] w-[170vmax] -translate-x-1/2 -translate-y-1/2" aria-hidden="true">
        {[
          [150, "60s", "2 10"],
          [210, "30s", "6 8"],
          [290, "40s", "1 0"],
          [370, "50s", "3 12"],
          [455, "70s", "8 10"],
        ].map(([radius, duration, dash]) => (
          <circle key={radius} cx="500" cy="500" r={radius} fill="none" stroke="rgba(255,255,255,0.13)" strokeWidth="0.6" strokeDasharray={dash as string} className="loader-ring" style={{ "--duration": duration } as CSSProperties} />
        ))}
      </svg>
      <BrandMark className="relative h-28 w-28 opacity-90" />
      <p className="relative font-display text-5xl font-bold tabular-nums">{shown}%</p>
    </div>
  );
}

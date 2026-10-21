"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

// The map engine needs the browser (WebGL), so it is loaded on the client only, when it is first shown.
const EarthExplorer = dynamic(() => import("@/modules/geo/EarthExplorer"), {
  ssr: false,
  loading: () => (
    <div className="earth flex h-full w-full items-center justify-center rounded-3xl bg-none text-sm text-sage" role="status">
      Loading the Earth…
    </div>
  ),
});

type ExplorerProps = ComponentProps<typeof EarthExplorer>;

/** Sized frame around the Earth explorer. `full` fills the viewport below a header of `offset` pixels. */
export function Earth({ height, className = "", ...props }: ExplorerProps & { height?: string; className?: string }) {
  return (
    <div className={className} style={{ height: height ?? "min(72vh, 46rem)", minHeight: "24rem" }}>
      <EarthExplorer {...props} />
    </div>
  );
}

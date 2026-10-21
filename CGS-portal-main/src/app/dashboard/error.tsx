"use client";

export default function DashboardError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="card card-pad mx-auto mt-10 max-w-lg text-center">
      <h1 className="text-base font-semibold text-heading">This page could not be loaded</h1>
      <p className="mt-2 text-sm text-muted-grey">
        Something went wrong while loading the data. Check your connection and try again. If the problem continues,
        contact CGS support.
      </p>
      <button type="button" onClick={reset} className="btn btn-primary mt-4">
        Try again
      </button>
    </div>
  );
}

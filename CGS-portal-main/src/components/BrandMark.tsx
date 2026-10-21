/** CGS mark: a globe whose meridian opens into a leaf. */
export function BrandMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <circle cx="20" cy="20" r="19" fill="#123c2b" />
      <circle cx="20" cy="20" r="12.5" fill="none" stroke="#a7bfa9" strokeWidth="1.2" />
      <path d="M7.5 20h25M20 7.5c-5 4-5 21 0 25" fill="none" stroke="#a7bfa9" strokeWidth="1.2" />
      <path d="M20 31c-1-9 3-16 11-19 1 9-3 16-11 19Z" fill="#f6f2e8" />
      <path d="M20.5 30c2-6 5-11 9.5-16" fill="none" stroke="#123c2b" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

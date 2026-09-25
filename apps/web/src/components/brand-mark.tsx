/** A mended tear: a diagonal seam held by three cross-stitches. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <rect width="24" height="24" rx="6" className="fill-primary" />
      <g className="stroke-primary-foreground" strokeLinecap="round" fill="none">
        <path d="M6.5 17.5 17.5 6.5" strokeWidth="1.25" strokeDasharray="2.2 1.8" />
        <path d="M7.6 12.9 11.1 16.4M10.4 10.1 13.9 13.6M13.2 7.3 16.7 10.8" strokeWidth="2" />
      </g>
    </svg>
  );
}

import React from "react";

/** One grey placeholder bar (pulses unless the visitor prefers reduced motion). */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden className={["ds-skeleton block", className].filter(Boolean).join(" ")} style={style} />;
}

// Widths vary row to row so the skeleton does not read as a table (reference).
const WIDTHS: [number, number, number][] = [
  [62, 40, 14],
  [48, 56, 10],
  [70, 34, 16],
  [54, 46, 12],
];

/**
 * Loading list (reference bonus/bonus-skeleton-loading-state): avatar circle, two bars and a
 * short bar per row. While `loading`, the rows are skeletons and the region is aria-busy;
 * then `children` (the loaded rows) are shown.
 */
export function SkeletonList({
  loading,
  rows = 4,
  label,
  children,
}: {
  loading: boolean;
  rows?: number;
  /** Read to screen readers while loading, e.g. "Loading projects". */
  label: string;
  children: React.ReactNode;
}) {
  if (!loading) return <div aria-busy="false">{children}</div>;
  return (
    <div aria-busy="true" role="status" aria-label={label}>
      <ul className="divide-y" style={{ borderColor: "var(--ds-border)" }}>
        {Array.from({ length: rows }, (_, i) => {
          const [a, b, c] = WIDTHS[i % WIDTHS.length];
          return (
            <li key={i} className="flex items-center gap-3" style={{ padding: "var(--ds-pad-y) var(--ds-pad-x)", borderColor: "var(--ds-border)" }}>
              <Skeleton className="h-9 w-9 shrink-0" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-3" style={{ width: `${a}%` }} />
                <Skeleton className="h-2.5" style={{ width: `${b}%` }} />
              </div>
              <Skeleton className="h-3" style={{ width: `${c}%` }} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

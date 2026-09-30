import type { ReactNode } from "react";

/**
 * Generic countdown/progress ring used by the workout player. `pct` is 0–100
 * of the ring filled; children render in the center (the big timer number).
 */
export function ProgressRing({
  pct,
  tone = "accent",
  children,
}: {
  pct: number;
  tone?: "accent" | "rest" | "reps";
  children: ReactNode;
}) {
  const R = 54;
  const C = 2 * Math.PI * R;
  const dash = (Math.max(0, Math.min(100, pct)) / 100) * C;
  return (
    <div className="progress-ring-wrap">
      <svg viewBox="0 0 120 120" className="progress-ring" aria-hidden>
        <circle cx="60" cy="60" r={R} className="ring-track" />
        <circle
          cx="60"
          cy="60"
          r={R}
          className={`progress-ring-value ${tone}`}
          strokeDasharray={`${dash} ${C}`}
          transform="rotate(-90 60 60)"
        />
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}

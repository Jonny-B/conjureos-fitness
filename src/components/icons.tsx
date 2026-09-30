/**
 * Inline-SVG icon set. Replaces the grab-bag of emoji + Unicode glyphs the app
 * used for tabs/buttons (☰ ＋ 📈 🏋 ⚙ ◴), which render inconsistently across
 * platforms and clashed with the Modern Whimsy look. These are stroke icons
 * that inherit `currentColor`, so they pick up the active/muted tab colors and
 * any button text color for free.
 */

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 24, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Tab icon: trends and charts over time. */
export const TrendsIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 17l5-5 3.5 3.5L21 7" />
    <path d="M21 11V7h-4" />
  </Svg>
);

/** Tab icon: Conjure Fitness's Home screen (a house). */
export const HomeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9v11a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9" />
  </Svg>
);

/** Tab icon: workouts (a dumbbell). */
export const WorkoutsIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.5 6.5v11M17.5 6.5v11M4 9v6M20 9v6M6.5 12h11" />
  </Svg>
);

/** The settings cog. */
export const SettingsIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 0 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 0 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 0 1 4 0v.09a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 0 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" />
  </Svg>
);

/** Start a workout or a timed step. */
export const PlayIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 5.5v13a1 1 0 0 0 1.5.87l11-6.5a1 1 0 0 0 0-1.74l-11-6.5A1 1 0 0 0 7 5.5z" fill="currentColor" stroke="none" />
  </Svg>
);

/** Back / previous affordance. */
export const ChevronLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Svg>
);

/** Forward / next / drill-in affordance. */
export const ChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 5l7 7-7 7" />
  </Svg>
);

/** Dismiss a sheet, modal, or full-screen flow. */
export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

/** Delete the adjacent item. */
export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12" />
  </Svg>
);

/** The AI coach — a speech bubble with a spark. */
export const CoachIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.1 0-2.15-.2-3.1-.58L4 21l1.62-4.86A8.5 8.5 0 1 1 21 11.5z" />
    <path d="M8.5 10.5h7M8.5 13.5h4.5" />
  </Svg>
);

/** Confirmation: saved, completed, or selected. */
export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <polyline points="20 6 9 17 4 12" />
  </Svg>
);

/** Warning or estimate caveat. */
export const AlertTriangle = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </Svg>
);

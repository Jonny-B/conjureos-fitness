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

/** App mark — three concentric activity arcs (calorie/macro rings motif). */
export function Logo({ size = 22, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden {...rest}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2.5" />
      <path
        d="M12 3a9 9 0 0 1 8.5 6.1"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2.5" />
      <path d="M12 7.5a4.5 4.5 0 0 1 3.9 2.25" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export const DiaryIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H19a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H5.5A1.5 1.5 0 0 1 4 18.5z" />
    <path d="M4 17.5A1.5 1.5 0 0 1 5.5 16H20" />
    <path d="M8 8h7M8 11h5" />
  </Svg>
);

export const AddIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const TrendsIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 17l5-5 3.5 3.5L21 7" />
    <path d="M21 11V7h-4" />
  </Svg>
);

export const WorkoutsIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.5 6.5v11M17.5 6.5v11M4 9v6M20 9v6M6.5 12h11" />
  </Svg>
);

export const SettingsIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 0 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 0 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 0 1 4 0v.09a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 0 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" />
  </Svg>
);

export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </Svg>
);

export const PlayIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 5.5v13a1 1 0 0 0 1.5.87l11-6.5a1 1 0 0 0 0-1.74l-11-6.5A1 1 0 0 0 7 5.5z" fill="currentColor" stroke="none" />
  </Svg>
);

export const ChevronLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Svg>
);

export const ChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 5l7 7-7 7" />
  </Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12" />
  </Svg>
);

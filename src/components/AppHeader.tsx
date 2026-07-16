/**
 * The app's single top bar. Context-aware: the center shows the current page's
 * title, the left slot is a back chevron on sub-pages (and the brand mark on the
 * home tab), and the right slot is the Settings gear. Screens no longer render
 * their own back/title headers — this owns both.
 */

import { ChevronLeft, Logo, SettingsIcon } from "./icons";

export function AppHeader({
  title,
  onBack,
  onSettings,
}: {
  title: string;
  /** When set, the left slot is a back chevron; otherwise the brand mark. */
  onBack?: () => void;
  onSettings: () => void;
}) {
  return (
    <header className="topbar">
      <div className="topbar-slot topbar-left">
        {onBack ? (
          <button className="icon-btn" aria-label="Back" onClick={onBack}>
            <ChevronLeft size={22} />
          </button>
        ) : (
          <span className="brand-mark" aria-hidden>
            <Logo />
          </span>
        )}
      </div>
      <div className="topbar-title" role="heading" aria-level={1}>
        {title}
      </div>
      <div className="topbar-slot topbar-right">
        <button className="icon-btn" aria-label="Settings" onClick={onSettings}>
          <SettingsIcon size={20} />
        </button>
      </div>
    </header>
  );
}

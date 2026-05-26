import type { Goals } from "../lib/types";

const APP_VERSION = "0.1.0";

interface Props {
  email: string | null;
  goals: Goals;
  isDemo: boolean;
  onEditGoals: () => void;
  onSignOut: () => void;
  onClose: () => void;
}

/** Account + preferences sheet, opened from the header avatar. Designed to
 *  feel at home as an installed iPhone app (bottom sheet, safe-area aware). */
export default function Settings({ email, goals, isDemo, onEditGoals, onSignOut, onClose }: Props) {
  const standalone = isStandalone();

  function resetDemo() {
    if (!confirm("Reset demo data? This clears everything logged in this browser.")) return;
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.startsWith("conjureos-fitness:")) localStorage.removeItem(key);
      }
    } catch {
      /* ignore */
    }
    location.reload();
  }

  return (
    <div className="modal-backdrop sheet-backdrop" onClick={onClose}>
      <div className="settings card" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <div className="sheet-grip" aria-hidden />

        <header className="settings-head">
          <div className="avatar avatar-lg" aria-hidden>{initial(email)}</div>
          <div className="settings-id">
            <span className="settings-email">{email ?? "Signed in"}</span>
            {isDemo && <span className="demo-badge">demo account</span>}
          </div>
          <button className="sheet-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <section className="settings-group">
          <h3>Daily goals</h3>
          <button
            className="settings-row"
            onClick={() => {
              onClose();
              onEditGoals();
            }}
          >
            <span className="settings-row-main">
              <span className="settings-row-title">Calories &amp; macros</span>
              <span className="settings-row-sub">
                {goals.calories} kcal · P{goals.protein_g} · C{goals.carbs_g} · F{goals.fat_g}
              </span>
            </span>
            <span className="settings-row-chev">›</span>
          </button>
        </section>

        {!standalone && (
          <section className="settings-group">
            <h3>Add to Home Screen</h3>
            <div className="install-card">
              <p>Install Fitness as an app for a full-screen, offline-friendly experience:</p>
              <ol>
                <li>Tap the <strong>Share</strong> button <span className="ios-share" aria-hidden>􀈂</span> in Safari</li>
                <li>Choose <strong>Add to Home Screen</strong></li>
                <li>Tap <strong>Add</strong></li>
              </ol>
            </div>
          </section>
        )}

        {isDemo && (
          <section className="settings-group">
            <h3>Demo</h3>
            <button className="settings-row danger" onClick={resetDemo}>
              <span className="settings-row-main">
                <span className="settings-row-title">Reset demo data</span>
                <span className="settings-row-sub">Clear everything logged in this browser</span>
              </span>
              <span className="settings-row-chev">↻</span>
            </button>
          </section>
        )}

        <button className="btn btn-ghost signout-btn" onClick={onSignOut}>
          Sign out
        </button>

        <p className="settings-about">ConjureOS Fitness · v{APP_VERSION}</p>
      </div>
    </div>
  );
}

function initial(email: string | null): string {
  const c = (email ?? "").trim().charAt(0).toUpperCase();
  return c || "◗";
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const navStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return window.matchMedia?.("(display-mode: standalone)").matches === true || navStandalone === true;
}

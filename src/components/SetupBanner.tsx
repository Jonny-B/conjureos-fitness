import type { Profile } from "../types";
import { firstIncompleteStep } from "../features/setup";
import { CloseIcon } from "./icons";

interface Props {
  profile: Profile | null;
  onStart: (stepId: string) => void;
  onDismiss: () => void;
}

/**
 * Full-width nudge under the topbar prompting the user to finish profile/goals
 * setup. Shows the first unfinished step; tapping it opens the setup wizard
 * there. Renders nothing once setup is complete. Dismiss is per-session
 * (App state) so it returns on the next open.
 */
export function SetupBanner({ profile, onStart, onDismiss }: Props) {
  const next = firstIncompleteStep(profile);
  if (!next) return null;
  return (
    <div className="setup-banner">
      <button className="setup-banner-main" onClick={() => onStart(next.id)}>
        <span className="setup-banner-text">Finish setting up — {next.label}</span>
        <span className="setup-banner-cta">Continue</span>
      </button>
      <button className="icon-btn setup-banner-x" aria-label="Dismiss" onClick={onDismiss}>
        <CloseIcon size={16} />
      </button>
    </div>
  );
}

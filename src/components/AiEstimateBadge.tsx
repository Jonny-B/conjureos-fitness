/**
 * Tiny inline badge marking a number that is an AI estimate (the burn estimate
 * after a workout). Honest-by-default: the user should never mistake a guess
 * for a measured value.
 */
export function AiEstimateBadge() {
  return (
    <span className="ai-estimate-badge" title="Estimated by AI — may be inaccurate. You can change it.">
      AI estimate
    </span>
  );
}

/** A step countdown, tagged with the player step it belongs to. */
export interface StepTimer {
  index: number;
  left: number;
}

/** Seconds left for `index`, or null when the stored timer belongs to a
 *  different step. Tagging the countdown with its step keeps a stale 0 from the
 *  step that just ended from being read as the new step's countdown. */
export function liveSeconds(timer: StepTimer | null, index: number): number | null {
  return timer && timer.index === index ? timer.left : null;
}

/** Whole seconds actually spent on a timed set of `durationSec`, given the
 *  countdown's current value (null = countdown never started). 0 = nothing done. */
export function heldSeconds(durationSec: number, secondsLeft: number | null): number {
  if (secondsLeft == null) return 0;
  return Math.max(0, Math.min(durationSec, Math.round(durationSec - secondsLeft)));
}

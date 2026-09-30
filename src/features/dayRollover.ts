/**
 * The app can stay alive across midnight (a WebView or iframe that is never
 * reloaded). When the local day changes, a selected date that was "today"
 * follows it to the new today; a date the user chose themselves stays put.
 * Pure, so it is unit-testable without a DOM.
 */
export function rollSelectedDate(selected: string, prevToday: string, newToday: string): string {
  return selected === prevToday ? newToday : selected;
}

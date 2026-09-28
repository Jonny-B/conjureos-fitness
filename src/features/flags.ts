/**
 * Feature flags.
 *
 * These are deliberately plain module constants, not runtime config: flipping
 * one is a code change that goes through review, a build, and a publish. That's
 * the point — a paused feature should not be one tapped setting away from
 * reappearing in a user's app.
 */

/**
 * The AI coach and the adaptive workout program: ON.
 *
 * This repo is Conjure Fitness (2026-09-28). Calorie tracking moved to Conjure
 * Health (Jonny-B/conjureos-health), which deleted the workout code, and this
 * app turned the workouts and the coach back on. From 2026-08-04 until then
 * this flag was `false` and the app shipped as Conjure Health, a nutrition-only
 * tracker; nothing was deleted, which is why switching it back on was enough.
 *
 * ## What this flag shows
 * - The Workouts tab and the built-in workout library
 * - The Coach chat tab and the Plan tab's coach launcher
 * - The evening "how did your day go?" check-in banner + sheet
 * - The Plan tab's program section (assigned workouts + benchmark progress)
 * - The plan wizard's mode picker (see NUTRITION_ENABLED for which modes)
 * - The coach/workout rows in Settings → Reset data
 */
export const COACH_AND_WORKOUTS_ENABLED: boolean = true;

/**
 * Food and calorie tracking: OFF (2026-09-28, owner decision).
 *
 * Conjure Health is the calorie tracker now; this app is fitness only. The
 * code stays (it is shared with plans, the coach and the journal, and pulling
 * it apart is later work), but none of it is reachable:
 * - No Diary, Add food, meal or Journal tabs. The app opens on Home.
 * - The plan wizard builds `get_fit` plans only.
 * - The food and wellbeing actions are neither declared in package.json nor
 *   registered, so the ConjureOS assistant never sends this app food, water,
 *   sleep or weight. The fitness actions are (see ACTIONS.md).
 *
 * Workouts still reach Health's calorie ring: Conjure Health's `workoutSource`
 * need reads them through this app's `listWorkouts`.
 */
export const NUTRITION_ENABLED: boolean = false;

/**
 * The Consumer Health Data Privacy Policy.
 *
 * Deliberately a SEPARATE document rather than a section of a general privacy
 * policy: Washington's My Health My Data Act requires a distinct consumer
 * health data policy, linked in its own right, and Nevada's SB 370 is close
 * enough that one document serves both.
 *
 * One rule for editing this file: it must describe what the code actually
 * does. Every AI call is listed under "When it leaves" (plan generation, the
 * coach and check-ins, post-workout burn estimates, program adaptation and
 * progression, exercise explainers), and "To other apps" mirrors the actions
 * in bridge/fitnessActions.ts. Change either and this page changes with it.
 *
 * This is a plain-language policy written against how the app behaves. It is
 * not legal advice and has not been through counsel.
 */

/** Last material revision. Shown so a reader can tell what applied when. */
export const POLICY_UPDATED = "2026-09-30";

export function HealthDataPolicy({ onClose }: { onClose: () => void }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet policy" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h2>Consumer Health Data Privacy</h2>
        </header>

        <div className="sheet-body policy-body">
          <p className="muted small">Last updated {POLICY_UPDATED}.</p>

          <h3>What this covers</h3>
          <p>
            Conjure Fitness records things about your body and your training: the workouts you
            do (exercises, sets, reps, loads and effort), the routes and distances of runs and
            rides you track, your bodyweight, age and sex, the answers to the safety check
            (pregnancy, a heart condition, injuries), your check-in answers, and your
            conversations with the coach. If you connect Apple Health, it also reads the
            workouts recorded there. Some privacy laws call this{" "}
            <strong>consumer health data</strong>. This page explains what happens to it.
          </p>
          <p>
            Conjure Fitness is not a doctor, a clinic, an insurer, or any other kind of
            healthcare provider, and it is not part of one. That means your entries here are
            not medical records and HIPAA does not apply to them. The protections described
            on this page are the ones we actually implement, not ones HIPAA imposes on us.
          </p>

          <h3>Where it lives</h3>
          <p>
            Your data is stored on your device and in your own ConjureOS account, so it can
            follow you between devices you sign in on. Nobody else can read it there. It is
            never sold, and it is never used for advertising or marketing — not by us, and not
            by anyone we send it to.
          </p>

          <h3>When it leaves</h3>
          <h4>To the AI, when a feature needs it</h4>
          <p>
            Several features ask an AI for help. They run while you use the app, never on a
            schedule or while it is closed. What each one sends:
          </p>
          <ul className="consent-list">
            <li>
              <strong>Building or tweaking a plan:</strong> your goal in your own words, the
              plan's dates, training days, experience and equipment, and the movements to
              avoid because of an injury you listed.
            </li>
            <li>
              <strong>The coach and check-ins:</strong> your messages and answers, your plan and
              program, your recent workouts and check-ins, your past plans, and what the coach
              remembers about you.
            </li>
            <li>
              <strong>After a workout:</strong> a short summary of it, to choose your check-in
              questions. If your bodyweight isn't saved, also its name, length and distance, to
              estimate the calories it burned.
            </li>
            <li>
              <strong>Adjusting your program:</strong> every few workouts, after a benchmark,
              and when you start the next group of workouts, your program, your recent workouts
              and your stated preferences are sent so it can adapt to how you are doing. This
              happens on its own when you finish a workout.
            </li>
            <li>
              <strong>Exercise how-tos:</strong> the exercise's name, the first time you open a
              how-to the app doesn't already have.
            </li>
          </ul>
          <p>The AI never receives:</p>
          <ul className="consent-list withheld">
            <li>Your routes or location</li>
            <li>Your answers about pregnancy or a heart condition</li>
          </ul>

          <h4>To other apps on ConjureOS, when you allow them</h4>
          <p>
            Other apps you install on ConjureOS, and ConjureOS's own assistant, can ask Conjure
            Fitness about your training or add to it: a calorie tracker counting the workouts
            you did, say, or the assistant logging a run you mention. ConjureOS asks you before
            another app's request goes through, and you choose to allow it once, always, or not
            at all. ConjureOS's assistant acts when you ask it to.
          </p>
          <p>What they can read:</p>
          <ul className="consent-list">
            <li>
              The workouts recorded in this app: name, type, date, length, calories burned and,
              for runs and rides, distance
            </li>
            <li>This week's training totals and your plan's days-per-week goal</li>
            <li>Your next workout in the plan, with its exercises and sets</li>
          </ul>
          <p>What they never get:</p>
          <ul className="consent-list withheld">
            <li>Your routes or location</li>
            <li>Your safety answers, injuries, bodyweight, age or sex</li>
            <li>Your coach conversations, the coach's memory, or your check-in answers</li>
          </ul>
          <p>
            They can add a workout you did elsewhere. They cannot change or delete your
            workouts, change your plan, or clear a history. Once another app has your data,
            what it does with it is up to that app and its own policy.
          </p>

          <h3>Who processes it</h3>
          <p>
            An AI request goes through ConjureOS, which routes it to{" "}
            <strong>Anthropic</strong> as the AI provider. Anthropic processes it to produce
            the answer and does not use commercial API data to train its models. Apart from the
            other apps you allow, above, they are the only third party your data is disclosed
            to.
          </p>

          <h3>Your choices</h3>
          <ul className="consent-list">
            <li>
              The AI features above send data when you use them. If you don't want that, don't
              build a plan with the AI or talk to the coach; your workouts still record without
              them.
            </li>
            <li>
              Other apps get nothing until you allow them. You can turn app-to-app connections
              off entirely in ConjureOS Settings → Apps.
            </li>
            <li>
              Apple Health and location are separate permissions. You can turn either off in
              your device's settings at any time.
            </li>
            <li>
              You can delete your data — all of it, or one kind at a time — in Settings → Reset
              data. Deleting is permanent and cannot recall anything already sent.
            </li>
          </ul>

          <h3>If something goes wrong</h3>
          <p>
            If health data is ever exposed to someone who should not have it, we will tell you
            and any regulator we are required to notify. Report a concern through your
            ConjureOS account.
          </p>
        </div>

        <footer className="sheet-foot">
          <button className="btn" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

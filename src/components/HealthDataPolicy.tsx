/**
 * Conjure Fitness's Consumer Health Data Privacy Policy.
 *
 * A SEPARATE document rather than a section of a general privacy policy:
 * Washington's My Health My Data Act requires a distinct consumer health data
 * policy, linked in its own right, and Nevada's SB 370 is close enough that one
 * document serves both.
 *
 * Written for Fitness as it is after the split from Conjure Health: nutrition
 * is off (NUTRITION_ENABLED), so the Journal tab, Find patterns and the food
 * coach are unreachable and this page does not describe them. If nutrition
 * comes back on, this page must describe those flows again (Conjure Health's
 * version renders them from DISCLOSURE_SENDS).
 *
 * The rule for editing it: describe what the code actually does. Every AI call
 * site that sends personal data (plan/generate, coach/coach + context,
 * plan/groups, calories, explainers) is listed under "When it leaves"; add one
 * here when you add one there.
 *
 * Plain-language policy written against how the app behaves. Final copy as of
 * 2026-10-01 (POLICY_UPDATED); keep it true when a data flow changes.
 */

/** Last material revision. Shown so a reader can tell what they agreed to. */
export const POLICY_UPDATED = "2026-10-01";

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
            Conjure Fitness records things about your body and your training: your plan and its
            goals, the workouts you do and how they went, your benchmark results, your weight
            if you log it, and anything you tell the coach, including injuries or limits. Some
            privacy laws call this <strong>consumer health data</strong>. This page explains
            what happens to it.
          </p>
          <p>
            Conjure Fitness is made by ConjureOS LLC. It is not a doctor, a clinic, an insurer, or
            any other kind of healthcare provider, and it is not part of one. That means your
            entries here are not medical records and HIPAA does not apply to them. The
            protections described on this page are the ones we actually implement, not ones
            HIPAA imposes on us.
          </p>

          <h3>Where it lives</h3>
          <p>
            Your entries are stored on your device and in your own ConjureOS account, so they can
            follow you between devices you sign in on. Your conversation with the coach also
            appears in the ConjureOS Chat panel, in the same account. Other people cannot see
            any of it. ConjureOS LLC can access stored data only to run and secure the service,
            or when the law requires it. It is never sold, and it is never used for advertising
            or marketing, by us or by anyone we send it to.
          </p>

          <h3>When it leaves</h3>
          <p>
            Some features need an AI to work. Each one sends only what that request needs, and
            only when you use it. Nothing is sent on a schedule, in the background, or while
            the app is closed.
          </p>
          <ul className="consent-list">
            <li>
              <strong>Building or changing your plan</strong> sends your goal in your own words,
              the plan length, your training experience, days per week, equipment, whether you
              are 60 or older, and, if you told us about an injury, a list of movements to avoid.
            </li>
            <li>
              <strong>Talking to the coach</strong> sends your message and the recent
              conversation, together with your plan, your profile, your recent weigh-ins, your
              last 8 workouts, your past plans, and what the coach has remembered from earlier
              conversations, such as an injury or your schedule.
            </li>
            <li>
              <strong>Finishing a group of workouts</strong> sends that group and your results,
              so the next group can progress from them.
            </li>
            <li>
              <strong>Estimating calories burned</strong> uses a formula. Only when the formula
              is missing something does it ask the AI, sending the workout, its length and
              distance, and your sex, age and weight.
            </li>
            <li>
              <strong>Explaining an exercise</strong> sends only the exercise's name.
            </li>
          </ul>
          <p>None of these send your name, email, or account details.</p>

          <h3>Other apps</h3>
          <p>
            Other ConjureOS apps can ask Conjure Fitness for your workout list and a training
            summary, for example so Conjure Health can count your workouts on its calorie ring.
            ConjureOS asks you before any app can read them, and you can turn cross-app
            connections off in ConjureOS Settings.
          </p>

          <h3>Who processes it</h3>
          <p>
            AI requests go through ConjureOS. By default they are sent to{" "}
            <strong>Anthropic</strong>, our AI provider, which processes them to produce the
            answer and, under its commercial terms, does not train its models on them. If you
            have added your own AI provider key in ConjureOS Settings, requests go to that
            provider instead, under your own agreement with them. We do not disclose your health
            data to anyone else, except where the law requires it.
          </p>

          <h3>Your choices and rights</h3>
          <ul className="consent-list">
            <li>
              Conjure Fitness collects nothing until you agree on its first screen, which also
              tells you what the coach and plan builder send to the AI. You can withdraw that
              agreement at any time in Settings, under Privacy, and collection stops at once.
            </li>
            <li>
              You can delete your data, all of it or one kind at a time, in Settings, under Reset
              health data. Deleting is permanent.
            </li>
            <li>
              To ask what we hold about you, get a copy of it, or delete it along with your
              ConjureOS account, email{" "}
              <a href="mailto:abuse@conjureos.com">abuse@conjureos.com</a>. We answer within 45
              days. If we turn down a request, reply to ask us to reconsider; if you live in
              Washington and still disagree, you can contact the Washington State Attorney
              General.
            </li>
          </ul>

          <h3>If something goes wrong</h3>
          <p>
            If health data is ever exposed to someone who should not have it, we will tell you
            and any regulator we are required to notify.
          </p>

          <h3>Contact</h3>
          <p>
            ConjureOS LLC, Ohio, USA.{" "}
            <a href="mailto:abuse@conjureos.com">abuse@conjureos.com</a>. This page sits
            alongside the ConjureOS{" "}
            <a href="https://www.conjureos.com/privacy.html" target="_blank" rel="noreferrer">
              privacy policy
            </a>
            , which covers your ConjureOS account as a whole.
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

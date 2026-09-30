import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ManualCardioEntry } from "./ManualCardioEntry";

/** Pull the <input> tag carrying the given aria-label out of the markup. */
function inputTag(html: string, label: string): string {
  const m = html.match(new RegExp(`<input[^>]*aria-label="${label}"[^>]*>`));
  if (!m) throw new Error(`input "${label}" not found in: ${html}`);
  return m[0];
}

// The repo has no jsdom, so blur/commit can't be driven. NumberField only
// switches to inputMode="decimal" when decimals > 0, and decimals defaults to 0
// (which rounds 5.4 km -> 5 and 0.4 mi -> 0 on blur). So the rendered input's
// inputMode is the observable proof that the Distance field keeps decimals.
describe("ManualCardioEntry distance field", () => {
  for (const units of ["metric", "imperial"] as const) {
    it(`keeps fractional distances (decimal input, not whole-number) — ${units}`, () => {
      const html = renderToStaticMarkup(
        createElement(ManualCardioEntry, { units, onSave: () => {}, onCancel: () => {} }),
      );
      expect(inputTag(html, "Distance")).toContain('inputMode="decimal"');
    });
  }

  it("leaves the duration field as whole minutes", () => {
    const html = renderToStaticMarkup(
      createElement(ManualCardioEntry, { units: "metric", onSave: () => {}, onCancel: () => {} }),
    );
    expect(inputTag(html, "Duration in minutes")).toContain('inputMode="numeric"');
  });
});

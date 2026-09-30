import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SetRecorder } from "./SetRecorder";

/**
 * Regression for f-runner#4: the weight box was a plain controlled
 * <input value={num(raw)}>, so typing "14." re-rendered as "14" and a decimal
 * weight (12.5, 0.5, a 1.25 kg plate increment) could not be typed.
 *
 * The fix renders the shared NumberField, which keeps the raw typed string
 * while focused. There is no DOM in this test environment, so we render the
 * real SetRecorder to static markup and check that the weight box is a
 * NumberField (text input, decimal keypad, aria-label) seeded from the value,
 * rather than the old bare controlled input (which had no aria-label).
 */
const render = (weightKg: number | undefined, prescribedKg: number | null = 14.5) =>
  renderToStaticMarkup(
    createElement(SetRecorder, {
      prescribed: { reps: 8, weightKg: prescribedKg },
      value: { reps: 8, weightKg },
      onChange: () => {},
    }),
  );

const weightInput = (html: string) => {
  const m = html.match(/<input[^>]*aria-label="Weight \(kg\)"[^>]*>/);
  return m ? m[0] : null;
};

describe("SetRecorder weight field", () => {
  it("renders the weight box through NumberField with a decimal keypad", () => {
    const input = weightInput(render(14.5));
    expect(input).not.toBeNull();
    expect(input).toContain('type="text"');
    expect(input).toContain('inputMode="decimal"');
    expect(input).toContain('value="14.5"');
  });

  it("seeds fractional weights unrounded (1.25 kg increments are kept)", () => {
    expect(weightInput(render(22.5))).toContain('value="22.5"');
    expect(weightInput(render(1.25))).toContain('value="1.25"');
  });

  it("renders an empty weight box when no weight is set", () => {
    expect(weightInput(render(undefined))).toContain('value=""');
  });

  it("hides the weight box for unweighted sets, leaving reps whole-number", () => {
    const html = renderToStaticMarkup(
      createElement(SetRecorder, {
        prescribed: { reps: 10, weightKg: null },
        value: { reps: 10 },
        onChange: () => {},
      }),
    );
    expect(weightInput(html)).toBeNull();
    expect(html).toContain('inputMode="numeric"');
  });
});

import { describe, expect, it } from "vitest";
import { detectStopSymptom, isStopSymptom } from "./symptomKeywords";

describe("detectStopSymptom", () => {
  it("hits red-flag phrases anywhere in the text", () => {
    expect(detectStopSymptom("I'm getting chest pain and feel dizzy")).toBe("chest pain");
    expect(detectStopSymptom("Felt a POP in my knee")).toBe("felt a pop");
    expect(isStopSymptom("I feel numb down my left arm")).toBe(true);
  });

  it("still matches common inflections of a phrase", () => {
    expect(isStopSymptom("my hand has numbness")).toBe(true);
    expect(isStopSymptom("I keep fainting")).toBe(true);
    expect(isStopSymptom("I was vomiting after")).toBe(true);
    expect(isStopSymptom("having palpitations")).toBe(true);
    expect(isStopSymptom("I can’t breathe")).toBe(true); // curly apostrophe
    expect(isStopSymptom("short  of   breath")).toBe(true);
  });

  it("still trips on inflections a whole-word match would miss", () => {
    expect(detectStopSymptom("I feel nauseated after that set")).toBe("nausea");
    expect(detectStopSymptom("a bit nauseous now")).toBe("nauseous");
    expect(detectStopSymptom("felt a popping in my knee")).toBe("felt a pop");
    expect(detectStopSymptom("some chest\npain on the last rep")).toBe("chest pain");
  });

  it("matches whole words: 'number' does not trip 'numb', 'faintly' does not trip 'faint'", () => {
    expect(detectStopSymptom("what's my target number of reps?")).toBeNull();
    expect(detectStopSymptom("I faintly remember that set")).toBeNull();
    expect(detectStopSymptom("How did it go? Felt great.")).toBeNull();
  });
});

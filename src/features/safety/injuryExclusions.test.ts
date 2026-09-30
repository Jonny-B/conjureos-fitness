import { describe, expect, it } from "vitest";
import { EXCLUDED_MOVEMENTS, INJURY_REGIONS, isExerciseExcluded, movementsExcludedFor } from "./injuryExclusions";

describe("isExerciseExcluded — spelling variants", () => {
  const excluded: [string, string][] = [
    ["Push-ups", "wrist"],
    ["Push-ups", "shoulder"],
    ["Pushups", "shoulder"],
    ["Pushups", "wrist"],
    ["PUSH UPS", "elbow"],
    ["Push‑Ups", "wrist"], // non-breaking hyphen
    ["Pullups", "elbow"],
    ["Pull Ups", "shoulder"],
    ["Chinups", "elbow"],
    ["Chin-Ups", "elbow"],
    ["Situps", "lower_back"],
    ["Sit-ups", "lower_back"],
    ["Skull Crushers", "elbow"],
    ["Skullcrushers", "elbow"],
    ["Triceps Extension", "elbow"],
    ["Overhead Triceps Extension", "elbow"],
    ["Stepups", "knee"],
    ["Step Ups", "hip"],
    ["Wall-sit", "knee"],
    ["Wall Sits", "knee"],
    ["Close Grip Bench Press", "elbow"],
    ["Hanging Leg Raises", "hip"],
    ["Jogging", "knee"],
    ["Squats", "knee"],
    ["Sprínt Intervals", "knee"], // accents are dropped, not treated as word breaks
    ["Ｐｕｓｈ－ｕｐｓ", "wrist"], // full-width forms
  ];
  it.each(excluded)("excludes %s for %s", (name, region) => {
    expect(isExerciseExcluded(name, [region])).toBe(true);
  });

  const allowed: [string, string][] = [
    ["Bench Press", "knee"],
    ["Bench Press", "wrist"],
    ["Bicep Stretch", "knee"],
    ["Goblet Hold", "elbow"],
    ["Glute Bridge", "knee"],
    ["Push Press", "knee"],
    ["Plank", "knee"],
    ["Pushing Sled", "elbow"],
    ["Push Open Door Stretch", "ankle"], // "push" + "open" must not read as "hop"
    ["Walking", "knee"],
    ["Easy Walk", "elbow"],
    ["Cat-Cow", "lower_back"],
  ];
  it.each(allowed)("does not exclude %s for %s", (name, region) => {
    expect(isExerciseExcluded(name, [region])).toBe(false);
  });

  it("returns false with no injuries or unknown regions", () => {
    expect(isExerciseExcluded("Pushups", [])).toBe(false);
    expect(isExerciseExcluded("Pushups", ["nope"])).toBe(false);
  });

  it("keeps the readable original patterns in the model avoid-list", () => {
    const list = movementsExcludedFor(["elbow"]);
    expect(list).toContain("push-up");
    expect(list).toContain("skull crusher");
  });

  it("every region has patterns", () => {
    for (const r of INJURY_REGIONS) expect(EXCLUDED_MOVEMENTS[r.id]?.length).toBeGreaterThan(0);
  });
});

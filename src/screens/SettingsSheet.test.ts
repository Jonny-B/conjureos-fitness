import { describe, it, expect, beforeEach } from "vitest";
import type { Profile } from "../types";
import { getRepository, __resetRepository } from "../data/repository";
import { recordAiJournalConsent, withdrawAiJournalConsent, hasAiJournalConsent } from "../features/aiConsent";
import { saveProfileUnits } from "./SettingsSheet";

const profile: Profile = {
  sex: "male",
  age: 40,
  heightCm: 180,
  weightKg: 85,
  activityLevel: "moderate",
  direction: "lose",
  units: "metric",
};

describe("saveProfileUnits writes onto the stored profile, not App's cached copy", () => {
  beforeEach(() => {
    __resetRepository();
  });

  it("does not reinstate consent withdrawn after the cache was taken", async () => {
    const repo = await getRepository();
    await repo.saveProfile(profile);
    await recordAiJournalConsent(false);
    const cached = (await repo.getProfile())!; // what App holds
    await withdrawAiJournalConsent();
    expect(await hasAiJournalConsent()).toBe(false);

    const next = await saveProfileUnits("imperial", cached);
    expect(next.units).toBe("imperial");
    expect((await repo.getProfile())?.units).toBe("imperial");
    expect(await hasAiJournalConsent()).toBe(false);
  });

  it("does not erase consent granted after the cache was taken", async () => {
    const repo = await getRepository();
    await repo.saveProfile(profile);
    const cached = (await repo.getProfile())!;
    await recordAiJournalConsent(false);
    expect(await hasAiJournalConsent()).toBe(true);

    await saveProfileUnits("imperial", cached);
    expect(await hasAiJournalConsent()).toBe(true);
  });

  it("falls back to the given profile when nothing is stored", async () => {
    const next = await saveProfileUnits("imperial", profile);
    expect(next).toEqual({ ...profile, units: "imperial" });
  });
});

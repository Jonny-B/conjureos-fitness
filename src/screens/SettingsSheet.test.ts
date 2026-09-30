import { describe, it, expect, beforeEach } from "vitest";
import type { Profile } from "../types";
import { getRepository, __resetRepository } from "../data/repository";
import { saveProfileUnits } from "./SettingsSheet";
import { vfs } from "../bridge/vfs";

const profile: Profile = {
  sex: "male",
  age: 40,
  weightKg: 85,
  activityLevel: "moderate",
  units: "metric",
};

describe("saveProfileUnits writes onto the stored profile, not App's cached copy", () => {
  beforeEach(async () => {
    // With no `window`, vfs is an in-memory store that outlives each test's repository.
    await vfs.rm("store.json");
    __resetRepository();
  });

  it("keeps a bodyweight saved after the cache was taken", async () => {
    const repo = await getRepository();
    await repo.saveProfile(profile);
    const cached = (await repo.getProfile())!; // what App holds
    await repo.saveProfile({ ...cached, weightKg: 80 }); // e.g. the wizard, since

    const next = await saveProfileUnits("imperial", cached);
    expect(next.units).toBe("imperial");
    expect(next.weightKg).toBe(80);
    expect(await repo.getProfile()).toEqual({ ...profile, weightKg: 80, units: "imperial" });
  });

  it("falls back to the given profile when nothing is stored", async () => {
    const next = await saveProfileUnits("imperial", profile);
    expect(next).toEqual({ ...profile, units: "imperial" });
  });
});

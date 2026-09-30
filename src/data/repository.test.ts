import { describe, it, expect, beforeEach } from "vitest";
import { getRepository, __resetRepository } from "./repository";

describe("getRepository", () => {
  beforeEach(() => __resetRepository());

  it("opens the local store", async () => {
    // Conjure Fitness keeps everything on the device store; there is no remote
    // backend to select.
    expect((await getRepository()).kind).toBe("mock");
  });

  it("returns the same instance on repeat + concurrent calls (idempotent)", async () => {
    const [a, b, c] = await Promise.all([getRepository(), getRepository(), getRepository()]);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

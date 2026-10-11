/**
 * Conjure Fitness is a sealed app (ConjureOS Phase 62, #1050, owner decision
 * 2026-10-11): the AI changes nothing in it. It declared no type before, which
 * made it an AI-editable applet. The type is declared once, as `appType`.
 * `editable: false` is the mirror that clients and stores predating `appType`
 * still read, so it stays beside it. `editStyle` was the older spelling and is
 * not written.
 */
import { describe, expect, it } from "vitest";
import pkg from "../package.json";

const manifest = pkg.conjureos as Record<string, unknown>;

describe("Fitness's ConjureOS manifest", () => {
  it("declares itself sealed", () => {
    expect(manifest.appType).toBe("sealed");
  });

  it("keeps the editable mirror false for clients that predate appType", () => {
    expect(manifest.editable).toBe(false);
  });

  it("does not write the older editStyle key", () => {
    expect("editStyle" in manifest).toBe(false);
  });
});

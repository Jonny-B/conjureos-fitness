/**
 * Conjure Fitness is a sealed anchor app (ConjureOS Phase 62): the AI changes
 * nothing in it. A manifest that declares no type is read as an AI-editable
 * applet, so dropping either key below is a silent change of what the app is.
 * The legacy `editStyle` key is not declared: the store and the kernel write
 * the old keys themselves.
 */
import { describe, it, expect } from "vitest";
import pkg from "../package.json";

describe("the app type the manifest declares", () => {
  const manifest = pkg.conjureos as Record<string, unknown>;

  it("is sealed, with the editable mirror older clients read", () => {
    expect(manifest.appType).toBe("sealed");
    expect(manifest.editable).toBe(false);
  });

  it("does not declare the old editStyle key", () => {
    expect("editStyle" in manifest).toBe(false);
  });
});

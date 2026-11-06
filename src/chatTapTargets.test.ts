/**
 * The ConjureOS Chat sheet and its Settings row (ConjureOS #1230) are tapped
 * on phones: every button there is at least 44px tall. jsdom computes no
 * layout, so this reads the rules themselves.
 */
import { describe, expect, it } from "vitest";

async function stylesheet(): Promise<string> {
  // No Node types in this project: load fs without naming it to the compiler.
  const fsName = "node:fs";
  const fs = (await import(/* @vite-ignore */ fsName)) as { readFileSync(path: URL, enc: "utf8"): string };
  return fs.readFileSync(new URL("./styles.css", import.meta.url), "utf8");
}

const ruleFor = (css: string, selector: string) => {
  const at = css.indexOf(`\n${selector} {`);
  return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
};

describe("tap targets for the ConjureOS Chat agreement", () => {
  it("are at least 44px on the Chat sheet and in Settings' Privacy block, where its row sits", async () => {
    const css = await stylesheet();
    expect(ruleFor(css, ".chat-consent .btn")).toMatch(/min-height:\s*44px/);
    expect(ruleFor(css, ".privacy-block .btn")).toMatch(/min-height:\s*44px/);
  });
});

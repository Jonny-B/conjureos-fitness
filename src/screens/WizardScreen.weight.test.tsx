// @vitest-environment jsdom
/**
 * A get-fit plan (no food tracking) still asks for the person's weight in
 * "About you", with the units toggle, and says plainly what happens when it
 * is skipped. The weight entered reaches the profile body.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WizardBody } from "../features/plan/planService";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../data/repository", () => ({
  getRepository: async () => ({ listWeights: async () => [] }),
}));

import { WizardScreen } from "./WizardScreen";

let host: HTMLDivElement | null = null;
afterEach(() => {
  host?.remove();
  host = null;
});

const click = async (text: string) => {
  const b = [...host!.querySelectorAll("button")].find((x) => x.textContent?.trim() === text)!;
  await act(async () => void b.click());
};

async function toAboutYou() {
  host = document.createElement("div");
  document.body.append(host);
  await act(async () => {
    createRoot(host!).render(<WizardScreen onComplete={(_p, _b: WizardBody) => {}} units="imperial" />);
  });
  await click("I understand");
  await click("Continue");
  return host;
}

describe("Get fit asks for weight", () => {
  it("shows a weight field in the person's units and the average-weight note when blank", async () => {
    const el = await toAboutYou();
    expect(el.textContent).toContain("About you");
    expect(el.querySelector('input[aria-label="Weight"]')).not.toBeNull();
    expect(el.textContent).toContain("(lb)");
    expect(el.textContent).toContain("assumes an average weight");
  });
});

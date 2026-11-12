// @vitest-environment jsdom
/**
 * The built-in library marks workouts that load an injury the person entered
 * in the plan wizard (using the same exclusion map the plan validator uses).
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Plan } from "../types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../features/exercise", async (orig) => ({
  ...(await orig<typeof import("../features/exercise")>()),
  listCompletedWorkouts: async () => [],
}));

import { WorkoutsScreen } from "./WorkoutsScreen";

const planWith = (injuries: string[]) =>
  ({ id: "p", safety: { injuries } }) as unknown as Plan;

let host: HTMLDivElement | null = null;
afterEach(() => {
  host?.remove();
  host = null;
});

async function render(plan: Plan | null) {
  host = document.createElement("div");
  document.body.append(host);
  await act(async () => {
    createRoot(host!).render(<WorkoutsScreen units="metric" plan={plan} onPlanChange={() => {}} />);
  });
  return host;
}

describe("Workouts library and entered injuries", () => {
  it("flags the Full-Body workout for a knee injury, naming the movements", async () => {
    const el = await render(planWith(["knee"]));
    const card = [...el.querySelectorAll("li")].find((l) => l.textContent?.includes("Full-Body Express"))!;
    expect(card.textContent).toContain("May load your knee");
    expect(card.textContent).toContain("Bodyweight Squats");
  });

  it("flags nothing when no injury was entered", async () => {
    const el = await render(planWith([]));
    expect(el.textContent).not.toContain("May load your");
  });
});

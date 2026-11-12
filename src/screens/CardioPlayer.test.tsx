// @vitest-environment jsdom
/**
 * A GPS session whose location is denied (or fails) says so in plain words and
 * offers the manual entry, instead of "Waiting for GPS..." for ever.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Workout } from "../types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let fail: ((m: string) => void) | undefined;
vi.mock("../bridge/location", async (orig) => ({
  ...(await orig<typeof import("../bridge/location")>()),
  isLocationAvailable: () => true,
  watchLocation: (_on: unknown, onError?: (m: string) => void) => {
    fail = onError;
    return () => {};
  },
}));

import { CardioPlayer } from "./CardioPlayer";

const WORKOUT = { id: "w", name: "Easy run", exercises: [], kind: "run" } as unknown as Workout;

let host: HTMLDivElement | null = null;
afterEach(() => {
  host?.remove();
  host = null;
  fail = undefined;
});

const buttonWith = (text: string) =>
  [...host!.querySelectorAll("button")].find((b) => b.textContent?.includes(text));

describe("CardioPlayer without GPS permission", () => {
  it("shows a plain message and a way to continue by hand", async () => {
    host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<CardioPlayer workout={WORKOUT} units="metric" onFinish={() => {}} onCancel={() => {}} />);
    });
    await act(async () => void buttonWith("Start")!.click());
    expect(host.textContent).toContain("Waiting for GPS");

    await act(async () => fail?.("User denied Geolocation"));
    expect(host.textContent).not.toContain("Waiting for GPS");
    expect(host.textContent).toContain("Can't get your location");

    await act(async () => void buttonWith("Enter distance by hand")!.click());
    expect(host.querySelector(".cardio-player")).not.toBeNull();
    expect(host.textContent).not.toContain("Can't get your location");
  });
});

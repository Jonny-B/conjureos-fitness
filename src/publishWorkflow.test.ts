/**
 * The store publish workflow (.github/workflows/publish-store.yml) has a path to
 * each ConjureOS project, and only ever to Conjure Fitness's own listing.
 *
 * - A published GitHub release ships to PROD; Run workflow takes a `target`
 *   (dev or prod, dev by default). The shape is conjureos-health's workflow.
 * - Each publish step pairs its target's project ref, bot password and anon
 *   key. A dev key on the prod step signs the bot into the wrong project.
 * - The slug is `conjure-fitness` everywhere. `fitness` is the old Conjure
 *   Health listing, withdrawn 2026-10-22 (Health publishes as `health`).
 * - The one build step runs for every trigger: the bundle bakes no Supabase
 *   URL (the shared `fitness` schema is Health's, src/data/repository.ts), so
 *   the same build serves both projects. A gated build would leave a release
 *   publishing a dist that was never built.
 * - No `${{ }}` inside a `run:` script: release notes and dispatch text reach
 *   the shell through env vars, never as interpolated source.
 */
import { describe, expect, it } from "vitest";
import workflow from "../.github/workflows/publish-store.yml?raw";

const DEV_REF = "mqpvjlsywrptefgwuztn";
const PROD_REF = "ntgelbtepecqsqloxmct";

/** The text under a top-level key, up to the next top-level key. */
function topLevel(key: string): string {
  const lines = workflow.split("\n");
  const start = lines.findIndex((l) => l === `${key}:`);
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^\S/.test(l) && !l.startsWith("#"));
  return rest.slice(0, end < 0 ? undefined : end).join("\n");
}

interface Step {
  name: string;
  text: string;
}

/** Each `- name:` step of the publish job, with its own lines. */
function steps(): Step[] {
  const out: Step[] = [];
  let current: Step | null = null;
  for (const line of workflow.split("\n")) {
    const m = /^ {6}- name: (.+)$/.exec(line);
    if (m) {
      current = { name: m[1]!.trim(), text: "" };
      out.push(current);
    } else if (current) {
      current.text += `${line}\n`;
    }
  }
  return out;
}

function field(step: Step, key: string): string | undefined {
  return new RegExp(`^\\s+${key}: (.+)$`, "m").exec(step.text)?.[1]?.trim();
}

/** The `ref` and `role` claims inside an inlined Supabase anon key. */
function claims(jwt: string): { ref?: string; role?: string } {
  const payload = jwt.split(".")[1] ?? "";
  const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
}

const publishSteps = () => steps().filter((s) => field(s, "uses")?.endsWith("/publish-anchor-app"));
const stepFor = (target: "dev" | "prod") =>
  publishSteps().find((s) => s.name === `Publish to App Store (${target})`);

describe("the publish workflow's triggers", () => {
  const on = topLevel("on");

  it("publishes to prod when a release is published", () => {
    expect(on).toMatch(/^ {2}release:\n {4}types: \[published\]$/m);
  });

  it("asks Run workflow for a target, dev or prod, dev by default", () => {
    expect(on).toMatch(/^ {2}workflow_dispatch:$/m);
    const target = /^ {6}target:\n((?: {8}.*\n?)+)/m.exec(on)?.[1] ?? "";
    expect(target).toMatch(/^ {8}type: choice$/m);
    expect(target).toMatch(/^ {8}options: \[dev, prod\]$/m);
    expect(target).toMatch(/^ {8}default: dev$/m);
  });
});

describe("the publish steps", () => {
  it("are one per project, each gated to its own trigger", () => {
    expect(publishSteps().map((s) => s.name)).toEqual([
      "Publish to App Store (dev)",
      "Publish to App Store (prod)",
    ]);
    expect(field(stepFor("dev")!, "if")).toBe(
      "github.event_name == 'workflow_dispatch' && inputs.target != 'prod'",
    );
    expect(field(stepFor("prod")!, "if")).toBe(
      "github.event_name == 'release' || (github.event_name == 'workflow_dispatch' && inputs.target == 'prod')",
    );
  });

  it.each([
    ["dev", "SUPABASE_DEV_PROJECT_REF", "PUBLISH_BOT_DEV_PASSWORD", DEV_REF],
    ["prod", "SUPABASE_PROD_PROJECT_REF", "PUBLISH_BOT_PROD_PASSWORD", PROD_REF],
  ] as const)("%s pairs its own project ref, bot password and anon key", (target, refSecret, pwSecret, ref) => {
    const step = stepFor(target)!;
    expect(field(step, "supabase-url")).toBe(`https://\${{ secrets.${refSecret} }}.supabase.co`);
    expect(field(step, "bot-password")).toBe(`\${{ secrets.${pwSecret} }}`);
    expect(claims(field(step, "supabase-anon-key") ?? "")).toMatchObject({ ref, role: "anon" });
  });

  it("publish only to the conjure-fitness listing, never to fitness", () => {
    for (const step of publishSteps()) expect(field(step, "slug")).toBe("conjure-fitness");
    expect(workflow).not.toMatch(/^\s+slug:\s*["']?fitness["']?\s*$/m);
  });
});

describe("the build", () => {
  it("is one step that runs for every trigger and bakes no Supabase URL", () => {
    const builds = steps().filter((s) => /^\s+run: npm run build:inline$/m.test(s.text));
    expect(builds).toHaveLength(1);
    expect(field(builds[0]!, "if")).toBeUndefined();
    expect(workflow).not.toMatch(/^\s+VITE_SUPABASE_\w+:/m);
  });

  it("takes the changelog from the release on a release, through env vars", () => {
    const step = steps().find((s) => s.name === "Resolve changelog")!;
    expect(field(step, "RELEASE_BODY")).toBe("${{ github.event.release.body }}");
    expect(step.text).toMatch(/if \[ "\$EVENT_NAME" = "release" \]/);
  });

  it("never interpolates ${{ }} into a run script", () => {
    for (const step of steps()) {
      const script = /^ {8}run: \|\n((?: {10}.*\n?| *\n)+)/m.exec(step.text)?.[1] ?? "";
      expect(script, step.name).not.toContain("${{");
    }
  });
});

/**
 * Wrapper around `window.__conjureos.ai.complete` with a dev-mode mock so
 * natural-language logging is iterable outside ConjureOS. Gated on the
 * `ai.complete` permission. ConjureOS routes to the user's BYK key (Sonnet)
 * or the hosted free-tier proxy (Haiku) — quality differs, shape doesn't.
 */

/**
 * Which model ConjureOS routes a request to. `cheap` for high-volume parsing,
 * `capable` for reasoning (plan generation, coaching), `epic` for the rare
 * heavyweight call. Costs the user more as it climbs, so default to the
 * cheapest tier that produces a usable answer.
 */
export type ModelTier = "cheap" | "capable" | "epic";

/** An image attached to a chat message, for the vision-backed capture flows. */
export interface ChatImage {
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  /** Raw base64 — no `data:image/...;base64,` prefix. */
  data: string;
}

/** One turn of a conversation sent to the model. */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Attached images; only meaningful on `user` turns. */
  images?: ChatImage[];
}

/** A single completion request. Mirrors the bridge's wire shape exactly. */
export interface CompleteRequest {
  /** System prompt: the model's role, rules, and required output shape. */
  system: string;
  /** Conversation so far, oldest first. */
  messages: ChatMessage[];
  /** Response cap. Defaults to the host's own limit when omitted. */
  maxTokens?: number;
  /** Model tier; the host picks a sensible default when omitted. */
  tier?: ModelTier;
}

declare global {
  interface ConjureosBridge {
    ai?: {
      complete: (req: CompleteRequest) => Promise<{ content: string }>;
    };
  }
  interface Window {
    __conjureos?: ConjureosBridge;
  }
}

const bridge = () =>
  typeof window !== "undefined" ? window.__conjureos?.ai?.complete : undefined;

/**
 * Whether a real host is present to serve completions. False under `npm run
 * dev`, in tests, and during SSR — `complete` still resolves there, but from
 * the canned mock below, so gate any *user-facing* "ask the AI" affordance on
 * this rather than assuming a live model.
 */
export function isAiAvailable(): boolean {
  return typeof bridge() === "function";
}

/**
 * Run one completion and return the model's text. Falls back to a deterministic
 * mock when no host bridge is present, so every AI-backed flow stays walkable
 * outside ConjureOS.
 *
 * Rejects only if the host itself fails. Callers own the parsing: model output
 * is untrusted text, so pair this with `extractJson` plus explicit validation
 * and always keep a non-AI fallback path.
 */
export async function complete(req: CompleteRequest): Promise<string> {
  const fn = bridge();
  if (fn) return (await fn(req)).content;
  return mockComplete(req);
}

/**
 * Turn a rejected `complete()` into something worth reading.
 *
 * The host rejects with its own reason — "out_of_credits", "rate limit",
 * "ai.complete blocked: this app's window is minimized", "ai timeout" — and
 * every one of those was being reported to the user as "check your
 * connection", which is both wrong and unactionable. Running out of credits
 * is not a network problem and no amount of retrying fixes it.
 *
 * Known reasons map to a sentence that says what to DO. Anything unrecognised
 * keeps the host's own words in parentheses rather than being swallowed: in
 * alpha, a reason we haven't seen before is worth more on screen than a
 * reassuring generic.
 */
export function aiErrorMessage(err: unknown, fallback = "The AI didn't answer. Try again."): string {
  const raw = (err instanceof Error ? err.message : String(err ?? "")).trim();
  const m = raw.toLowerCase();
  // Ordered most-specific first: the proxy's 402/429 bodies mention credits
  // AND limits, so "out of credits" must be decided before the daily cap.
  if (m.includes("out_of_credits") || m.includes("out of credits")) {
    return "You're out of AI credits. Top up in ConjureOS settings, or add your own Anthropic key.";
  }
  if (m.includes("daily_cap") || m.includes("free_tier") || m.includes("free-tier") || m.includes("daily")) {
    return "You've used up today's AI allowance. It resets at midnight UTC.";
  }
  if (m.includes("rate limit") || m.includes("rate_limited")) {
    return "Too many AI requests just now. Wait a few seconds and try again.";
  }
  if (m.includes("timeout") || m.includes("timed out")) {
    return "The AI took too long to answer. Try again.";
  }
  if (m.includes("background") || m.includes("minimized")) {
    return "AI is paused while this app isn't the one on screen. Bring it to the front and try again.";
  }
  if (m.includes("sign in") || m.includes("authentication")) {
    return "Sign in to ConjureOS to use AI.";
  }
  if (m.includes("permission")) {
    return "This app doesn't have AI permission yet. Grant it in ConjureOS and try again.";
  }
  if (m.includes("unsupported_model")) {
    return "Your plan can't run the model this needs. Check your ConjureOS plan.";
  }
  if (m.includes("configured") || m.includes("not available") || m.includes("isn't available")) {
    return "AI isn't available here yet.";
  }
  if (!raw) return fallback;
  return `${fallback} (${raw})`;
}

/**
 * Pull the JSON payload out of a model reply.
 *
 * Every JSON-returning prompt in this app ends with "output ONLY the JSON",
 * and models still wrap it in ```fences``` or a sentence of preamble often
 * enough that parsing the raw string is a reliable source of failures. This
 * tries, in order: a fenced block, then the widest `{…}` span, then the
 * trimmed input.
 *
 * Returns a *candidate* string, never a parsed value — it does no validation
 * and does not throw, so the caller still wraps `JSON.parse` in try/catch and
 * validates the shape before trusting it.
 */
export function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) return fenced[1].trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end > start) return raw.slice(start, end + 1);
  return raw.trim();
}

/**
 * Dev-mode mock for natural-language meal parsing. Returns a deterministic
 * structured payload so the logging UI is exercisable via `npm run dev`. The
 * real model output will differ in detail but matches this shape.
 */
async function mockComplete(req: CompleteRequest): Promise<string> {
  await new Promise((r) => setTimeout(r, 500));
  const text = req.messages.at(-1)?.content?.toLowerCase() ?? "";
  const items: Array<Record<string, unknown>> = [];
  const push = (name: string, m: number[], serving: string) =>
    items.push({
      name,
      servingSize: serving,
      calories: m[0],
      protein: m[1],
      carbs: m[2],
      fat: m[3],
    });

  if (text.includes("egg")) push("Scrambled eggs", [180, 12, 2, 13], "2 eggs");
  if (text.includes("coffee")) push("Coffee, black", [5, 0, 1, 0], "1 cup");
  if (text.includes("chicken")) push("Grilled chicken breast", [280, 52, 0, 6], "6 oz");
  if (text.includes("sandwich")) push("Sandwich", [350, 15, 45, 12], "1 sandwich");
  if (text.includes("beer")) push("Beer", [153, 2, 13, 0], "1 can (355 ml)");
  if (text.includes("rice")) push("White rice, cooked", [205, 4, 45, 0], "1 cup");
  if (text.includes("salad")) push("Garden salad", [120, 4, 14, 6], "1 bowl");
  if (text.includes("banana")) push("Banana", [105, 1, 27, 0], "1 medium");

  if (items.length === 0) {
    push("Mixed meal (estimate)", [400, 20, 40, 15], "1 serving");
  }
  return JSON.stringify({ items });
}

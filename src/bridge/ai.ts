/**
 * Wrapper around `window.__conjureos.ai.complete` with a dev-mode mock so
 * natural-language logging is iterable outside ConjureOS. Gated on the
 * `ai.complete` permission. ConjureOS routes to the user's BYK key (Sonnet)
 * or the hosted free-tier proxy (Haiku) — quality differs, shape doesn't.
 */

export type ModelTier = "cheap" | "capable" | "epic";

export interface ChatImage {
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  /** Raw base64 — no `data:image/...;base64,` prefix. */
  data: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  images?: ChatImage[];
}

export interface CompleteRequest {
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
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

const bridge = () => window.__conjureos?.ai?.complete;

export function isAiAvailable(): boolean {
  return typeof bridge() === "function";
}

export async function complete(req: CompleteRequest): Promise<string> {
  const fn = bridge();
  if (fn) return (await fn(req)).content;
  return mockComplete(req);
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

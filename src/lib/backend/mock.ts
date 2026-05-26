/**
 * Mock backend — runs the whole app in the browser with no server.
 *
 * This is what makes the open-source frontend developable without the closed
 * backend: seeded data persisted to localStorage, a fake auth flow (any
 * credentials work), and an offline "AI" parser that estimates macros from a
 * keyword table instead of calling Claude. It is intentionally deterministic
 * and dependency-free so contributors get the same experience every run.
 *
 * Selected automatically when Supabase env vars are absent, or forced with
 * VITE_USE_MOCK=true. Reset everything by clearing localStorage.
 */
import type { DraftEntry, Entry, Goals } from "../types";
import { DEFAULT_GOALS } from "../types";
import { shiftYmd, ymd } from "../date";
import type { AppSession, FitnessBackend, ParseInput } from "./types";

const STORE_KEY = "conjureos-fitness:mock-store:v1";
const SESSION_KEY = "conjureos-fitness:mock-session:v1";
const DEMO_USER_ID = "demo-user";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const uuid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const round1 = (n: number) => Math.round(n * 10) / 10;

interface Store {
  entries: Entry[];
  goals: Goals;
}

function load(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw) as Store;
  } catch {
    /* fall through to seed */
  }
  const seeded = seed();
  save(seeded);
  return seeded;
}

function save(store: Store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* storage may be unavailable (private mode); keep in memory only */
  }
}

// ── offline "AI" estimator ──────────────────────────────────────────────────
interface FoodDef {
  keys: string[];
  name: string;
  qty: string;
  cal: number;
  p: number;
  c: number;
  f: number;
}

// Per typical serving. Coarse on purpose — a starting point the user adjusts,
// which mirrors how the real estimates are framed.
const FOODS: FoodDef[] = [
  { keys: ["chicken sandwich"], name: "Chicken sandwich", qty: "1 sandwich", cal: 480, p: 33, c: 44, f: 19 },
  { keys: ["chicken breast", "grilled chicken", "chicken"], name: "Chicken breast", qty: "1 breast", cal: 280, p: 53, c: 0, f: 6 },
  { keys: ["beer"], name: "Beer", qty: "12 oz", cal: 153, p: 1.6, c: 13, f: 0 },
  { keys: ["wine"], name: "Wine", qty: "5 oz", cal: 125, p: 0.1, c: 4, f: 0 },
  { keys: ["coffee", "latte"], name: "Latte", qty: "12 oz", cal: 120, p: 8, c: 12, f: 5 },
  { keys: ["oatmeal", "oats", "porridge"], name: "Oatmeal", qty: "1 cup", cal: 220, p: 8, c: 38, f: 4 },
  { keys: ["eggs", "egg"], name: "Eggs", qty: "2 eggs", cal: 156, p: 12, c: 1, f: 11 },
  { keys: ["bacon"], name: "Bacon", qty: "2 strips", cal: 86, p: 6, c: 0, f: 7 },
  { keys: ["toast", "bread"], name: "Toast", qty: "1 slice", cal: 90, p: 3, c: 16, f: 1 },
  { keys: ["banana"], name: "Banana", qty: "1 medium", cal: 105, p: 1.3, c: 27, f: 0.4 },
  { keys: ["apple"], name: "Apple", qty: "1 medium", cal: 95, p: 0.5, c: 25, f: 0.3 },
  { keys: ["salad"], name: "Garden salad", qty: "1 bowl", cal: 180, p: 5, c: 12, f: 13 },
  { keys: ["burrito"], name: "Burrito", qty: "1 burrito", cal: 620, p: 27, c: 72, f: 24 },
  { keys: ["burger", "cheeseburger"], name: "Cheeseburger", qty: "1 burger", cal: 550, p: 30, c: 40, f: 30 },
  { keys: ["pizza"], name: "Pizza", qty: "2 slices", cal: 570, p: 24, c: 64, f: 22 },
  { keys: ["rice"], name: "Rice", qty: "1 cup", cal: 205, p: 4, c: 45, f: 0.4 },
  { keys: ["steak"], name: "Steak", qty: "6 oz", cal: 420, p: 46, c: 0, f: 26 },
  { keys: ["potato", "baked potato", "fries"], name: "Baked potato", qty: "1 medium", cal: 160, p: 4, c: 37, f: 0.2 },
  { keys: ["salmon", "fish"], name: "Salmon", qty: "5 oz", cal: 290, p: 33, c: 0, f: 17 },
  { keys: ["pasta", "spaghetti"], name: "Pasta", qty: "1.5 cups", cal: 320, p: 12, c: 62, f: 3 },
  { keys: ["yogurt", "greek yogurt"], name: "Greek yogurt", qty: "1 cup", cal: 150, p: 20, c: 9, f: 4 },
  { keys: ["protein shake", "shake", "smoothie"], name: "Protein shake", qty: "1 shake", cal: 200, p: 30, c: 12, f: 4 },
  { keys: ["chocolate", "cookie", "dessert"], name: "Sweet treat", qty: "1 serving", cal: 230, p: 3, c: 30, f: 12 },
  { keys: ["soda", "coke", "pop"], name: "Soda", qty: "12 oz", cal: 140, p: 0, c: 39, f: 0 },
];

interface ExerciseDef {
  keys: string[];
  name: string;
  calPerMin: number;
}

const EXERCISES: ExerciseDef[] = [
  { keys: ["hiit", "interval"], name: "HIIT", calPerMin: 12 },
  { keys: ["run", "running", "jog", "jogging"], name: "Running", calPerMin: 10.5 },
  { keys: ["swim", "swimming"], name: "Swimming", calPerMin: 9 },
  { keys: ["row", "rowing"], name: "Rowing", calPerMin: 9 },
  { keys: ["cycle", "cycling", "bike", "biking", "spin"], name: "Cycling", calPerMin: 8 },
  { keys: ["elliptical"], name: "Elliptical", calPerMin: 7 },
  { keys: ["weights", "lifting", "strength", "gym", "weight"], name: "Weight training", calPerMin: 6 },
  { keys: ["hike", "hiking"], name: "Hiking", calPerMin: 6.5 },
  { keys: ["walk", "walking"], name: "Walking", calPerMin: 4 },
  { keys: ["yoga", "pilates", "stretch"], name: "Yoga", calPerMin: 3 },
];

const splitChunks = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/,|\band\b|\bwith\b|&|\bplus\b|\bthen\b/)
    .map((s) => s.trim())
    .filter(Boolean);

const leadingQty = (chunk: string): number => {
  const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, dozen: 12 };
  const m = chunk.match(/^(\d+)/);
  if (m) return Math.min(20, parseInt(m[1], 10) || 1);
  const w = chunk.split(/\s+/)[0];
  return words[w] ?? 1;
};

function estimateFood(text: string): DraftEntry[] {
  const out: DraftEntry[] = [];
  for (const chunk of splitChunks(text)) {
    const def = FOODS.find((d) => d.keys.some((k) => chunk.includes(k)));
    const mult = leadingQty(chunk);
    if (def) {
      out.push({
        kind: "food",
        name: mult > 1 ? `${def.name} ×${mult}` : def.name,
        quantity: def.qty,
        calories: round1(def.cal * mult),
        protein_g: round1(def.p * mult),
        carbs_g: round1(def.c * mult),
        fat_g: round1(def.f * mult),
      });
    } else {
      // Generic fallback so nothing is ever "unrecognized".
      const label = chunk.replace(/^\d+\s*/, "").trim() || "Food item";
      out.push({
        kind: "food",
        name: label.charAt(0).toUpperCase() + label.slice(1),
        quantity: "1 serving",
        calories: 220 * mult,
        protein_g: 9 * mult,
        carbs_g: 24 * mult,
        fat_g: 9 * mult,
      });
    }
  }
  return out.length ? out : [{ kind: "food", name: "Food item", quantity: "1 serving", calories: 220, protein_g: 9, carbs_g: 24, fat_g: 9 }];
}

function detectMinutes(text: string): number {
  const t = text.toLowerCase();
  const hm = t.match(/(\d+)\s*(h|hr|hour)/);
  const mm = t.match(/(\d+)\s*(m|min|minute)/);
  let mins = 0;
  if (hm) mins += parseInt(hm[1], 10) * 60;
  if (mm) mins += parseInt(mm[1], 10);
  if (/half an hour|half hour/.test(t)) mins += 30;
  if (/an hour|one hour/.test(t) && !hm) mins += 60;
  return mins || 30;
}

function estimateExercise(text: string): DraftEntry[] {
  const out: DraftEntry[] = [];
  for (const chunk of splitChunks(text)) {
    const def = EXERCISES.find((d) => d.keys.some((k) => chunk.includes(k)));
    const mins = detectMinutes(chunk);
    const intensity = /vigorous|hard|fast|intense/.test(chunk)
      ? 1.2
      : /light|easy|slow|gentle/.test(chunk)
        ? 0.8
        : 1;
    const perMin = def?.calPerMin ?? 6;
    out.push({
      kind: "exercise",
      name: def?.name ?? "Workout",
      quantity: `${mins} min`,
      calories: round1(perMin * mins * intensity),
    });
  }
  return out.length ? out : [{ kind: "exercise", name: "Workout", quantity: "30 min", calories: 180 }];
}

// A photo can't be analyzed offline — return a believable canned plate so the
// photo-logging UI is still demoable.
const photoFallback = (): DraftEntry[] => [
  { kind: "food", name: "Grilled chicken", quantity: "~6 oz", calories: 280, protein_g: 53, carbs_g: 0, fat_g: 6 },
  { kind: "food", name: "Rice", quantity: "~1 cup", calories: 205, protein_g: 4, carbs_g: 45, fat_g: 0.4 },
  { kind: "food", name: "Steamed veg", quantity: "~1 cup", calories: 80, protein_g: 4, carbs_g: 14, fat_g: 1 },
];

// ── seed ──────────────────────────────────────────────────────────────────
function entry(date: string, d: DraftEntry, ageMs: number): Entry {
  return {
    id: uuid(),
    entry_date: date,
    kind: d.kind,
    name: d.name,
    quantity: d.quantity || null,
    calories: d.calories,
    protein_g: d.kind === "food" ? d.protein_g : null,
    carbs_g: d.kind === "food" ? d.carbs_g : null,
    fat_g: d.kind === "food" ? d.fat_g : null,
    created_at: new Date(Date.now() - ageMs).toISOString(),
  } as Entry & { created_at: string };
}

function seed(): Store {
  const today = ymd();
  const entries: Entry[] = [];
  let age = 0;
  const at = (date: string, drafts: DraftEntry[]) => {
    for (const d of drafts) entries.push(entry(date, d, (age += 60_000)));
  };

  at(shiftYmd(today, -3), [...estimateFood("oatmeal and a banana"), ...estimateFood("chicken sandwich"), ...estimateExercise("30 min run")]);
  at(shiftYmd(today, -2), [...estimateFood("eggs and bacon and toast"), ...estimateFood("burrito"), ...estimateExercise("45 min weights")]);
  at(shiftYmd(today, -1), [...estimateFood("greek yogurt"), ...estimateFood("salmon and rice and salad"), ...estimateFood("wine")]);
  at(today, [...estimateFood("latte and oatmeal"), ...estimateExercise("20 min walk")]);

  return { entries, goals: { ...DEFAULT_GOALS } };
}

// ── backend ─────────────────────────────────────────────────────────────────
export function createMockBackend(): FitnessBackend {
  let store = load();
  const listeners = new Set<(s: AppSession | null) => void>();

  const persist = () => save(store);

  const readSession = (): AppSession | null => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw) as AppSession) : null;
    } catch {
      return null;
    }
  };

  const writeSession = (s: AppSession | null) => {
    try {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
    listeners.forEach((cb) => cb(s));
  };

  const signIn = (email: string): AppSession => {
    const session: AppSession = { user: { id: DEMO_USER_ID, email }, accessToken: "mock" };
    writeSession(session);
    return session;
  };

  return {
    kind: "mock",
    notice: "Demo mode — running on in-browser mock data, no backend required. Sign in with anything.",

    async getSession() {
      return readSession();
    },

    onAuthStateChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    async signInWithPassword(email) {
      await delay(250);
      signIn(email || "demo@conjureos.dev");
    },

    async signInWithOtp(email) {
      await delay(250);
      signIn(email || "demo@conjureos.dev");
      return { message: "Demo mode: signed in instantly (no email sent)." };
    },

    async signInWithGoogle() {
      await delay(250);
      signIn("demo@conjureos.dev");
    },

    async signOut() {
      writeSession(null);
    },

    async parseEntries(input: ParseInput) {
      await delay(400); // simulate inference latency so loading states show
      if (input.image) return photoFallback();
      const text = input.text ?? "";
      return input.kind === "exercise" ? estimateExercise(text) : estimateFood(text);
    },

    async addEntries(date, drafts) {
      await delay(120);
      const rows = drafts.map((d) => entry(date, d, 0));
      // newest entries get the latest created_at so ordering is stable
      const base = Date.now();
      rows.forEach((r, i) => ((r as Entry & { created_at: string }).created_at = new Date(base + i).toISOString()));
      store.entries.push(...rows);
      persist();
      return rows;
    },

    async listEntries(date) {
      await delay(80);
      return store.entries
        .filter((e) => e.entry_date === date)
        .sort((a, b) => cmpCreated(a, b));
    },

    async listEntriesInRange(from, to) {
      await delay(80);
      return store.entries.filter((e) => e.entry_date >= from && e.entry_date <= to);
    },

    async updateEntry(id, patch) {
      await delay(80);
      store.entries = store.entries.map((e) => (e.id === id ? { ...e, ...patch } : e));
      persist();
    },

    async deleteEntry(id) {
      await delay(80);
      store.entries = store.entries.filter((e) => e.id !== id);
      persist();
    },

    async getGoals() {
      return { ...store.goals };
    },

    async saveGoals(goals) {
      await delay(80);
      store.goals = { ...goals };
      persist();
    },
  };
}

const cmpCreated = (a: Entry, b: Entry): number => {
  const ca = (a as Entry & { created_at?: string }).created_at ?? "";
  const cb = (b as Entry & { created_at?: string }).created_at ?? "";
  return ca < cb ? -1 : ca > cb ? 1 : 0;
};

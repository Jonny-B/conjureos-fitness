import { useEffect, useRef, useState } from "react";
import type { FoodItem, MealType } from "../types";
import { MEAL_LABELS, MEAL_TYPES } from "../types";
import { getRepository } from "../data/repository";
import { searchFoods, lookupBarcode } from "../features/foods/foodSearch";
import { parseMeal } from "../features/naturalLanguage";
import { isValidBarcode } from "../features/barcode";
import { listRecipes, markCooked, type ListedRecipe } from "../bridge/recipeBridge";
import { BarcodeScanner } from "../components/BarcodeScanner";

type Mode = "search" | "scan" | "describe" | "recipes";

interface Props {
  date: string;
  defaultMeal: MealType;
  onLogged: () => void;
  onCancel: () => void;
}

export function AddFoodScreen({ date, defaultMeal, onLogged, onCancel }: Props) {
  const [mode, setMode] = useState<Mode>("search");
  const [selected, setSelected] = useState<{ food: FoodItem; recipeSlug?: string } | null>(null);

  if (selected) {
    return (
      <LogPanel
        food={selected.food}
        recipeSlug={selected.recipeSlug}
        date={date}
        defaultMeal={defaultMeal}
        onLogged={onLogged}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <div className="add">
      <div className="add-modes">
        {(["search", "scan", "describe", "recipes"] as Mode[]).map((m) => (
          <button key={m} className={`chip${mode === m ? " active" : ""}`} onClick={() => setMode(m)}>
            {MODE_LABELS[m]}
          </button>
        ))}
        <div className="add-modes-spacer" />
        <button className="link-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>

      {mode === "search" && <SearchMode onPick={(food) => setSelected({ food })} />}
      {mode === "scan" && <ScanMode onPick={(food) => setSelected({ food })} />}
      {mode === "describe" && <DescribeMode date={date} defaultMeal={defaultMeal} onLogged={onLogged} />}
      {mode === "recipes" && (
        <RecipesMode onPick={(food, slug) => setSelected({ food, recipeSlug: slug })} />
      )}
    </div>
  );
}

const MODE_LABELS: Record<Mode, string> = {
  search: "Search",
  scan: "Scan",
  describe: "Describe",
  recipes: "Recipes",
};

// ── Search ─────────────────────────────────────────────────────────────

function SearchMode({ onPick }: { onPick: (food: FoodItem) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoodItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const found = await searchFoods(query, 20, controller.signal);
        if (!controller.signal.aborted) setResults(found);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 350);
    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [query]);

  return (
    <div className="mode-body">
      <input
        className="text-input"
        placeholder="Search foods (e.g. greek yogurt)"
        value={query}
        autoFocus
        onChange={(e) => setQuery(e.target.value)}
      />
      {loading && <div className="muted small">Searching Open Food Facts + USDA…</div>}
      <FoodResultList foods={results} onPick={onPick} emptyHint={query.length >= 2 ? "No matches." : "Type to search."} />
    </div>
  );
}

// ── Scan ───────────────────────────────────────────────────────────────

function ScanMode({ onPick }: { onPick: (food: FoodItem) => void }) {
  const [manual, setManual] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const busy = useRef(false);

  const resolve = async (barcode: string) => {
    if (busy.current) return;
    busy.current = true;
    setStatus(`Looking up ${barcode}…`);
    try {
      const food = await lookupBarcode(barcode);
      if (food) onPick(food);
      else setStatus(`No product found for ${barcode}.`);
    } finally {
      busy.current = false;
    }
  };

  return (
    <div className="mode-body">
      <BarcodeScanner onDetected={resolve} onError={(m) => setStatus(m)} />
      <div className="manual-barcode">
        <input
          className="text-input"
          placeholder="Barcode number"
          inputMode="numeric"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
        />
        <button
          className="btn"
          disabled={!isValidBarcode(manual)}
          onClick={() => resolve(manual.replace(/\D/g, ""))}
        >
          Look up
        </button>
      </div>
      {status && <div className="muted small">{status}</div>}
    </div>
  );
}

// ── Describe (natural language / AI) ─────────────────────────────────────

function DescribeMode({
  date,
  defaultMeal,
  onLogged,
}: {
  date: string;
  defaultMeal: MealType;
  onLogged: () => void;
}) {
  const [text, setText] = useState("");
  const [meal, setMeal] = useState<MealType>(defaultMeal);
  const [items, setItems] = useState<FoodItem[] | null>(null);
  const [busy, setBusy] = useState(false);

  const parse = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      setItems(await parseMeal({ text }));
    } finally {
      setBusy(false);
    }
  };

  const logAll = async () => {
    if (!items?.length) return;
    const repo = await getRepository();
    for (const food of items) {
      await repo.addDiaryEntry({ date, meal, quantity: 1, food });
    }
    onLogged();
  };

  return (
    <div className="mode-body">
      <textarea
        className="text-area"
        rows={3}
        placeholder="Describe what you ate, e.g. 'chicken sandwich and a beer'"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="row gap">
        <MealPicker meal={meal} onChange={setMeal} />
        <button className="btn" disabled={busy || !text.trim()} onClick={parse}>
          {busy ? "Estimating…" : "Estimate"}
        </button>
      </div>

      {items && (
        <>
          <div className="muted small">Estimates — adjust later by editing the diary entry.</div>
          <ul className="parsed-list">
            {items.map((f) => (
              <li className="parsed" key={f.id}>
                <span className="entry-name">{f.name}</span>
                <span className="entry-sub">
                  ~{f.perServing.calories} cal · {f.servingSize}
                </span>
              </li>
            ))}
          </ul>
          <button className="btn primary block" disabled={!items.length} onClick={logAll}>
            Log {items.length} item{items.length === 1 ? "" : "s"} to {MEAL_LABELS[meal]}
          </button>
        </>
      )}
    </div>
  );
}

// ── Recipes (cross-app) ──────────────────────────────────────────────────

function RecipesMode({ onPick }: { onPick: (food: FoodItem, slug: string) => void }) {
  const [recipes, setRecipes] = useState<ListedRecipe[] | null>(null);

  useEffect(() => {
    listRecipes().then(setRecipes);
  }, []);

  if (!recipes) return <div className="muted small mode-body">Loading your recipes…</div>;
  if (recipes.length === 0)
    return <div className="muted small mode-body">No saved recipes found in the Recipes app.</div>;

  return (
    <div className="mode-body">
      <ul className="food-results">
        {recipes.map((r) => {
          const n = r.nutrition;
          return (
            <li key={r.slug}>
              <button
                className="food-result"
                disabled={!n}
                onClick={() =>
                  n &&
                  onPick(
                    {
                      id: r.slug,
                      source: "recipe",
                      name: r.title,
                      perServing: { calories: n.calories, protein: n.protein, carbs: n.carbs, fat: n.fat },
                      servingSize: "1 serving",
                    },
                    r.slug,
                  )
                }
              >
                <div className="entry-main">
                  <div className="entry-name">{r.title}</div>
                  <div className="entry-sub">
                    {n ? `~${n.calories} cal · ${n.protein}g P` : "no nutrition data"} · made {r.madeCount}×
                  </div>
                </div>
                <div className="entry-cal">{n?.calories ?? "–"}</div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Shared: result list + log panel ──────────────────────────────────────

function FoodResultList({
  foods,
  onPick,
  emptyHint,
}: {
  foods: FoodItem[];
  onPick: (food: FoodItem) => void;
  emptyHint: string;
}) {
  if (foods.length === 0) return <div className="muted small">{emptyHint}</div>;
  return (
    <ul className="food-results">
      {foods.map((f, i) => (
        <li key={`${f.source}-${f.id}-${i}`}>
          <button className="food-result" onClick={() => onPick(f)}>
            <div className="entry-main">
              <div className="entry-name">{f.name}</div>
              <div className="entry-sub">
                {f.servingSize}
                {f.brand ? ` · ${f.brand}` : ""} · {f.source === "usda" ? "USDA" : "OFF"}
              </div>
            </div>
            <div className="entry-cal">{f.perServing.calories}</div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function LogPanel({
  food,
  recipeSlug,
  date,
  defaultMeal,
  onLogged,
  onBack,
}: {
  food: FoodItem;
  recipeSlug?: string;
  date: string;
  defaultMeal: MealType;
  onLogged: () => void;
  onBack: () => void;
}) {
  const [qty, setQty] = useState(1);
  const [meal, setMeal] = useState<MealType>(defaultMeal);
  const [busy, setBusy] = useState(false);

  const cal = Math.round(food.perServing.calories * qty);

  const log = async () => {
    setBusy(true);
    try {
      const repo = await getRepository();
      await repo.addDiaryEntry({ date, meal, quantity: qty, food });
      if (recipeSlug) await markCooked(recipeSlug);
      onLogged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="log-panel">
      <button className="link-btn" onClick={onBack}>
        ‹ Back
      </button>
      <h2 className="log-title">{food.name}</h2>
      {food.brand && <div className="muted">{food.brand}</div>}

      <div className="log-macros">
        <Macro label="Cal" value={cal} />
        <Macro label="P" value={Math.round(food.perServing.protein * qty)} unit="g" />
        <Macro label="C" value={Math.round(food.perServing.carbs * qty)} unit="g" />
        <Macro label="F" value={Math.round(food.perServing.fat * qty)} unit="g" />
      </div>

      <label className="field">
        <span>Servings ({food.servingSize})</span>
        <div className="qty-stepper">
          <button className="step" onClick={() => setQty((q) => Math.max(0.25, Math.round((q - 0.25) * 4) / 4))}>
            −
          </button>
          <input
            className="qty-input"
            type="number"
            step="0.25"
            min="0.25"
            value={qty}
            onChange={(e) => setQty(Math.max(0.25, Number(e.target.value) || 0.25))}
          />
          <button className="step" onClick={() => setQty((q) => Math.round((q + 0.25) * 4) / 4)}>
            +
          </button>
        </div>
      </label>

      <label className="field">
        <span>Meal</span>
        <MealPicker meal={meal} onChange={setMeal} />
      </label>

      <button className="btn primary block" disabled={busy} onClick={log}>
        {busy ? "Adding…" : `Add to ${MEAL_LABELS[meal]}`}
      </button>
    </div>
  );
}

function MealPicker({ meal, onChange }: { meal: MealType; onChange: (m: MealType) => void }) {
  return (
    <select className="select" value={meal} onChange={(e) => onChange(e.target.value as MealType)}>
      {MEAL_TYPES.map((m) => (
        <option key={m} value={m}>
          {MEAL_LABELS[m]}
        </option>
      ))}
    </select>
  );
}

function Macro({ label, value, unit }: { label: string; value: number; unit?: string }) {
  return (
    <div className="macro-pill">
      <div className="macro-pill-value">
        {value}
        {unit ?? ""}
      </div>
      <div className="macro-pill-label">{label}</div>
    </div>
  );
}

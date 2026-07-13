import { useEffect, useRef, useState } from "react";
import type { FoodItem, MealType } from "../types";
import { MEAL_LABELS, MEAL_TYPES } from "../types";
import { getRepository } from "../data/repository";
import { searchFoods, lookupBarcode } from "../features/foods/foodSearch";
import { parseMeal } from "../features/naturalLanguage";
import { isValidBarcode } from "../features/barcode";
import { listRecipes, markCooked, type ListedRecipe } from "../bridge/recipeBridge";
import { BarcodeScanner } from "../components/BarcodeScanner";
import { NutritionLabelCapture } from "../components/NutritionLabelCapture";
import { FrontOfPackageCapture } from "../components/FrontOfPackageCapture";
import { EditableNutritionPreview } from "../components/EditableNutritionPreview";
import {
  ChevronLeft,
  ChevronRight,
  NutritionPanelIcon,
  PackageIcon,
  SearchIcon,
} from "../components/icons";

type Mode = "search" | "scan" | "describe" | "recipes";

interface Props {
  date: string;
  defaultMeal: MealType;
  /** Which input mode to open on. Defaults to "search". */
  defaultMode?: Mode;
  onLogged: () => void;
  onCancel: () => void;
}

export function AddFoodScreen({ date, defaultMeal, defaultMode = "search", onLogged, onCancel }: Props) {
  const [mode, setMode] = useState<Mode>(defaultMode);
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
        <div className="segmented" role="tablist">
          {(["search", "scan", "describe", "recipes"] as Mode[]).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              className={`segmented-btn${mode === m ? " active" : ""}`}
              onClick={() => setMode(m)}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
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

const MIN_SEARCH_CHARS = 3;
const SEARCH_DEBOUNCE_MS = 250;

function SearchMode({ onPick }: { onPick: (food: FoodItem) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoodItem[]>([]);
  const [searching, setSearching] = useState(false);

  const trimmed = query.trim();
  const ready = trimmed.length >= MIN_SEARCH_CHARS;

  useEffect(() => {
    // Below the threshold (including after a backspace) reset to a clean slate.
    if (!ready) {
      setResults([]);
      setSearching(false);
      return;
    }
    // Every keystroke shows activity immediately so typing feels responsive,
    // then waits out the debounce before hitting the network.
    setSearching(true);
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const found = await searchFoods(trimmed, 20, controller.signal);
        if (!controller.signal.aborted) {
          setResults(found);
          setSearching(false);
        }
      } catch {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    // Cleanup runs on the next keystroke: cancel the in-flight fetch AND the
    // not-yet-fired debounced search so only the latest query ever lands.
    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [trimmed, ready]);

  return (
    <div className="mode-body">
      <div className={`search-field${searching ? " searching" : ""}`}>
        <SearchIcon size={18} className="search-field-icon" />
        <input
          className="text-input"
          placeholder="Search foods (e.g. greek yogurt)"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
        />
        {searching && <span className="search-field-spinner" aria-label="Searching" />}
      </div>
      {searching && <div className="muted small">Searching Open Food Facts + USDA…</div>}
      <FoodResultList
        foods={results}
        onPick={onPick}
        emptyHint={
          ready
            ? searching
              ? "Searching…"
              : "No matches — try a simpler term."
            : `Type at least ${MIN_SEARCH_CHARS} letters to search.`
        }
      />
    </div>
  );
}

// ── Scan ───────────────────────────────────────────────────────────────

type CaptureMode = "label" | "front" | null;

interface PendingPreview {
  food: FoodItem;
  source: "ai_label" | "ai_front";
  confidence: number;
  warningNote?: string;
}

function ScanMode({ onPick }: { onPick: (food: FoodItem) => void }) {
  const [manual, setManual] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [missedBarcode, setMissedBarcode] = useState<string | null>(null);
  const [capture, setCapture] = useState<CaptureMode>(null);
  const [pendingPreview, setPendingPreview] = useState<PendingPreview | null>(null);
  const busy = useRef(false);

  const resolve = async (barcode: string) => {
    if (busy.current) return;
    busy.current = true;
    setStatus(`Looking up ${barcode}…`);
    try {
      const food = await lookupBarcode(barcode);
      if (food) {
        onPick(food);
      } else {
        setStatus(null);
        setMissedBarcode(barcode);
      }
    } finally {
      busy.current = false;
    }
  };

  if (pendingPreview) {
    return (
      <EditableNutritionPreview
        initial={pendingPreview.food}
        source={pendingPreview.source}
        aiConfidence={pendingPreview.confidence}
        warningNote={pendingPreview.warningNote}
        onConfirm={(food) => {
          setPendingPreview(null);
          setCapture(null);
          setMissedBarcode(null);
          onPick(food);
        }}
        onCancel={() => setPendingPreview(null)}
      />
    );
  }

  if (capture === "label") {
    return (
      <NutritionLabelCapture
        barcode={missedBarcode ?? undefined}
        onParsed={(food, confidence) =>
          setPendingPreview({ food, source: "ai_label", confidence })
        }
        onCancel={() => setCapture(null)}
      />
    );
  }

  if (capture === "front") {
    return (
      <FrontOfPackageCapture
        barcode={missedBarcode ?? undefined}
        onParsed={(est) =>
          setPendingPreview({
            food: est.food,
            source: "ai_front",
            confidence: est.confidence,
            warningNote: est.warningNote,
          })
        }
        onCancel={() => setCapture(null)}
      />
    );
  }

  if (missedBarcode) {
    return (
      <div className="mode-body snap-miss">
        <div className="snap-miss-barcode-row">
          <span className="chip muted">No match</span>
          <span className="muted small">{missedBarcode}</span>
        </div>
        <div className="snap-miss-copy">
          <div>We don't have this one yet. Help us teach Conjure.</div>
          <div className="muted small">
            We checked our database and Open Food Facts. Snap a photo and we'll do the rest.
          </div>
        </div>

        <button
          className="snap-cta-card primary"
          onClick={() => setCapture("label")}
          aria-label="Snap the nutrition label, recommended for best accuracy"
        >
          <span className="snap-cta-icon">
            <NutritionPanelIcon size={28} />
          </span>
          <span className="snap-cta-text">
            <span className="snap-cta-title">Snap the nutrition label</span>
            <span className="snap-cta-sub">Best accuracy. Reads the panel directly.</span>
          </span>
          <ChevronRight size={20} />
          <span className="snap-cta-pill">Recommended</span>
        </button>

        <button className="snap-cta-card secondary" onClick={() => setCapture("front")}>
          <span className="snap-cta-icon">
            <PackageIcon size={28} />
          </span>
          <span className="snap-cta-text">
            <span className="snap-cta-title">Snap the front of the package</span>
            <span className="snap-cta-sub">
              For produce, beer, or anything without a label. We'll estimate.
            </span>
          </span>
          <ChevronRight size={20} />
        </button>

        <button
          className="link-btn"
          onClick={() => {
            setMissedBarcode(null);
            setManual("");
          }}
        >
          Try another barcode
        </button>
      </div>
    );
  }

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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const parse = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    setItems(null);
    try {
      setItems(await parseMeal({ text }));
    } catch {
      setError("Couldn’t reach the estimator. Check your connection and try again.");
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

      {error && <div className="notice notice-error">{error}</div>}

      {items && items.length === 0 && !error && (
        <div className="notice">
          No foods recognized in that description. Try naming the dishes, e.g. “turkey sandwich and an apple.”
        </div>
      )}

      {items && items.length > 0 && (
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
          <button className="btn primary block" onClick={logAll}>
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
      <button className="link-btn back-link" onClick={onBack}>
        <ChevronLeft size={16} /> Back
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

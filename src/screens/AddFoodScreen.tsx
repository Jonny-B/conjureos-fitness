import { useEffect, useRef, useState } from "react";
import type { ChatImage } from "../bridge/ai";
import type { FoodItem, MealType } from "../types";
import { MEAL_LABELS, MEAL_TYPES } from "../types";
import { getRepository } from "../data/repository";
import { searchFoods, lookupBarcode } from "../features/foods/foodSearch";
import { parseMeal } from "../features/naturalLanguage";
import { recentFoodsForMeal, type RecentFood } from "../features/recentFoods";
import { isValidBarcode } from "../features/barcode";
import { useScrollLock } from "../hooks/useScrollLock";
import {
  listRecipes,
  markCooked,
  getResolvedRecipeProviderName,
  type ListedRecipe,
} from "../bridge/recipeBridge";
import { BarcodeScanner } from "../components/BarcodeScanner";
import { CameraCapture } from "../components/CameraCapture";
import { NutritionLabelCapture } from "../components/NutritionLabelCapture";
import { FrontOfPackageCapture } from "../components/FrontOfPackageCapture";
import { EditableNutritionPreview } from "../components/EditableNutritionPreview";
import {
  BarcodeIcon,
  ChevronLeft,
  ChevronRight,
  DiamondIcon,
  EditIcon,
  NutritionPanelIcon,
  PackageIcon,
  SearchIcon,
  TrashIcon,
} from "../components/icons";

/** The three logging surfaces, each reached directly from a meal's buttons. */
export type AddMode = "search" | "scan" | "ai";

interface PickOpts {
  recipeSlug?: string;
  /** Preset the serving stepper (used when re-logging a recent saved item). */
  initialQty?: number;
}

interface Props {
  date: string;
  defaultMeal: MealType;
  /** Which surface to open on. */
  defaultMode?: AddMode;
  onLogged: () => void;
  onCancel: () => void;
  /** Fired when the user switches input mode inside the screen, so the shell
   *  header can track it (Scan Barcode / Search / AI). */
  onModeChange?: (mode: AddMode) => void;
}

const MODE_TABS: { mode: AddMode; label: string; Icon: typeof SearchIcon }[] = [
  { mode: "scan", label: "Scan", Icon: BarcodeIcon },
  { mode: "search", label: "Search", Icon: SearchIcon },
  { mode: "ai", label: "AI", Icon: DiamondIcon },
];

export function AddFoodScreen({
  date,
  defaultMeal,
  defaultMode = "search",
  onLogged,
  onModeChange,
}: Props) {
  const [selected, setSelected] = useState<{
    food: FoodItem;
    recipeSlug?: string;
    initialQty?: number;
  } | null>(null);
  // Mode + meal are switchable in-place, so the Add flow works meal-agnostically
  // (e.g. opened from the tab bar, not just a meal's button) and lets the user
  // change either without backing out.
  const [mode, setMode] = useState<AddMode>(defaultMode);
  const [meal, setMeal] = useState<MealType>(defaultMeal);

  const changeMode = (m: AddMode) => {
    setMode(m);
    onModeChange?.(m);
  };

  const pick = (food: FoodItem, opts?: PickOpts) =>
    setSelected({ food, recipeSlug: opts?.recipeSlug, initialQty: opts?.initialQty });

  if (selected) {
    return (
      <LogPanel
        food={selected.food}
        recipeSlug={selected.recipeSlug}
        initialQty={selected.initialQty ?? 1}
        date={date}
        defaultMeal={meal}
        onLogged={onLogged}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <div className="add">
      <div className="add-toolbar">
        <div className="mode-switch" role="tablist" aria-label="Add method">
          {MODE_TABS.map(({ mode: m, label, Icon }) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              className={`mode-tab${mode === m ? " active" : ""}`}
              onClick={() => changeMode(m)}
            >
              <Icon size={17} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <label className="add-meal-select">
          <span className="add-meal-label">Meal</span>
          <MealPicker meal={meal} onChange={setMeal} />
        </label>
      </div>

      {mode === "search" && <SearchMode meal={meal} onPick={pick} />}
      {mode === "scan" && <ScanMode onPick={(food) => pick(food)} />}
      {mode === "ai" && <AiMode date={date} defaultMeal={meal} onLogged={onLogged} />}
    </div>
  );
}

// ── Search ─────────────────────────────────────────────────────────────

const MIN_SEARCH_CHARS = 3;
const SEARCH_DEBOUNCE_MS = 250;

function SearchMode({ meal, onPick }: { meal: MealType; onPick: (food: FoodItem, opts?: PickOpts) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoodItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [recents, setRecents] = useState<RecentFood[]>([]);
  const [recipes, setRecipes] = useState<{ recipe: ListedRecipe; provider: string }[]>([]);

  const trimmed = query.trim();
  const ready = trimmed.length >= MIN_SEARCH_CHARS;

  // Meal-scoped recent saved items, shown as the empty-state suggestion list.
  useEffect(() => {
    let alive = true;
    recentFoodsForMeal(meal)
      .then((r) => {
        if (alive) setRecents(r);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [meal]);

  useEffect(() => {
    if (!ready) {
      setResults([]);
      setRecipes([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        // Paint each provider's hits as they land so a fast USDA response shows
        // immediately instead of waiting on a slow Open Food Facts request.
        const found = await searchFoods(trimmed, 20, controller.signal, (partial) => {
          if (!controller.signal.aborted) setResults(partial);
        });
        if (!controller.signal.aborted) {
          setResults(found);
          setSearching(false);
        }
      } catch {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [trimmed, ready]);

  // "Search your other apps" — providers only expose list-all and may ignore
  // the filter, so we client-filter by title. Feature-detects: no provider →
  // empty, section hidden.
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    listRecipes(trimmed)
      .then((all) => {
        if (!alive) return;
        const q = trimmed.toLowerCase();
        const provider = getResolvedRecipeProviderName() ?? "Recipes";
        const hits = all
          .filter((r) => r.title.toLowerCase().includes(q))
          .slice(0, 20)
          .map((recipe) => ({ recipe, provider }));
        setRecipes(hits);
      })
      .catch(() => {
        if (alive) setRecipes([]);
      });
    return () => {
      alive = false;
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

      {!ready ? (
        recents.length > 0 ? (
          <>
            <div className="section-label">Recent in {MEAL_LABELS[meal]}</div>
            <ul className="food-results">
              {recents.map((r, i) => (
                <li key={`recent-${i}`}>
                  <button
                    className="food-result"
                    onClick={() => onPick(r.food, { initialQty: r.quantity })}
                  >
                    <div className="entry-main">
                      <div className="entry-name">{r.food.name}</div>
                      <div className="entry-sub">
                        {r.quantity}× {r.food.servingSize}
                        {r.food.brand ? ` · ${r.food.brand}` : ""}
                      </div>
                    </div>
                    <div className="entry-cal">{Math.round(r.food.perServing.calories * r.quantity)}</div>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="muted small">Type at least {MIN_SEARCH_CHARS} letters to search.</div>
        )
      ) : (
        <>
          {searching && <div className="muted small">Searching Open Food Facts + USDA…</div>}
          <FoodResultList
            foods={results}
            onPick={onPick}
            emptyHint={searching ? "Searching…" : "No matches — try a simpler term."}
          />
          {recipes.length > 0 && (
            <>
              <div className="section-label">From your apps</div>
              <ul className="food-results">
                {recipes.map(({ recipe: r, provider }) => {
                  const n = r.nutrition;
                  return (
                    <li key={`recipe-${r.slug}`}>
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
                              perServing: {
                                calories: n.calories,
                                protein: n.protein,
                                carbs: n.carbs,
                                fat: n.fat,
                              },
                              servingSize: "1 serving",
                            },
                            { recipeSlug: r.slug },
                          )
                        }
                      >
                        <div className="entry-main">
                          <div className="entry-name-row">
                            <span className="entry-name">{r.title}</span>
                            <span className="app-pill" title={`From ${provider}`}>
                              <DiamondIcon size={11} className="app-pill-icon" />
                              {provider}
                            </span>
                          </div>
                          <div className="entry-sub">
                            {n ? `~${n.calories} cal · ${n.protein}g P` : "no nutrition data"}
                          </div>
                        </div>
                        <div className="entry-cal">{n?.calories ?? "–"}</div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Scan (barcode) ───────────────────────────────────────────────────────

type CaptureMode = "label" | "front" | null;

interface PendingPreview {
  food: FoodItem;
  source: "ai_label" | "ai_front";
  confidence: number;
  warningNote?: string;
}

function ScanMode({ onPick }: { onPick: (food: FoodItem) => void }) {
  const [manual, setManual] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [missedBarcode, setMissedBarcode] = useState<string | null>(null);
  // "choose" = user opened the photo fallback themselves (no barcode miss).
  const [capture, setCapture] = useState<CaptureMode | "choose">(null);
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
        onParsed={(food, confidence) => setPendingPreview({ food, source: "ai_label", confidence })}
        onCancel={() => setCapture(missedBarcode ? "choose" : null)}
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
        onCancel={() => setCapture(missedBarcode ? "choose" : null)}
      />
    );
  }

  // Photo chooser — reached either from a barcode miss or from the "snap a
  // photo" shortcut on the scanner. Same two paths, framed by context.
  if (capture === "choose" || missedBarcode) {
    return (
      <div className="mode-body snap-miss">
        {missedBarcode ? (
          <>
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
          </>
        ) : (
          <div className="snap-miss-copy">
            <div>Scan it from a photo</div>
            <div className="muted small">
              No barcode, or it won't read? Snap the label or the package and we'll log it.
            </div>
          </div>
        )}

        <PhotoChoiceCards onLabel={() => setCapture("label")} onFront={() => setCapture("front")} />

        <button
          className="link-btn"
          onClick={() => {
            setCapture(null);
            setMissedBarcode(null);
            setManual("");
          }}
        >
          {missedBarcode ? "Try another barcode" : "Back to scanner"}
        </button>
      </div>
    );
  }

  return (
    <div className="mode-body scan-surface">
      <BarcodeScanner
        onDetected={resolve}
        onError={(m) => setStatus(m)}
        onEnterBarcode={() => setManualOpen((v) => !v)}
        onSnapPhoto={() => setCapture("choose")}
      />
      {manualOpen && (
        <div className="manual-barcode">
          <input
            className="text-input"
            placeholder="Barcode number"
            inputMode="numeric"
            autoFocus
            value={manual}
            onChange={(e) => setManual(e.target.value)}
          />
          <button className="btn" disabled={!isValidBarcode(manual)} onClick={() => resolve(manual.replace(/\D/g, ""))}>
            Look up
          </button>
        </div>
      )}
      {status && <div className="muted small">{status}</div>}
    </div>
  );
}

/** The two photo-capture paths, shared by the miss screen and the shortcut. */
function PhotoChoiceCards({ onLabel, onFront }: { onLabel: () => void; onFront: () => void }) {
  return (
    <>
      <button
        className="snap-cta-card primary"
        onClick={onLabel}
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

      <button className="snap-cta-card secondary" onClick={onFront}>
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
    </>
  );
}

// ── AI (photograph a meal / describe it) ─────────────────────────────────

type AiTab = "photo" | "text";

function AiMode({
  date,
  defaultMeal,
  onLogged,
}: {
  date: string;
  defaultMeal: MealType;
  onLogged: () => void;
}) {
  const [tab, setTab] = useState<AiTab>("photo");
  const [text, setText] = useState("");
  const [meal, setMeal] = useState<MealType>(defaultMeal);
  const [items, setItems] = useState<FoodItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shotUrl, setShotUrl] = useState<string | null>(null);
  // Index of the parsed item being edited inline, or null for the list view.
  const [editing, setEditing] = useState<number | null>(null);

  const removeItem = (i: number) =>
    setItems((prev) => (prev ? prev.filter((_, idx) => idx !== i) : prev));
  const replaceItem = (i: number, food: FoodItem) =>
    setItems((prev) => (prev ? prev.map((f, idx) => (idx === i ? food : f)) : prev));

  const run = async (input: { text?: string; image?: ChatImage }) => {
    setBusy(true);
    setError(null);
    setItems(null);
    try {
      setItems(await parseMeal(input));
    } catch {
      setError("Couldn’t reach the estimator. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const onCapture = (image: ChatImage, previewUrl: string) => {
    setShotUrl(previewUrl);
    run({ image });
  };

  const retake = () => {
    setShotUrl(null);
    setItems(null);
    setError(null);
    setEditing(null);
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
      <div className="segmented" role="tablist">
        {(["photo", "text"] as AiTab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`segmented-btn${tab === t ? " active" : ""}`}
            onClick={() => {
              setTab(t);
              retake();
            }}
          >
            {t === "photo" ? "Scan Food/Meal" : "Describe to AI"}
          </button>
        ))}
      </div>

      {tab === "photo" ? (
        shotUrl ? (
          <div className="ai-shot">
            <img className="ai-shot-img" src={shotUrl} alt="Your meal" />
            <button className="link-btn" onClick={retake}>
              Retake photo
            </button>
          </div>
        ) : (
          <CameraCapture
            guide="Point at your plate or the item and tap the shutter."
            onCapture={onCapture}
          />
        )
      ) : (
        <>
          <textarea
            className="text-area"
            rows={3}
            placeholder="Describe what you ate, e.g. 'chicken sandwich and a beer'"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="row gap">
            <MealPicker meal={meal} onChange={setMeal} />
            <button className="btn" disabled={busy || !text.trim()} onClick={() => run({ text })}>
              {busy ? "Estimating…" : "Estimate"}
            </button>
          </div>
        </>
      )}

      {busy && tab === "photo" && <div className="muted small">Reading your photo…</div>}
      {error && <div className="notice notice-error">{error}</div>}

      {items && items.length === 0 && !error && (
        <div className="notice">
          {tab === "photo"
            ? "No foods recognized in that photo. Try a clearer shot, or describe it instead."
            : "No foods recognized in that description. Try naming the dishes, e.g. “turkey sandwich and an apple.”"}
        </div>
      )}

      {items && items.length > 0 && (
        <>
          {tab === "photo" && (
            <label className="field">
              <span>Meal</span>
              <MealPicker meal={meal} onChange={setMeal} />
            </label>
          )}
          <div className="muted small">Estimates — tap an item to edit or delete what isn’t yours.</div>
          <ul className="parsed-list">
            {items.map((f, i) => (
              <li className="parsed editable" key={f.id}>
                <button className="parsed-main" onClick={() => setEditing(i)}>
                  <span className="entry-name">{f.name}</span>
                  <span className="entry-sub">
                    ~{f.perServing.calories} cal · {f.servingSize}
                  </span>
                </button>
                <button
                  className="parsed-edit icon-btn"
                  aria-label={`Edit ${f.name}`}
                  onClick={() => setEditing(i)}
                >
                  <EditIcon size={18} />
                </button>
              </li>
            ))}
          </ul>
          <button className="btn primary block" onClick={logAll}>
            Log {items.length} item{items.length === 1 ? "" : "s"} to {MEAL_LABELS[meal]}
          </button>
        </>
      )}

      {items && editing != null && items[editing] && (
        <MealItemEditor
          item={items[editing]!}
          onSave={(food) => {
            replaceItem(editing, food);
            setEditing(null);
          }}
          onDelete={() => {
            removeItem(editing);
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/** Modal editor for one AI-estimated meal item (name, serving, per-serving
 *  macros) on the review screen — matches the diary entry editor. Save updates
 *  the item; Delete removes it; both close the modal. */
function MealItemEditor({
  item,
  onSave,
  onDelete,
  onCancel,
}: {
  item: FoodItem;
  onSave: (food: FoodItem) => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(item.name);
  const [serving, setServing] = useState(item.servingSize);
  const [cal, setCal] = useState(item.perServing.calories);
  const [protein, setProtein] = useState(item.perServing.protein);
  const [carbs, setCarbs] = useState(item.perServing.carbs);
  const [fat, setFat] = useState(item.perServing.fat);
  useScrollLock();

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave({
      ...item,
      name: trimmed.slice(0, 80),
      servingSize: serving.trim() || item.servingSize,
      perServing: {
        calories: Math.max(0, Math.round(cal)),
        protein: Math.max(0, Math.round(protein)),
        carbs: Math.max(0, Math.round(carbs)),
        fat: Math.max(0, Math.round(fat)),
      },
    });
  };

  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <div className="sheet entry-edit" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h2>Edit item</h2>
          <button className="link-btn" onClick={onCancel}>
            Cancel
          </button>
        </header>
        <div className="sheet-body">
          <label className="field">
            <span>Name</span>
            <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Food name" />
          </label>
          <label className="field">
            <span>Serving</span>
            <input
              className="text-input"
              value={serving}
              onChange={(e) => setServing(e.target.value)}
              placeholder="e.g. 1 cup (240 g)"
            />
          </label>
          <div className="macros-edit-row">
            <NumBox label="Calories" value={cal} onChange={setCal} />
            <NumBox label="Protein (g)" value={protein} onChange={setProtein} />
            <NumBox label="Carbs (g)" value={carbs} onChange={setCarbs} />
            <NumBox label="Fat (g)" value={fat} onChange={setFat} />
          </div>
          <div className="muted small">Macros are per one serving.</div>
        </div>
        <footer className="sheet-foot entry-edit-foot">
          <button className="btn danger" onClick={onDelete}>
            <TrashIcon size={16} /> Delete
          </button>
          <button className="btn primary" disabled={name.trim().length < 1} onClick={save}>
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}

function NumBox({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="macro-edit plain">
      <span className="macro-edit-label">{label}</span>
      <input
        className="macro-edit-input"
        aria-label={label}
        inputMode="decimal"
        type="text"
        value={value === 0 ? "" : String(value)}
        placeholder="0"
        onChange={(e) => onChange(Number(e.target.value.replace(/[^0-9.]/g, "")) || 0)}
      />
    </label>
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
  initialQty,
  date,
  defaultMeal,
  onLogged,
  onBack,
}: {
  food: FoodItem;
  recipeSlug?: string;
  initialQty: number;
  date: string;
  defaultMeal: MealType;
  onLogged: () => void;
  onBack: () => void;
}) {
  const [qty, setQty] = useState(initialQty);
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

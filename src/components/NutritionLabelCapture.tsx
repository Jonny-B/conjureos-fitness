import { useState } from "react";
import { parseNutritionLabel } from "../features/foods/labelParse";
import type { FoodItem } from "../types";
import type { ChatImage } from "../bridge/ai";
import { ChevronLeft } from "./icons";

/**
 * Snap-the-label fallback when a barcode misses Open Food Facts / USDA.
 *
 * Flow: user picks (or snaps) a nutrition-label photo with the rear camera,
 * the photo is sent to the AI bridge for per-serving extraction, and the
 * parsed FoodItem is handed up so the existing LogPanel renders + saves it.
 *
 * Uses <input type="file" accept="image/*" capture="environment"> so it works
 * on every modern phone browser without a separate camera API and falls back
 * to a normal file picker on desktop.
 */
export function NutritionLabelCapture({
  barcode,
  onParsed,
  onCancel,
}: {
  barcode?: string;
  onParsed: (food: FoodItem) => void;
  onCancel: () => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [image, setImage] = useState<ChatImage | null>(null);
  const [status, setStatus] = useState<"idle" | "parsing" | "error" | "low-confidence">("idle");
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    if (!isAcceptedImage(file)) {
      setError("That file doesn't look like a photo. Try again with a clear shot of the label.");
      setStatus("error");
      return;
    }
    const blobUrl = URL.createObjectURL(file);
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return blobUrl;
    });
    try {
      const chatImage = await fileToChatImage(file);
      setImage(chatImage);
      setStatus("idle");
      setError(null);
    } catch {
      setError("Couldn't read that photo. Try again.");
      setStatus("error");
    }
  };

  const parse = async () => {
    if (!image) return;
    setStatus("parsing");
    setError(null);
    try {
      const result = await parseNutritionLabel(image, barcode);
      if (!result) {
        setStatus("low-confidence");
        return;
      }
      onParsed(result.food);
    } catch {
      setError("The estimator didn't respond. Check your connection and try again.");
      setStatus("error");
    }
  };

  return (
    <div className="label-capture mode-body">
      <button className="link-btn back-link" onClick={onCancel}>
        <ChevronLeft size={16} /> Back
      </button>

      {!preview && (
        <>
          <div className="muted small">
            {barcode
              ? `We don't have ${barcode} yet. Snap the nutrition-facts panel and we'll log it from the photo.`
              : "Snap the nutrition-facts panel and we'll log it from the photo."}
          </div>
          <label className="btn primary block label-capture-cta">
            Snap the nutrition label
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              className="visually-hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </label>
          <div className="muted small">
            Tip: hold the package flat, fill the frame with just the nutrition panel, and avoid glare.
          </div>
        </>
      )}

      {preview && (
        <>
          <img className="label-capture-preview" src={preview} alt="Nutrition label preview" />
          <div className="row gap">
            <label className="btn">
              Retake
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                className="visually-hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </label>
            <button
              className="btn primary"
              disabled={!image || status === "parsing"}
              onClick={parse}
            >
              {status === "parsing" ? "Reading the label…" : "Read the label"}
            </button>
          </div>
        </>
      )}

      {error && <div className="notice notice-error">{error}</div>}
      {status === "low-confidence" && !error && (
        <div className="notice">
          Couldn't read the macros confidently from that photo. Try a tighter shot with the
          nutrition panel filling the frame, or use Describe to type what you ate.
        </div>
      )}
    </div>
  );
}

const ACCEPTED_MIMES: ReadonlyArray<ChatImage["mediaType"]> = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

function isAcceptedImage(file: File): file is File {
  return ACCEPTED_MIMES.includes(file.type as ChatImage["mediaType"]);
}

async function fileToChatImage(file: File): Promise<ChatImage> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // Stream-encode to base64 to avoid choking on large photos via apply(stack overflow).
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return {
    mediaType: file.type as ChatImage["mediaType"],
    data: btoa(binary),
  };
}

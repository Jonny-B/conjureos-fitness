import { useState } from "react";
import { parseNutritionLabel } from "../features/foods/labelParse";
import type { FoodItem } from "../types";
import type { ChatImage } from "../bridge/ai";
import { CameraCapture } from "./CameraCapture";
import { ChevronLeft } from "./icons";

/**
 * Snap-the-label fallback when a barcode misses Open Food Facts / USDA.
 *
 * Flow: user frames the nutrition-facts panel in the in-app camera
 * (CameraCapture — no jarring OS-camera takeover), the still is sent to the AI
 * bridge for per-serving extraction, and the parsed FoodItem is handed up so
 * the existing LogPanel renders + saves it.
 */
export function NutritionLabelCapture({
  barcode,
  onParsed,
  onCancel,
}: {
  barcode?: string;
  onParsed: (food: FoodItem, confidence: number) => void;
  onCancel: () => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [image, setImage] = useState<ChatImage | null>(null);
  const [status, setStatus] = useState<"idle" | "parsing" | "error" | "low-confidence">("idle");
  const [error, setError] = useState<string | null>(null);

  const onCaptured = (chatImage: ChatImage, url: string) => {
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
    setImage(chatImage);
    setStatus("idle");
    setError(null);
  };

  const retake = () => {
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setImage(null);
    setStatus("idle");
    setError(null);
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
      onParsed(result.food, result.confidence);
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
              ? `We don't have ${barcode} yet. Frame the nutrition-facts panel and we'll log it from the photo.`
              : "Frame the nutrition-facts panel and we'll log it from the photo."}
          </div>
          <CameraCapture
            guide="Hold the package flat, fill the frame with just the nutrition panel, and avoid glare."
            onCapture={onCaptured}
          />
        </>
      )}

      {preview && (
        <>
          <img className="label-capture-preview" src={preview} alt="Nutrition label preview" />
          <div className="row gap">
            <button className="btn" onClick={retake}>
              Retake
            </button>
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
          nutrition panel filling the frame, or use Describe to AI to type what you ate.
        </div>
      )}
    </div>
  );
}

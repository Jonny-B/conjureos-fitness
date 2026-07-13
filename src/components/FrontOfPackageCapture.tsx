/**
 * Sibling of NutritionLabelCapture: frames the front of a package in the in-app
 * camera (CameraCapture — no OS-camera takeover), shows a preview, runs
 * frontParse.estimateFromFront, and hands the result up. Same staged UX
 * (framing guidance, preview, parsing), different copy + system prompt + lower
 * confidence floor.
 */

import { useState } from "react";
import type { ChatImage } from "../bridge/ai";
import { estimateFromFront, type FrontEstimate } from "../features/foods/frontParse";
import { CameraCapture } from "./CameraCapture";
import { ChevronLeft } from "./icons";

interface Props {
  barcode?: string;
  onParsed: (estimate: FrontEstimate) => void;
  onCancel: () => void;
}

type Phase = "capture" | "preview" | "parsing" | "failed";

export function FrontOfPackageCapture({ barcode, onParsed, onCancel }: Props) {
  const [phase, setPhase] = useState<Phase>("capture");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [image, setImage] = useState<ChatImage | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const onCaptured = (chatImage: ChatImage, url: string) => {
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
    setImage(chatImage);
    setPhase("preview");
  };

  const retake = () => {
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setImage(null);
    setPhase("capture");
  };

  const onEstimate = async () => {
    if (!image) return;
    setPhase("parsing");
    setErrorMsg(null);
    const res = await estimateFromFront(image, barcode);
    if (!res) {
      setErrorMsg(
        "We couldn't identify this confidently. Retake with the brand and product name fully in frame, or fill in the form by hand.",
      );
      setPhase("failed");
      return;
    }
    onParsed(res);
  };

  return (
    <div className="mode-body">
      <button className="link-btn back-link" onClick={onCancel}>
        <ChevronLeft size={16} /> Back
      </button>

      {phase === "capture" && (
        <CameraCapture
          guide="Hold the front of the package flat in good light, with the brand and product name in frame. Works for beer, produce, foreign packages — anything without a label."
          onCapture={onCaptured}
        />
      )}

      {phase === "preview" && previewUrl && (
        <>
          <div className="label-capture-preview-wrap">
            <img className="label-capture-preview" src={previewUrl} alt="Front of package preview" />
          </div>
          <div className="row gap">
            <button className="btn" onClick={retake}>
              Retake
            </button>
            <button className="btn primary" onClick={onEstimate}>
              Estimate macros
            </button>
          </div>
          <div className="muted small">
            We will guess based on what we can see. You will review every number before saving.
          </div>
        </>
      )}

      {phase === "parsing" && (
        <div className="snap-busy">
          {previewUrl && (
            <div className="label-capture-preview-wrap dimmed">
              <img className="label-capture-preview" src={previewUrl} alt="Estimating" />
            </div>
          )}
          <div className="snap-spinner" aria-hidden />
          <div className="snap-busy-caption">Estimating from the photo…</div>
          <div className="snap-busy-sub">Usually takes about six seconds.</div>
        </div>
      )}

      {phase === "failed" && (
        <>
          {errorMsg && <div className="notice notice-error">{errorMsg}</div>}
          <button className="btn primary block" onClick={() => setPhase("capture")}>
            Retake
          </button>
          <button className="link-btn" onClick={onCancel}>
            Cancel
          </button>
        </>
      )}
    </div>
  );
}

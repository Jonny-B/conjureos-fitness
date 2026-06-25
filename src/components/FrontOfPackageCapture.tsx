/**
 * Sibling of NutritionLabelCapture: opens the device camera (or library
 * picker), shows a preview, runs frontParse.estimateFromFront, and hands the
 * result up. Same three-stage UX (frame guidance, preview, parsing),
 * different copy + system prompt + lower confidence floor.
 */

import { useRef, useState } from "react";
import type { ChatImage } from "../bridge/ai";
import { estimateFromFront, type FrontEstimate } from "../features/foods/frontParse";
import { ChevronLeft, PackageIcon } from "./icons";

interface Props {
  barcode?: string;
  onParsed: (estimate: FrontEstimate) => void;
  onCancel: () => void;
}

type Phase = "capture" | "preview" | "parsing" | "failed";

async function fileToChatImage(file: File): Promise<ChatImage> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
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

export function FrontOfPackageCapture({ barcode, onParsed, onCancel }: Props) {
  const [phase, setPhase] = useState<Phase>("capture");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [image, setImage] = useState<ChatImage | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
    try {
      setImage(await fileToChatImage(file));
      setPhase("preview");
    } catch {
      setErrorMsg("Couldn't read that photo. Try again.");
      setPhase("failed");
    }
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
        <>
          <div className="snap-frame-hint">
            <PackageIcon size={36} />
            <div>
              <div>Hold the front of the package flat in good light. Include the brand and product name.</div>
              <div className="muted small">
                Works for beer, produce, foreign packages: anything without a label.
              </div>
            </div>
          </div>
          <button
            className="btn primary block"
            onClick={() => inputRef.current?.click()}
          >
            Open camera
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            hidden
            onChange={onPick}
          />
        </>
      )}

      {phase === "preview" && previewUrl && (
        <>
          <div className="label-capture-preview-wrap">
            <img className="label-capture-preview" src={previewUrl} alt="Front of package preview" />
          </div>
          <div className="row gap">
            <button
              className="btn"
              onClick={() => {
                setPhase("capture");
                setImage(null);
                if (previewUrl) URL.revokeObjectURL(previewUrl);
                setPreviewUrl(null);
              }}
            >
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

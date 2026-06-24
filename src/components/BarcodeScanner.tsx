import { useEffect, useRef, useState } from "react";
import { isScanSupported, scanFromVideo } from "../features/barcode";

/**
 * Live camera barcode scanner. Streams the rear camera into a <video> and
 * polls `BarcodeDetector` until a code is read, then calls `onDetected`.
 * Renders a clear unsupported/denied state so the parent can offer manual
 * entry (iOS Safari / Firefox have no BarcodeDetector).
 */
export function BarcodeScanner({
  onDetected,
  onError,
}: {
  onDetected: (barcode: string) => void;
  onError?: (message: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"starting" | "scanning" | "unsupported" | "error">(
    isScanSupported() ? "starting" : "unsupported",
  );

  useEffect(() => {
    if (!isScanSupported()) return;
    const controller = new AbortController();
    let stream: MediaStream | null = null;

    // Warm the WASM engine in parallel with getUserMedia. On WebKit the
    // polyfill lazy-fetches a ~1 MiB wasm blob on first detect(); kicking it
    // off here hides the 200 to 800 ms stall behind the camera-permission
    // dialog. Errors are intentionally swallowed: this is best-effort.
    try {
      const warmCanvas = document.createElement("canvas");
      warmCanvas.width = 1;
      warmCanvas.height = 1;
      const Ctor = (globalThis as { BarcodeDetector?: new () => { detect: (s: CanvasImageSource) => Promise<unknown> } }).BarcodeDetector;
      if (Ctor) new Ctor().detect(warmCanvas).catch(() => {});
    } catch {
      /* best-effort warm-up */
    }

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        const video = videoRef.current;
        if (!video || controller.signal.aborted) return;
        video.srcObject = stream;
        await video.play();
        setStatus("scanning");
        const code = await scanFromVideo(video, { signal: controller.signal, timeoutMs: 60_000 });
        if (code && !controller.signal.aborted) onDetected(code);
      } catch (err) {
        if (!controller.signal.aborted) {
          setStatus("error");
          onError?.(err instanceof Error ? err.message : "Camera unavailable");
        }
      }
    })();

    return () => {
      controller.abort();
      stream?.getTracks().forEach((t) => t.stop());
    };
    // onDetected/onError are stable enough for this one-shot scan session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === "unsupported") {
    return (
      <div className="scanner-fallback">
        Live scanning isn’t supported in this browser. Enter the barcode number below.
      </div>
    );
  }
  if (status === "error") {
    return <div className="scanner-fallback">Couldn’t open the camera. Enter the barcode below.</div>;
  }

  return (
    <div className="scanner">
      <video ref={videoRef} className="scanner-video" muted playsInline />
      <div className="scanner-reticle" aria-hidden />
      <div className="scanner-hint">{status === "starting" ? "Starting camera…" : "Point at a barcode"}</div>
    </div>
  );
}

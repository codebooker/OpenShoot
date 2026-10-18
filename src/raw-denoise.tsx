import React, { useEffect, useRef, useState } from "react";
import { Sparkles, Download, FolderOpen, RefreshCw } from "lucide-react";
import type { Edits, Photo, RawStatus } from "./types";
export function RawDenoise({
  photo,
  albumId,
  edits,
  onChange,
  onBusy,
}: {
  photo: Photo;
  albumId: string;
  edits: Edits;
  onChange: (e: Edits) => void;
  onBusy?: (busy: boolean) => void;
}) {
  const [status, setStatus] = useState<RawStatus | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const alive = useRef(true),
    amount = useRef(edits.aiDenoise || 50);
  useEffect(() => {
    alive.current = true;
    window.openshoot
      .rawStatus()
      .then((s) => {
        if (alive.current) setStatus(s);
      })
      .catch((e) => {
        if (alive.current) setError(e.message);
      });
    return () => {
      alive.current = false;
    };
  }, []);
  const raw =
    /\.(cr3|cr2|crw|nef|nrw|arw|sr2|srf|raf|orf|rw2|raw|rwl|pef|srw|3fr|fff|iiq|mos|mef|mfw|mrw|dcr|kdc|erf|gpr|dng)$/i.test(
      photo.name,
    );
  async function perform(action: "generate" | "install" | "download") {
    setBusy(true);
    setError("");
    onBusy?.(true);
    try {
      if (action === "generate") {
        const result = await window.openshoot.rawGenerate(albumId, photo.id);
        if (alive.current)
          onChange({
            ...edits,
            rawDenoiseKey: result.key,
            aiDenoise: amount.current,
          });
      } else {
        const s = await (action === "install"
          ? window.openshoot.rawInstall()
          : window.openshoot.rawDownload());
        if (alive.current && s) setStatus(s);
      }
      if (alive.current) setStatus(await window.openshoot.rawStatus());
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current) setBusy(false);
      onBusy?.(false);
    }
  }
  return (
    <div className="raw-denoise-card">
      <h4>
        <Sparkles size={13} />
        AI RAW denoise
      </h4>
      <p className="fine-print">
        Trained RawNIND model · processed locally on your Mac. Supports Bayer
        RAW; unsupported sensors report a clear error.
      </p>
      {!raw ? (
        <p className="fine-print">Choose a RAW photo to use AI denoise.</p>
      ) : !status ? (
        <p className="fine-print">Checking model…</p>
      ) : !status.available ? (
        <p role="alert" className="fine-print">
          Native denoise worker is unavailable. Install the latest OpenShoot
          build.
        </p>
      ) : !status.installed ? (
        <>
          <p className="fine-print">
            One-time model setup. RawNIND weights are GPL-3.0; the model is
            stored separately on this Mac.
          </p>
          <button
            className="full"
            disabled={busy}
            onClick={() => perform("download")}
          >
            <Download size={13} />
            Install model · 55 MB download
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => perform("install")}
          >
            <FolderOpen size={12} />
            Use existing model file…
          </button>
        </>
      ) : (
        <>
          {edits.rawDenoiseKey && (
            <>
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={(edits.aiDenoise || 0) > 0}
                  onChange={(e) =>
                    onChange({
                      ...edits,
                      aiDenoise: e.target.checked ? amount.current : 0,
                    })
                  }
                />
                Enable AI denoise
              </label>
              <label className="edit-control">
                <span>
                  Amount<b>{edits.aiDenoise || 0}</b>
                </span>
                <input
                  aria-label="AI denoise amount"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={edits.aiDenoise || 0}
                  onChange={(e) => {
                    amount.current = Number(e.target.value) || 50;
                    onChange({ ...edits, aiDenoise: Number(e.target.value) });
                  }}
                />
              </label>
            </>
          )}
          <button
            className="full"
            disabled={busy}
            onClick={() => perform("generate")}
          >
            <RefreshCw size={13} />
            {busy
              ? "Processing RAW…"
              : edits.rawDenoiseKey
                ? "Regenerate / load denoised RAW"
                : "Generate denoised RAW"}
          </button>
          <p className="fine-print">
            {status.device?.kind === "gpu"
              ? `GPU: ${status.device.adapter || "Metal"}`
              : status.device?.kind === "cpu"
                ? "Processor fallback · " +
                  (status.device.reason || "GPU unavailable")
                : "GPU acceleration is checked when the model runs."}
          </p>
          <p className="fine-print">
            Preview first, then Apply adjustments to save. JPEG exports use the
            same denoised source.
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="raw-denoise-error">
          {error}
        </p>
      )}
    </div>
  );
}

import React, { useState } from "react";
import { AdvancedEditor } from "./advanced-editor";
import {
  Sun,
  Contrast,
  Droplets,
  Thermometer,
  RotateCw,
  Check,
  Undo2,
} from "lucide-react";
import type { Photo, Edits, AdvancedKey } from "./types";
import { freshEdits } from "./types";
export function Editor({
  photo,
  albumId,
  onBusy,
  edits,
  onChange,
  onSave,
}: {
  photo: Photo;
  albumId?: string;
  onBusy?: (busy: boolean) => void;
  edits: Edits;
  onChange: (edits: Edits) => void;
  onSave: (e: Edits) => Promise<void>;
}) {
  const [advanced, setAdvanced] = useState(
    () => window.localStorage.getItem("openshoot-editor-mode") === "advanced",
  );
  const dirty = JSON.stringify(edits) !== JSON.stringify(photo.edits);
  const setEdits = (value: Edits | ((previous: Edits) => Edits)) =>
    onChange(typeof value === "function" ? value(edits) : value);
  const slider = (
    key: "exposure" | "contrast" | "saturation" | "temperature" | AdvancedKey,
    label: string,
    icon: React.ReactNode,
    min: number,
    max: number,
    step = 1,
  ) => (
    <label className="edit-control">
      <span>
        {icon}
        {label}
        <b>
          {(edits[key] ?? 0) > 0 ? "+" : ""}
          {(edits[key] ?? 0).toFixed(key === "exposure" ? 2 : 0)}
        </b>
      </span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={edits[key] ?? 0}
        onChange={(e) =>
          setEdits((v) => ({ ...v, [key]: Number(e.target.value) }))
        }
      />
    </label>
  );
  return (
    <>
      <div className="inspector-section">
        <div className="label">LOOKS</div>
        <div className="look-grid">
          {[
            { name: "Natural", edits: freshEdits() },
            {
              name: "Warm film",
              edits: {
                ...freshEdits(),
                temperature: 28,
                saturation: -12,
                contrast: 9,
              },
            },
            {
              name: "Crisp",
              edits: { ...freshEdits(), saturation: 10, contrast: 18 },
            },
            {
              name: "Monochrome",
              edits: { ...freshEdits(), monochrome: true, contrast: 15 },
            },
          ].map((look) => (
            <button key={look.name} onClick={() => setEdits(look.edits)}>
              {look.name}
            </button>
          ))}
        </div>
      </div>
      <div
        className="inspector-section editor-mode"
        role="group"
        aria-label="Editing mode"
      >
        {[false, true].map((v) => (
          <button
            key={String(v)}
            aria-pressed={advanced === v}
            className={advanced === v ? "active" : ""}
            onClick={() => {
              setAdvanced(v);
              window.localStorage.setItem(
                "openshoot-editor-mode",
                v ? "advanced" : "basic",
              );
            }}
          >
            {v ? "Advanced" : "Basic"}
          </button>
        ))}
      </div>
      {advanced ? (
        <AdvancedEditor
          photo={photo}
          albumId={albumId}
          onBusy={onBusy}
          edits={edits}
          onChange={onChange}
        />
      ) : (
        <div className="inspector-section">
          <div className="label">LIGHT & COLOR</div>
          {slider("exposure", "Exposure", <Sun size={13} />, -3, 3, 0.05)}
          {slider("contrast", "Contrast", <Contrast size={13} />, -100, 100)}
          {slider(
            "saturation",
            "Saturation",
            <Droplets size={13} />,
            -100,
            100,
          )}
          {slider(
            "temperature",
            "Warmth",
            <Thermometer size={13} />,
            -100,
            100,
          )}
          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={edits.monochrome}
              onChange={(e) =>
                setEdits((v) => ({ ...v, monochrome: e.target.checked }))
              }
            />{" "}
            Black & white
          </label>
        </div>
      )}
      <div className="inspector-section">
        <div className="label">COMPOSITION</div>
        <label className="field">
          Aspect ratio
          <select
            value={edits.crop}
            onChange={(e) =>
              setEdits((v) => ({
                ...v,
                crop: e.target.value,
                cropRect: undefined,
                cropRatio: undefined,
              }))
            }
          >
            {["original", "1:1", "4:5", "3:2", "16:9"].map((c) => (
              <option key={c} value={c}>
                {c === "original" ? "Original aspect ratio" : c}
              </option>
            ))}
          </select>
        </label>
        {edits.cropRect && (
          <>
            <p className="fine-print">
              {edits.cropRatio === "original"
                ? "Original ratio · AI reframe"
                : edits.cropRatio
                  ? `AI framing · ${edits.cropRatio}`
                  : "Custom framing"}{" "}
              · {Math.round(edits.cropRect.width * 100)}% ×{" "}
              {Math.round(edits.cropRect.height * 100)}% of full frame
            </p>
            {(["x", "y"] as const).map((axis) => (
              <label className="edit-control" key={axis}>
                <span>
                  {axis === "x"
                    ? "Crop horizontal position"
                    : "Crop vertical position"}
                </span>
                <input
                  aria-label={
                    axis === "x"
                      ? "Crop horizontal position"
                      : "Crop vertical position"
                  }
                  type="range"
                  min={0}
                  max={Math.max(
                    0,
                    1 - edits.cropRect![axis === "x" ? "width" : "height"],
                  )}
                  step={0.005}
                  value={edits.cropRect![axis]}
                  onChange={(e) =>
                    setEdits((v) => ({
                      ...v,
                      cropRect: {
                        ...v.cropRect!,
                        [axis]: Number(e.target.value),
                      },
                    }))
                  }
                />
              </label>
            ))}
            <button
              className="full"
              onClick={() =>
                setEdits((v) => ({
                  ...v,
                  crop: "original",
                  cropRect: undefined,
                  cropRatio: undefined,
                }))
              }
            >
              Remove crop
            </button>
          </>
        )}
        <button
          className="full"
          onClick={() =>
            setEdits((v) => ({ ...v, rotation: (v.rotation + 90) % 360 }))
          }
        >
          <RotateCw size={15} /> Rotate 90°{" "}
          <span className="muted">{edits.rotation}°</span>
        </button>
      </div>
      <div className="inspector-section">
        <button
          className="primary full"
          disabled={!dirty}
          onClick={() => onSave(edits)}
        >
          <Check size={15} /> Apply adjustments
        </button>
        <button
          className="text-button full reset"
          onClick={() => {
            const e = freshEdits();
            setEdits(e);
            onSave(e);
          }}
        >
          <Undo2 size={13} /> Reset adjustments
        </button>
        <p className="fine-print">
          Preview updates as you adjust. Apply saves your changes for JPEG
          exports. Originals stay unchanged.
        </p>
        {dirty && (
          <p className="unsaved-note">Previewing unsaved adjustments</p>
        )}
      </div>
    </>
  );
}

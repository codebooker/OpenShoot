import React, { useState, useEffect } from "react";
import controls from "../electron/edit-controls.json";
import { RawDenoise } from "./raw-denoise";
import type { Photo, Edits } from "./types";
function NumericValue({
  value,
  label,
  min,
  max,
  onValue,
}: {
  value: number;
  label: string;
  min: number;
  max: number;
  onValue: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(Number(value.toFixed(2)))), [value]);
  return (
    <input
      className="adjustment-number"
      aria-label={label + " value"}
      inputMode="decimal"
      type="text"
      value={text}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        if (next.trim() !== "" && Number.isFinite(Number(next)))
          onValue(Math.max(min, Math.min(max, Number(next))));
      }}
      onBlur={() => setText(String(value))}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}
const colors = [
  "red",
  "orange",
  "yellow",
  "green",
  "aqua",
  "blue",
  "purple",
  "magenta",
];
export function AdvancedEditor({
  photo,
  albumId,
  onBusy,
  edits,
  onChange,
}: {
  photo?: Photo;
  albumId?: string;
  onBusy?: (busy: boolean) => void;
  edits: Edits;
  onChange: (v: Edits) => void;
}) {
  const [color, setColor] = useState("red"),
    [zone, setZone] = useState("shadow");
  const [opened, setOpened] = useState<Record<string, boolean>>({
    Light: true,
    Color: true,
  });
  const value = (key: string) =>
    Number(
      (edits as unknown as Record<string, unknown>)[key] ??
        (controls as Record<string, { default: number }>)[key]?.default ??
        0,
    );
  function slider(
    key: string,
    label: string,
    min = -100,
    max = 100,
    step = 1,
    neutral = 0,
  ) {
    return (
      <label className="edit-control advanced-control" key={key}>
        <span>
          {label}
          <NumericValue
            value={value(key)}
            label={label}
            min={min}
            max={max}
            onValue={(n) => onChange({ ...edits, [key]: n })}
          />
        </span>
        <input
          aria-label={label}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value(key)}
          onDoubleClick={() => onChange({ ...edits, [key]: neutral })}
          onChange={(e) =>
            onChange({ ...edits, [key]: Number(e.target.value) })
          }
        />
      </label>
    );
  }
  const from = (group: string) =>
    Object.entries(controls)
      .filter(([key, c]) => c.group === group)
      .map(([key, c]) => slider(key, c.label, c.min, c.max, c.step, c.default));
  function section(
    name: string,
    children: React.ReactNode,
    keys: string[] = [],
  ) {
    return (
      <section className="advanced-section" key={name}>
        <button
          className="advanced-heading"
          aria-expanded={!!opened[name]}
          onClick={() => setOpened((v) => ({ ...v, [name]: !v[name] }))}
        >
          <span>{opened[name] ? "⌄" : "›"}</span>
          {name}
        </button>
        {opened[name] && (
          <div className="advanced-body">
            {children}
            <button
              className="text-button advanced-reset"
              onClick={() => {
                const next = { ...edits };
                for (const key of keys)
                  (next as Record<string, unknown>)[key] =
                    (controls as Record<string, { default: number }>)[key]
                      ?.default ?? 0;
                onChange(next);
              }}
            >
              Reset {name.toLowerCase()}
            </button>
          </div>
        )}
      </section>
    );
  }
  const groupKeys = (name: string) =>
    Object.entries(controls)
      .filter(([, c]) => c.group === name)
      .map(([key]) => key);
  return (
    <div className="advanced-editor">
      {section(
        "Light",
        <>
          {slider("exposure", "Exposure", -3, 3, 0.05)}
          {slider("contrast", "Contrast")}
          {from("Light")}
        </>,
        ["exposure", "contrast", ...groupKeys("Light")],
      )}
      {section(
        "Curve",
        <>
          <svg
            viewBox="0 0 200 100"
            className="tone-curve"
            role="img"
            aria-label="Tone curve"
          >
            <path
              d="M0 0V100H200 M0 50H200 M100 0V100"
              stroke="#3a414d"
              fill="none"
            />
            <polyline
              points={`0,100 40,${80 - value("curveShadows") / 6} 80,${60 - value("curveDarks") / 6} 120,${40 - value("curveLights") / 6} 160,${20 - value("curveHighlights") / 6} 200,0`}
              stroke="#a6c4fa"
              strokeWidth="2"
              fill="none"
            />
          </svg>
          {from("Curve")}
        </>,
        groupKeys("Curve"),
      )}
      {section(
        "Color",
        <>
          {slider("temperature", "Warmth")}
          {slider("tint", "Tint")}
          {slider("vibrance", "Vibrance")}
          {slider("saturation", "Saturation")}
          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={edits.monochrome}
              onChange={(e) =>
                onChange({ ...edits, monochrome: e.target.checked })
              }
            />
            Black & white
          </label>
          <p className="fine-print">Relative warmth on the rendered image.</p>
        </>,
        ["temperature", "tint", "vibrance", "saturation"],
      )}
      {section(
        "Color mixer",
        <>
          <div
            className="color-swatches"
            role="group"
            aria-label="Color channel"
          >
            {colors.map((c) => (
              <button
                key={c}
                aria-label={c}
                aria-pressed={color === c}
                style={{
                  background: (
                    {
                      red: "#d96565",
                      orange: "#e8a161",
                      yellow: "#d9c76c",
                      green: "#71b17b",
                      aqua: "#6abdbd",
                      blue: "#6c92dc",
                      purple: "#aa82d2",
                      magenta: "#cf7eb5",
                    } as Record<string, string>
                  )[c],
                }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
          <p className="channel-title">{color}</p>
          {["Hue", "Saturation", "Luminance"].map((prop) =>
            slider(color + prop, prop),
          )}
        </>,
        groupKeys("Color mixer"),
      )}
      {section(
        "Color grading",
        <>
          <div
            className="grading-zones"
            role="group"
            aria-label="Grading range"
          >
            {["shadow", "midtone", "highlight"].map((z) => (
              <button
                key={z}
                aria-pressed={zone === z}
                className={zone === z ? "active" : ""}
                onClick={() => setZone(z)}
              >
                {z === "shadow"
                  ? "Shadows"
                  : z === "midtone"
                    ? "Midtones"
                    : "Highlights"}
              </button>
            ))}
          </div>
          {["Hue", "Saturation", "Luminance"].map((prop) =>
            slider(
              zone + "Grade" + prop,
              prop,
              prop === "Luminance" ? -100 : 0,
              prop === "Hue" ? 360 : 100,
            ),
          )}
        </>,
        groupKeys("Color grading"),
      )}
      {section("Effects", from("Effects"), groupKeys("Effects"))}
      {section("Vignette", from("Vignette"), groupKeys("Vignette"))}
      {section("Grain", from("Grain"), groupKeys("Grain"))}
      {section(
        "Detail",
        <>
          {photo && albumId && (
            <RawDenoise
              photo={photo}
              albumId={albumId}
              edits={edits}
              onChange={onChange}
              onBusy={onBusy}
            />
          )}
          <h4>Sharpening</h4>
          {from("Sharpening")}
          <h4>Noise reduction</h4>
          {from("Noise reduction")}
          <p className="fine-print">
            Local noise smoothing. Inspect at full size before export.
          </p>
        </>,
        [
          "aiDenoise",
          ...groupKeys("Sharpening"),
          ...groupKeys("Noise reduction"),
        ],
      )}
      <p className="advanced-hint">
        Double-click a slider to reset it. Basic mode keeps these adjustments
        active.
      </p>
    </div>
  );
}

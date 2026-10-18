import React, { useState } from "react";
import { Aperture, Check } from "lucide-react";
import { ProgressETA } from "./progress-eta";
import type { Progress } from "./types";

const stages = ["Assess", "Select", "Denoise", "Prepare", "Edit"];
function stageIndex(phase: string) {
  if (
    phase === "AI showcase selection" ||
    phase === "Retrying missing photo assessments"
  )
    return 0;
  if (phase === "Choosing the event showcase") return 1;
  if (phase === "Denoising & finishing previews") return 2;
  if (phase === "Preparing clean editing previews") return 3;
  if (phase === "AI auto edit") return 4;
  if (phase === "Matching lighting & color") return 5;
  return -1;
}
export function WorkProgress({
  progress,
  quickPreview,
  matchingEnabled = false,
  onCancel,
  onError,
}: {
  progress: Progress | null;
  quickPreview: boolean;
  matchingEnabled?: boolean;
  onCancel: () => Promise<unknown>;
  onError: (message: string) => void;
}) {
  const [stopping, setStopping] = useState(false);
  const phase = progress?.phase || "Working on it…";
  const stage = stageIndex(phase);
  const choosing = stage === 1;
  const flowStages =
    matchingEnabled || stage === 5 ? [...stages, "Match"] : stages;
  const percent = progress
    ? Math.min(
        100,
        Math.max(
          0,
          Math.round((progress.done / Math.max(1, progress.total)) * 100),
        ),
      )
    : 0;
  return (
    <div
      className="progress-dialog"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="progress-icon">
        <Aperture className="spin-slow" size={30} />
      </div>
      {quickPreview && stage >= 0 && (
        <>
          <div className="progress-workflow-title">
            Quick Preview · Step {stage + 1} of {flowStages.length}
          </div>
          <ol className="progress-stages" aria-label="Quick Preview stages">
            {flowStages.map((label, i) => (
              <li
                key={label}
                className={
                  i === stage ? "current" : i < stage ? "complete" : ""
                }
                aria-current={i === stage ? "step" : undefined}
              >
                <span>{i < stage ? <Check size={11} /> : i + 1}</span>
                {label}
              </li>
            ))}
          </ol>
        </>
      )}
      <h3>{choosing ? "Choosing your best moments" : phase}</h3>
      <p className="progress-detail">
        {choosing
          ? "Balancing strong photos, distinct moments and event coverage."
          : progress?.file || "Your originals stay safely in place."}
      </p>
      {progress && (
        <>
          <div
            className={`progress-track${choosing ? " indeterminate" : ""}`}
            role="progressbar"
            aria-label={phase}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={choosing ? undefined : percent}
          >
            <div style={choosing ? undefined : { width: `${percent}%` }} />
          </div>
          <div className="progress-caption">
            <span>
              {choosing
                ? "AI is curating the showcase"
                : `${progress.done} of ${progress.total} photos`}
            </span>
            <span>{choosing ? "" : `${percent}%`}</span>
          </div>
          {choosing ? (
            <div className="progress-eta">
              This step may take a little longer.
            </div>
          ) : (
            <ProgressETA progress={progress} />
          )}
          <div className="progress-safe">
            {stage >= 0
              ? "Originals preserved · Review edits before applying"
              : "Your originals stay safely in place."}
          </div>
          <button
            disabled={stopping}
            onClick={async () => {
              setStopping(true);
              try {
                await onCancel();
              } catch (error) {
                setStopping(false);
                onError(error instanceof Error ? error.message : String(error));
              }
            }}
          >
            {stopping ? "Saving progress & stopping…" : "Pause / stop"}
          </button>
        </>
      )}
    </div>
  );
}

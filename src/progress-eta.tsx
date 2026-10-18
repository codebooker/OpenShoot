import React, { useEffect, useState } from "react";
import type { Progress } from "./types";
type Sample = { done: number; at: number };
type Timing = { phase: string; total: number; samples: Sample[] };
export function advanceETA(
  previous: Timing | null,
  progress: Progress,
  now: number,
): Timing {
  const last = previous?.samples.at(-1);
  if (
    !previous ||
    previous.phase !== progress.phase ||
    previous.total !== progress.total ||
    !last ||
    progress.done < last.done
  )
    return {
      phase: progress.phase,
      total: progress.total,
      samples: [{ done: progress.done, at: now }],
    };
  if (progress.done === last.done) return previous;
  return {
    ...previous,
    samples: [...previous.samples, { done: progress.done, at: now }].slice(-8),
  };
}
export function etaLabel(timing: Timing | null, now: number): string {
  if (!timing || timing.samples.length < 2) return "Estimating time remaining…";
  const first = timing.samples[0],
    last = timing.samples.at(-1)!;
  if (last.done >= timing.total) return "Finishing up…";
  const rate = (last.at - first.at) / (last.done - first.done);
  if (!Number.isFinite(rate) || rate <= 0) return "Estimating time remaining…";
  const elapsed = Math.max(0, now - last.at);
  if (elapsed > Math.max(30000, rate * 4))
    return "Taking longer than estimated · waiting for progress…";
  const seconds = Math.ceil(
    Math.max(1000, (timing.total - last.done) * rate - elapsed) / 1000,
  );
  if (seconds < 60)
    return "About " + Math.ceil(seconds / 5) * 5 + " seconds remaining";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60)
    return (
      "About " +
      minutes +
      " " +
      (minutes === 1 ? "minute" : "minutes") +
      " remaining"
    );
  const hours = Math.floor(minutes / 60),
    rest = minutes % 60;
  return (
    "About " +
    hours +
    " " +
    (hours === 1 ? "hour" : "hours") +
    (rest ? " " + rest + " min" : "") +
    " remaining"
  );
}
export function ProgressETA({ progress }: { progress: Progress }) {
  const [timing, setTiming] = useState<Timing | null>(null),
    [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const at = Date.now();
    setTiming((previous) => advanceETA(previous, progress, at));
    setNow(at);
  }, [progress.phase, progress.done, progress.total]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="progress-eta">{etaLabel(timing, now)} · this stage</div>
  );
}

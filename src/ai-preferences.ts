import { useSyncExternalStore } from "react";
const key = "openshoot-ai-edit-preferences";
const event = "openshoot-ai-preferences-changed";
const defaults = {
  concurrency: 16,
  model: "",
  mode: "both",
  quickMode: "both",
  quickDenoise: true,
  matchSet: true,
  cropMode: "free",
  sharePreviews: false,
  open: true,
};
export type AIPreferences = typeof defaults;
function snapshot() {
  return window.localStorage.getItem(key) || "";
}
function subscribe(callback: () => void) {
  window.addEventListener(event, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(event, callback);
    window.removeEventListener("storage", callback);
  };
}
function parse(raw: string): AIPreferences {
  try {
    const p = JSON.parse(raw);
    return {
      concurrency: [2, 8, 16, 24].includes(p.concurrency) ? p.concurrency : 16,
      model: typeof p.model === "string" ? p.model : "",
      quickDenoise: p.quickDenoise !== false,
      matchSet: p.matchSet !== false,
      quickMode: ["both", "edit", "crop"].includes(p.quickMode)
        ? p.quickMode
        : "both",
      mode: ["both", "edit", "crop"].includes(p.mode) ? p.mode : "both",
      cropMode: [
        "original",
        "1:1",
        "4:5",
        "3:2",
        "5:7",
        "16:9",
        "9:16",
        "4:5-portrait",
      ].includes(p.cropMode)
        ? p.cropMode
        : "free",
      sharePreviews: p.sharePreviews === true,
      open: p.open !== false,
    };
  } catch {
    return defaults;
  }
}
export function readAIPreferences() {
  return parse(snapshot());
}
export function updateAIPreferences(patch: Partial<AIPreferences>) {
  window.localStorage.setItem(
    key,
    JSON.stringify({ ...readAIPreferences(), ...patch }),
  );
  window.dispatchEvent(new window.Event(event));
}
export function useAIPreferences() {
  const raw = useSyncExternalStore(subscribe, snapshot);
  return [parse(raw), updateAIPreferences] as const;
}

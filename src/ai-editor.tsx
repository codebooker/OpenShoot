import { CropOptions } from "./crop-options";
import React, { useEffect, useState, useCallback } from "react";
import {
  Sparkles,
  ChevronDown,
  ArrowUpRight,
  LoaderCircle,
  Crop,
  SlidersHorizontal,
  Check,
} from "lucide-react";
import { useAIPreferences, readAIPreferences } from "./ai-preferences";
import type { Auth, Edits } from "./types";
export function AIEditor({
  albumId,
  photoId,
  onPreview,
  onBefore,
}: {
  albumId: string;
  photoId: string;
  onPreview: (edits: Edits) => void;
  onBefore: () => void;
}) {
  const [preferences, updatePreferences] = useAIPreferences();
  const { model, mode, cropMode, open, sharePreviews: consent } = preferences;
  const [auth, setAuth] = useState<Auth | null>(null);
  const [loading, setLoading] = useState(true);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<{
      edits: Edits;
      reason: string;
      confidence: number;
    } | null>(null);
  useEffect(() => {
    setResult(null);
    setError("");
  }, [photoId]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const account = await window.openshoot.auth();
      setAuth(account);
      if (account.enabled) {
        const list = await window.openshoot.models();
        setModels(list);
        if (!readAIPreferences().model && list.length)
          updatePreferences({ model: list[0].id });

        if (!list.length)
          setError(
            "No models are available to this account yet. Try refreshing.",
          );
      } else {
        setModels([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [updatePreferences]);
  useEffect(() => {
    void load();
    return window.openshoot.onAuth(() => {
      setError("");
      void load();
    });
  }, [load]);
  async function signIn() {
    setError("");
    try {
      setAuth((a) => (a ? { ...a, pending: true } : a));
      await window.openshoot.signIn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await load();
    }
  }
  return (
    <div className="inspector-section ai-section">
      <div className="ai-card">
        <button
          className="ai-heading"
          aria-expanded={open}
          onClick={() => updatePreferences({ open: !open })}
          disabled={busy}
        >
          <span className="ai-symbol">
            <Sparkles size={17} />
          </span>
          <span>
            <strong>AI assistant</strong>
            <small>Editing & cropping</small>
          </span>
          <ChevronDown size={15} className={open ? "expanded" : ""} />
        </button>
        {open && (
          <>
            <div className="ai-body">
              {loading ? (
                <p className="ai-description">
                  <LoaderCircle size={15} className="spin" /> Checking ChatGPT
                  connection…
                </p>
              ) : !auth?.enabled ? (
                <div className="ai-connect">
                  <h4>A second eye for your photos</h4>
                  <p className="ai-description">
                    Get suggestions for light, color, and framing. Review every
                    change before applying.
                  </p>
                  <button
                    className="chatgpt-button full"
                    disabled={auth?.pending}
                    onClick={signIn}
                  >
                    {auth?.pending ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      <Sparkles size={16} />
                    )}
                    {auth?.pending
                      ? "Continue in your browser…"
                      : auth?.connected
                        ? "Enable ChatGPT plan usage"
                        : "Sign in with ChatGPT"}
                    <ArrowUpRight size={15} />
                  </button>
                  <p className="ai-note">
                    Opens your browser to connect your account. Signing in
                    doesn’t send any photos.
                  </p>
                </div>
              ) : (
                <>
                  <div className="ai-connected">
                    <Check size={12} /> ChatGPT connected
                  </div>
                  <p className="ai-description">
                    What would you like help with?
                  </p>
                  <div className="ai-tasks" role="group" aria-label="AI task">
                    {[
                      { id: "both", label: "Both", Icon: Sparkles },
                      {
                        id: "edit",
                        label: "Light & color",
                        Icon: SlidersHorizontal,
                      },
                      { id: "crop", label: "Crop", Icon: Crop },
                    ].map(({ id, label, Icon }) => (
                      <button
                        key={id}
                        aria-pressed={mode === id}
                        className={mode === id ? "active" : ""}
                        disabled={busy}
                        onClick={() => {
                          updatePreferences({ mode: id });
                        }}
                      >
                        <Icon size={15} />
                        {label}
                      </button>
                    ))}
                  </div>
                  {mode !== "edit" && (
                    <label className="field">
                      Crop framing
                      <select
                        aria-label="Crop framing"
                        value={cropMode}
                        disabled={busy}
                        onChange={(e) =>
                          updatePreferences({ cropMode: e.target.value })
                        }
                      >
                        <CropOptions />
                      </select>
                      <small>
                        Print ratios follow photo orientation. 16:9 is
                        widescreen.
                      </small>
                    </label>
                  )}
                  <p className="ai-note">
                    {mode === "crop"
                      ? "Suggests framing from the original. Keeps your current light, color, and effects."
                      : "Starts fresh from the original. Replaces existing light, color, and effects, including Advanced adjustments. Preview before applying."}
                  </p>
                  <label className="field">
                    ChatGPT model
                    <select
                      aria-label="ChatGPT model"
                      value={models.some((m) => m.id === model) ? model : ""}
                      disabled={busy}
                      onChange={(e) =>
                        updatePreferences({ model: e.target.value })
                      }
                    >
                      <option value="">Choose a model</option>
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!consent && (
                    <label className="checkbox-line">
                      <input
                        type="checkbox"
                        checked={consent}
                        disabled={busy}
                        onChange={(e) =>
                          updatePreferences({ sharePreviews: e.target.checked })
                        }
                      />{" "}
                      Allow photo previews to be sent to OpenAI when I request
                      AI editing or cropping. Remember this choice.
                    </label>
                  )}
                  {consent && (
                    <p className="ai-note">
                      Photo preview sharing enabled · Manage in Settings.
                    </p>
                  )}
                  <button
                    className="primary full"
                    disabled={
                      busy || !consent || !models.some((m) => m.id === model)
                    }
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      setResult(null);
                      try {
                        const r = await window.openshoot.aiEdit(
                          albumId,
                          photoId,
                          model,
                          mode,
                          cropMode,
                        );
                        setResult(r);
                        onPreview(r.edits);
                      } catch (e) {
                        setError(e instanceof Error ? e.message : String(e));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {busy ? "Analyzing photo…" : "Suggest adjustments"}
                  </button>
                </>
              )}
              {error && (
                <p role="alert" className="fine-print">
                  {error}
                </p>
              )}
              {result && (
                <>
                  <p className="fine-print">{result.reason}</p>
                  <p className="fine-print">
                    Model confidence: {Math.round(result.confidence * 100)}%.
                    Review subject edges and composition.
                  </p>
                  <div className="look-grid">
                    <button onClick={onBefore}>Before / saved</button>
                    <button onClick={() => onPreview(result.edits)}>
                      AI suggestion
                    </button>
                  </div>
                  <p className="unsaved-note">
                    Suggestion is unsaved. Use Apply adjustments below to keep
                    it.
                  </p>
                </>
              )}
              {error && !loading && (
                <button
                  className="text-button"
                  disabled={busy || auth?.pending}
                  onClick={() => {
                    setError("");
                    void load();
                  }}
                >
                  Refresh connection
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

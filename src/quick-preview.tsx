import React, { useEffect, useState } from "react";
import { Sparkles, Download } from "lucide-react";
import type { Album, Auth, Showcase, EditBatch } from "./types";
import { Preview } from "./preview";
import { imageURL } from "./types";
import { useAIPreferences } from "./ai-preferences";
import { BatchEditor } from "./batch-editor";
import exportPresets from "../electron/export-presets.json";
import { CropOptions } from "./crop-options";
export function QuickPreview({
  album,
  auth,
  onConnect,
  onBusy,
  onAlbum,
}: {
  album: Album;
  auth: Auth;
  onConnect: () => void;
  onBusy: (busy: boolean) => void;
  onAlbum: (a: Album) => void;
}) {
  const api = window.openshoot;
  const [prefs, update] = useAIPreferences();
  const [job, setJob] = useState<Showcase | null>(null),
    [count, setCount] = useState(25),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<EditBatch["results"]>([]);
  const [outputPreset, setOutputPreset] = useState("");
  const [editorVersion, setEditorVersion] = useState(0);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const reload = async () => {
    const j = await api.quickStatus(album.id);
    setJob(j);
    if (j) setCount(j.target);
  };
  useEffect(() => {
    let live = true;
    api
      .quickStatus(album.id)
      .then((j) => {
        if (live) {
          setJob(j);
          if (j) setCount(j.target);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [album.id]);
  useEffect(() => {
    let live = true;
    if (auth.enabled)
      api
        .models()
        .then((ms) => {
          if (live) {
            setModels(ms);
            if (!prefs.model && ms.length) update({ model: ms[0].id });
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [auth.enabled]);
  useEffect(() => {
    let live = true;
    if (job?.selected.length)
      api
        .aiEditBatchStatus(album.id, "quick")
        .then((batch) => {
          if (live) setSuggestions(batch && !batch.stale ? batch.results : []);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [album.id, job?.selected.join(","), editorVersion]);
  const complete = !!job?.selected.length,
    applied = complete && job.selected.every((id) => job.applied.includes(id));
  async function select() {
    onBusy(true);
    setError("");
    try {
      const selection = await api.quickRun(
        album.id,
        count,
        job?.model || prefs.model,
        job?.preset || outputPreset,
        prefs.concurrency,
      );
      await api.aiEditBatchRun(
        album.id,
        selection.selected,
        selection.model,
        prefs.quickMode,
        prefs.cropMode,
        prefs.concurrency,
        "quick",
        prefs.quickDenoise,
        prefs.matchSet,
      );
      setJob(selection);
      setEditorVersion((v) => v + 1);
    } catch (e) {
      setError(
        (e instanceof Error ? e.message : String(e)).replace(
          /^Error invoking remote method '[^']+': (?:Error: )?/,
          "",
        ),
      );
      await reload().catch(() => {});
    } finally {
      onBusy(false);
    }
  }
  async function refinish(reevaluate = false) {
    onBusy(true);
    setError("");
    try {
      await api.quickRefinish(album.id, reevaluate, prefs.concurrency);
      await reload();
      setEditorVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await reload().catch(() => {});
    } finally {
      onBusy(false);
    }
  }
  async function exportSet() {
    if (!job) return;
    onBusy(true);
    setError("");
    try {
      const r = await api.export(album.id, {
        scope: "ids",
        ids: job.selected,
        format: "jpeg",
        maxSize: "2400",
        preset: job.preset,
      });
      if (r)
        setNotice(
          `${r.written} preview JPEGs exported${r.failures.length ? ` · ${r.failures.length} failed` : ""}${r.cancelled ? " · stopped" : ""}.`,
        );
    } catch (e) {
      setError(
        (e instanceof Error ? e.message : String(e)).replace(
          /^Error invoking remote method '[^']+': (?:Error: )?/,
          "",
        ),
      );
    } finally {
      onBusy(false);
    }
  }
  return (
    <>
      <header className="quick-heading">
        <div className="modal-icon">
          <Sparkles size={22} />
        </div>
        <div>
          <h2>Quick Preview</h2>
          <p>
            {album.genre} · {album.photos.length} photos
          </p>
        </div>
      </header>
      <p className="modal-subtitle">
        AI chooses, edits, denoises and finishes your event highlights. Review,
        apply, then export.
      </p>
      {error && (
        <p className="batch-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="batch-success" role="status">
          {notice}
        </p>
      )}
      {loading ? (
        <p>Loading showcase…</p>
      ) : (
        <>
          {!complete && (
            <>
              <div className="quick-fields">
                <label className="field">
                  Showcase size
                  <select
                    aria-label="Showcase size"
                    value={count}
                    disabled={!!job}
                    onChange={(e) => setCount(Number(e.target.value))}
                  >
                    {[25, 50, 100].map((n) => (
                      <option key={n} value={n}>
                        {n} photos
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Output size
                  <select
                    aria-label="Showcase output size"
                    value={job?.preset || outputPreset}
                    disabled={!!job}
                    onChange={(e) => {
                      setOutputPreset(e.target.value);
                      const preset =
                        exportPresets[
                          e.target.value as keyof typeof exportPresets
                        ];
                      if (preset) update({ cropMode: preset.cropMode });
                    }}
                  >
                    <option value="">Client preview · up to 2400 px</option>
                    {Object.entries(exportPresets).map(([key, p]) => (
                      <option key={key} value={key}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Rough edit
                  <select
                    aria-label="Showcase editing task"
                    value={prefs.quickMode}
                    onChange={(e) => update({ quickMode: e.target.value })}
                  >
                    <option value="both">Adjustments and crops</option>
                    <option value="edit">Adjustments only</option>
                    <option value="crop">Crops only</option>
                  </select>
                </label>
                <label className="field">
                  ChatGPT model
                  <select
                    aria-label="Showcase model"
                    value={job?.model || prefs.model}
                    disabled={!!job}
                    onChange={(e) => update({ model: e.target.value })}
                  >
                    <option value="">Choose a model</option>
                    {job?.model && !models.some((m) => m.id === job.model) && (
                      <option value={job.model}>{job.model}</option>
                    )}
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="consent">
                <input
                  type="checkbox"
                  aria-label="Match lighting & color across the set"
                  checked={prefs.matchSet}
                  disabled={prefs.quickMode === "crop"}
                  onChange={(e) => update({ matchSet: e.target.checked })}
                />
                Match lighting &amp; color across the set
              </label>
              <details className="quick-options">
                <summary>
                  Options · {prefs.concurrency} at a time
                  {prefs.quickMode !== "edit" ? " · crop framing" : ""}
                </summary>
                <label className="consent">
                  <input
                    type="checkbox"
                    checked={prefs.quickDenoise}
                    onChange={(e) => update({ quickDenoise: e.target.checked })}
                  />
                  Denoise & finish selected photos · local processing
                </label>
                <div className="quick-fields">
                  <label className="field">
                    Processing speed
                    <select
                      aria-label="Showcase processing speed"
                      value={prefs.concurrency}
                      onChange={(e) =>
                        update({ concurrency: Number(e.target.value) })
                      }
                    >
                      {[2, 8, 16, 24].map((n) => (
                        <option key={n} value={n}>
                          {n} photos at a time
                        </option>
                      ))}
                    </select>
                  </label>
                  {prefs.quickMode !== "edit" && (
                    <label className="field">
                      Crop framing
                      <select
                        aria-label="Showcase crop framing"
                        value={prefs.cropMode}
                        onChange={(e) => update({ cropMode: e.target.value })}
                      >
                        <CropOptions />
                      </select>
                    </label>
                  )}
                </div>
                <p className="fine-print">
                  Social presets guide AI crops; borders preserve framing when
                  cropping is off. Selection considers every photo and preserves
                  album ratings.
                </p>
              </details>
              {!auth.enabled ? (
                <button
                  className="chatgpt-button"
                  onClick={onConnect}
                  disabled={auth.pending}
                >
                  Sign in with ChatGPT
                </button>
              ) : (
                <>
                  {!prefs.sharePreviews && (
                    <label className="consent">
                      <input
                        type="checkbox"
                        checked={false}
                        onChange={(e) =>
                          update({ sharePreviews: e.target.checked })
                        }
                      />
                      Allow photo previews to be sent to OpenAI for showcase
                      selection and editing. Remember in Settings.
                    </label>
                  )}
                  <p className="fine-print">
                    Sends previews to OpenAI using your ChatGPT allowance.
                    Progress is saved if you pause.
                  </p>
                  <button
                    className="primary full quick-create"
                    disabled={
                      !prefs.sharePreviews ||
                      !models.some(
                        (m) => m.id === (job?.model || prefs.model),
                      ) ||
                      !album.photos.length ||
                      job?.stale
                    }
                    onClick={select}
                  >
                    {job
                      ? "Resume AI selection"
                      : `Create ${Math.min(count, album.photos.length)}-photo preview`}
                  </button>
                </>
              )}
              {!!job && (
                <p className="fine-print">
                  {job.assessments.length} of {job.ids.length} photos assessed.
                </p>
              )}
            </>
          )}
          {job?.stale && (
            <p className="batch-error">
              The album changed. Start a new showcase to analyze its current
              photos.
            </p>
          )}
          {complete && job && (
            <>
              <p className="batch-summary">
                {job.selected.length} photos chosen by AI · {job.genre} ·{" "}
                {job.applied.length} applied
              </p>
              <details onToggle={(e) => setReviewOpen(e.currentTarget.open)}>
                <summary>Review the AI selection</summary>
                <p className="fine-print">
                  Selection is made from originals before editing. Below: saved
                  edits after Apply, otherwise the AI suggestion when ready.
                </p>
                {reviewOpen && (
                  <div className="showcase-grid">
                    {job.selected.map((id) => {
                      const p = album.photos.find((p) => p.id === id),
                        r = job.assessments.find((r) => r.id === id),
                        suggested = suggestions.find((s) => s.id === id),
                        saved = job.applied.includes(id),
                        edits = saved ? p?.edits : suggested?.edits;
                      return (
                        p && (
                          <figure key={id}>
                            {edits ? (
                              <Preview
                                albumId={album.id}
                                photoId={p.id}
                                originalURL={imageURL(p, true)}
                                alt={
                                  p.name +
                                  (saved ? " saved edit" : " AI suggestion")
                                }
                                edits={edits}
                                onError={setError}
                              />
                            ) : (
                              <img
                                src={imageURL(p, true)}
                                alt={p.name + " original"}
                              />
                            )}
                            <figcaption>
                              <strong>{p.name}</strong>
                              <small>
                                {saved
                                  ? "Saved edit"
                                  : suggested
                                    ? "AI suggestion · not applied"
                                    : "Original · awaiting edit"}
                              </small>
                              <small>{r?.reason}</small>
                            </figcaption>
                          </figure>
                        )
                      );
                    })}
                  </div>
                )}
              </details>
              {!applied && !job.stale && (
                <BatchEditor
                  key={editorVersion}
                  album={album}
                  picked={[]}
                  forcedIds={job.selected.filter(
                    (id) => !job.applied.includes(id),
                  )}
                  kind="quick"
                  onSuggestions={setSuggestions}
                  auth={auth}
                  onConnect={onConnect}
                  onBusy={onBusy}
                  onAlbum={(a) => {
                    onAlbum(a);
                    reload().catch((e) => setError(e.message));
                  }}
                />
              )}
              {applied && (
                <div className="quick-saved-actions">
                  <p className="batch-success">
                    Your showcase edits are saved. You can refine or reset each
                    photo in the editor.
                  </p>
                  <button className="primary full" onClick={exportSet}>
                    <Download size={16} />
                    Export {job.selected.length} preview JPEGs
                  </button>
                  <button className="full" onClick={() => refinish(false)}>
                    Re-finish denoise · preserve edits & crops
                  </button>
                  <button
                    className="full"
                    disabled={!auth.enabled || !prefs.sharePreviews}
                    onClick={() => refinish(true)}
                  >
                    Re-evaluate edits & crops from clean RAW
                  </button>
                  <p className="fine-print">
                    {job.preset
                      ? exportPresets[job.preset as keyof typeof exportPresets]
                          ?.label
                      : "JPEGs up to 2400 pixels"}
                    , including saved adjustments and crops. Originals stay
                    untouched.
                  </p>
                </div>
              )}
            </>
          )}
          {job && (
            <button
              className="text-button"
              onClick={async () => {
                try {
                  await api.quickDiscard(album.id);
                  setJob(null);
                  setError("");
                  setNotice("");
                } catch (e) {
                  setError(
                    (e instanceof Error ? e.message : String(e)).replace(
                      /^Error invoking remote method '[^']+': (?:Error: )?/,
                      "",
                    ),
                  );
                }
              }}
            >
              {complete ? "Start a new showcase" : "Discard saved selection"}
            </button>
          )}
        </>
      )}
    </>
  );
}

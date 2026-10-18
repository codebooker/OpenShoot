import { CropOptions } from "./crop-options";
import React, { useEffect, useState } from "react";
import { Sparkles, Play, Trash2, Check, LoaderCircle } from "lucide-react";
import type { Album, Auth, EditBatch } from "./types";
import { imageURL, freshEdits } from "./types";
import { useAIPreferences } from "./ai-preferences";
import { Preview } from "./preview";
export function BatchEditor({
  album,
  picked,
  auth,
  onConnect,
  onBusy,
  onAlbum,
  forcedIds,
  kind,
  onSuggestions,
}: {
  onSuggestions?: (results: EditBatch["results"]) => void;
  forcedIds?: string[];
  kind?: string;
  album: Album;
  picked: string[];
  auth: Auth;
  onConnect: () => void;
  onBusy: (busy: boolean) => void;
  onAlbum: (a: Album) => void;
}) {
  const api = window.openshoot;
  const [prefs, update] = useAIPreferences();
  const [notice, setNotice] = useState("");
  const [models, setModels] = useState<{ id: string; name: string }[]>([]),
    [job, setJob] = useState<EditBatch | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [scope, setScope] = useState("keepers"),
    [active, setActive] = useState(""),
    [compare, setCompare] = useState("suggestion");
  const ids =
    forcedIds ||
    (scope === "keepers"
      ? album.photos.filter((p) => p.category === "Selected").map((p) => p.id)
      : scope === "picked"
        ? picked
        : album.photos.map((p) => p.id));
  const model = job?.model || prefs.model,
    mode = job?.mode || (kind === "quick" ? prefs.quickMode : prefs.mode),
    cropMode = job ? job.cropMode || "free" : prefs.cropMode;
  const current = job?.results.find((p) => p.id === active) || job?.results[0],
    photo = album.photos.find((p) => p.id === current?.id);
  useEffect(() => {
    let live = true;
    setLoading(true);
    api
      .aiEditBatchStatus(album.id, kind)
      .then((j) => {
        if (live) setJob(j);
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
    if (!auth.enabled) return;
    let live = true;
    api
      .models()
      .then((list) => {
        if (live) {
          setModels(list);
          if (!prefs.model && list.length) update({ model: list[0].id });
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [auth.enabled]);
  async function run() {
    setError("");
    setNotice("");
    onBusy(true);
    try {
      const result = await api.aiEditBatchRun(
        album.id,
        job?.ids || ids,
        model,
        mode,
        cropMode,
        prefs.concurrency,
        kind,
        prefs.quickDenoise,
        job?.matchSet ?? prefs.matchSet,
      );
      setJob(result);
      onSuggestions?.(result.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      try {
        setJob(await api.aiEditBatchStatus(album.id, kind));
      } catch {}
    } finally {
      onBusy(false);
    }
  }
  async function apply(ids: string[]) {
    setError("");
    onBusy(true);
    try {
      onAlbum(await api.aiEditBatchApply(album.id, ids, kind));
      setNotice(
        `Applied suggestions to ${ids.length} ${ids.length === 1 ? "photo" : "photos"}. Use the album Undo button to restore the previous edits.`,
      );
      setJob(await api.aiEditBatchStatus(album.id, kind));
      setActive("");
      setCompare("suggestion");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      onBusy(false);
    }
  }
  return (
    <>
      <div className="modal-icon">
        <Sparkles size={25} />
      </div>
      <h2>{kind === "quick" ? "Finish your showcase" : "AI auto edit"}</h2>
      <p className="modal-subtitle">
        Turn your keepers into a consistent first edit. Adjustments include
        automatic noise reduction, color correction and optional grading. RAW
        denoise starts at 85%. Review before applying; originals stay untouched.
      </p>
      {notice && (
        <p className="batch-success" role="status">
          {notice}
        </p>
      )}
      {job?.stale && (
        <p className="batch-error" role="alert">
          Photos changed since this batch was created. Discard it and start a
          fresh batch.
        </p>
      )}
      {job && job.results.some((r) => r.finish?.warning) && (
        <p className="batch-error" role="alert">
          {job.results.filter((r) => r.finish?.warning).length} photos used
          local image noise reduction instead of AI RAW denoise. Review the
          finishing notice for those photos.
        </p>
      )}
      {error && (
        <p className="batch-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p>
          <LoaderCircle size={16} className="spin" /> Loading saved batch…
        </p>
      ) : (
        <>
          {!job && !forcedIds && (
            <label className="field">
              Photos to edit
              <select
                aria-label="Batch photo scope"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
              >
                <option value="keepers">
                  Keepers ·{" "}
                  {album.photos.filter((p) => p.category === "Selected").length}{" "}
                  selected by culling
                </option>
                <option value="picked" disabled={!picked.length}>
                  Current selection · {picked.length}
                </option>
                <option value="all">
                  Entire album · {album.photos.length}
                </option>
              </select>
            </label>
          )}
          {job && job.done === job.total ? (
            <p className="batch-summary">
              {mode === "both"
                ? "Adjustments and crops"
                : mode === "crop"
                  ? "Crops only"
                  : "Adjustments only"}{" "}
              · {models.find((m) => m.id === model)?.name || model}
            </p>
          ) : (
            <div className="batch-options">
              <label className="field">
                Task
                <select
                  aria-label="Batch task"
                  value={mode}
                  disabled={!!job}
                  onChange={(e) =>
                    update(
                      kind === "quick"
                        ? { quickMode: e.target.value }
                        : { mode: e.target.value },
                    )
                  }
                >
                  <option value="both">Adjustments and crops</option>
                  <option value="edit">Adjustments only</option>
                  <option value="crop">Crops only</option>
                </select>
              </label>
              <label className="field">
                ChatGPT model
                <select
                  aria-label="Batch model"
                  value={model}
                  disabled={!!job || !auth.enabled}
                  onChange={(e) => update({ model: e.target.value })}
                >
                  <option value="">Choose a model</option>
                  {model && !models.some((m) => m.id === model) && (
                    <option value={model}>{model}</option>
                  )}
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {mode !== "edit" && (
            <label className="field">
              Crop framing
              <select
                aria-label="Batch crop framing"
                value={cropMode}
                disabled={!!job}
                onChange={(e) => update({ cropMode: e.target.value })}
              >
                <CropOptions />
              </select>
              <small>
                AI tightens and repositions the frame. Print ratios follow photo
                orientation; 16:9 is widescreen.
              </small>
            </label>
          )}
          <label className="consent">
            <input
              type="checkbox"
              aria-label="Match lighting & color across the set"
              checked={job?.matchSet ?? prefs.matchSet}
              disabled={!!job || mode === "crop"}
              onChange={(e) => update({ matchSet: e.target.checked })}
            />
            Match lighting &amp; color across the set
          </label>
          {(!job || job.done < job.total || job.finishing || job.matching) && (
            <label className="field">
              Processing speed
              <select
                aria-label="AI processing speed"
                value={prefs.concurrency}
                onChange={(e) =>
                  update({ concurrency: Number(e.target.value) })
                }
              >
                <option value={2}>Gentle · 2 at a time</option>
                <option value={8}>Steady · 8 at a time</option>
                <option value={16}>Fast · 16 at a time</option>
                <option value={24}>Maximum · 24 at a time</option>
              </select>
              <small>
                Automatically slows down and retries if the service is busy.
                Speed depends on your model and connection.
              </small>
            </label>
          )}
          <p className="fine-print">
            {mode === "crop"
              ? "Crop suggestions preserve your current light, color, and effects."
              : "Starts fresh from original previews and replaces existing light, color, and effects, including Advanced adjustments."}{" "}
            Suggestions are saved separately until you apply them.
          </p>
          {!auth.enabled && (!job || job.done < job.total) ? (
            <button
              className="chatgpt-button"
              disabled={auth.pending}
              onClick={onConnect}
            >
              {auth.pending
                ? "Continue in your browser…"
                : "Sign in with ChatGPT"}
            </button>
          ) : (
            <>
              {(!job ||
                job.done < job.total ||
                job.finishing ||
                job.matching) &&
                !job?.stale && (
                  <>
                    {job?.finishing &&
                    !job.matching &&
                    job.done === job.total ? (
                      <p className="ai-note">
                        Denoising and sharpening run locally. No photos are sent
                        to OpenAI for this step.
                      </p>
                    ) : !prefs.sharePreviews ? (
                      <label className="consent">
                        <input
                          type="checkbox"
                          aria-label="Allow AI photo previews"
                          checked={false}
                          onChange={(e) =>
                            update({ sharePreviews: e.target.checked })
                          }
                        />
                        Allow photo previews to be sent to OpenAI when I request
                        AI editing or cropping. Remember this choice in
                        Settings.
                      </label>
                    ) : (
                      <p className="ai-note">
                        Photo preview sharing enabled · Manage in Settings. This
                        run sends photo previews for editing and, when enabled,
                        set matching to OpenAI using your ChatGPT allowance.
                      </p>
                    )}
                    <button
                      className="primary full"
                      disabled={
                        ((!job || job.done < job.total || job.matching) &&
                          (!prefs.sharePreviews ||
                            !models.some((m) => m.id === model))) ||
                        (!job && !ids.length)
                      }
                      onClick={run}
                    >
                      <Play size={15} />
                      {job
                        ? (job.finishing || job.matching) &&
                          job.done === job.total
                          ? job.matching
                            ? "Finish matching the set"
                            : `Finish ${job.done} photos · denoise & detail`
                          : `Resume ${job.total - job.done} remaining photos`
                        : `Analyze ${ids.length} photos`}
                    </button>
                  </>
                )}
            </>
          )}
          {job && (
            <>
              <div className="batch-status">
                <strong>
                  {job.done} of {job.total} suggestions ready · not applied
                </strong>
                <button
                  className="text-button"
                  onClick={async () => {
                    try {
                      await api.aiEditBatchDiscard(album.id, kind);
                      setJob(null);
                      onSuggestions?.([]);
                      setError("");
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    }
                  }}
                >
                  <Trash2 size={13} />
                  {kind === "quick"
                    ? "Change task / redo suggestions"
                    : "Discard batch"}
                </button>
              </div>
              {!!job.results.length && (
                <>
                  <div className="batch-review">
                    <div
                      className="batch-photo-list"
                      aria-label="Completed suggestions"
                    >
                      {job.results.map((r) => {
                        const p = album.photos.find((p) => p.id === r.id);
                        return (
                          p && (
                            <button
                              key={r.id}
                              className={current?.id === r.id ? "active" : ""}
                              aria-pressed={current?.id === r.id}
                              onClick={() => {
                                setActive(r.id);
                                setCompare("suggestion");
                              }}
                            >
                              <img src={imageURL(p, true)} alt="" />
                              <span>
                                {p.name}
                                <small>
                                  {r.localOnly
                                    ? "Local finishing"
                                    : r.confidence < 0.8
                                      ? "Review carefully"
                                      : `${Math.round(r.confidence * 100)}% model confidence`}
                                </small>
                              </span>
                            </button>
                          )
                        );
                      })}
                    </div>
                    <div className="batch-preview">
                      {photo && current && (
                        <>
                          <div className="batch-image">
                            <Preview
                              key={photo.id}
                              albumId={album.id}
                              photoId={photo.id}
                              originalURL={imageURL(photo)}
                              alt={photo.name + " batch preview"}
                              edits={
                                compare === "original"
                                  ? freshEdits()
                                  : compare === "saved"
                                    ? photo.edits
                                    : current.edits
                              }
                              onError={setError}
                            />
                          </div>
                          <strong>{photo.name}</strong>
                          <div className="grading-zones">
                            {["original", "saved", "suggestion"].map((v) => (
                              <button
                                key={v}
                                className={compare === v ? "active" : ""}
                                onClick={() => setCompare(v)}
                              >
                                {v === "original"
                                  ? "Original"
                                  : v === "saved"
                                    ? "Before / saved"
                                    : "AI suggestion"}
                              </button>
                            ))}
                          </div>
                          <p className="batch-summary">
                            {mode === "crop"
                              ? "Crops only · no light/color changes requested"
                              : `Exposure ${current.edits.exposure > 0 ? "+" : ""}${current.edits.exposure} · Contrast ${current.edits.contrast} · Saturation ${current.edits.saturation} · Warmth ${current.edits.temperature}`}
                            <br />
                            {mode === "edit"
                              ? "Existing framing preserved"
                              : current.edits.cropRect &&
                                  (current.edits.cropRect.width < 0.995 ||
                                    current.edits.cropRect.height < 0.995)
                                ? `Crop retains ${Math.round(current.edits.cropRect.width * current.edits.cropRect.height * 100)}% of the original frame`
                                : "Full frame kept"}
                          </p>
                          {current.finish && (
                            <p
                              className={
                                current.finish.warning
                                  ? "batch-error"
                                  : "batch-success"
                              }
                            >
                              {current.finish.method}
                              {current.finish.strength
                                ? ` · strength ${current.finish.strength}%`
                                : ""}{" "}
                              · gentle output sharpening
                              {current.finish.warning
                                ? " · " + current.finish.warning
                                : ""}
                            </p>
                          )}
                          {current.editInput === "denoised-raw" && (
                            <p className="ai-note">
                              AI judged the clean RAW rendering used for this
                              output.
                            </p>
                          )}
                          <p className="fine-print">{current.reason}</p>
                          <button
                            disabled={
                              job.stale || job.finishing || job.matching
                            }
                            onClick={() => apply([current.id])}
                          >
                            <Check size={14} />
                            Apply to this photo
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="modal-actions">
                    <span className="fine-print">
                      {job.results.filter((r) => r.confidence < 0.8).length > 0
                        ? `${job.results.filter((r) => r.confidence < 0.8).length} suggestions need closer review.`
                        : "Apply is undoable during this session."}
                    </span>
                    <button
                      className="primary"
                      disabled={job.stale || job.finishing || job.matching}
                      onClick={() => apply(job.results.map((r) => r.id))}
                    >
                      <Check size={15} />
                      Apply all {job.done} ready suggestions
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}

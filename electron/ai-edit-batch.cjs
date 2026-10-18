const fs = require("node:fs/promises"),
  path = require("node:path");
const { finishQuick, isFinished } = require("./quick-finish.cjs");
const { runQueue } = require("./ai-queue.cjs");
const { analyze } = require("./ai-edit.cjs");
const { validateEdits } = require("./library.cjs");
class AIEditBatch {
  constructor(lib, auth, prefix = "ai-edit-") {
    this.lib = lib;
    this.prefix = prefix;
    this.auth = auth;
    this.controller = null;
  }
  file(id) {
    this.lib.album(id);
    return path.join(this.lib.root, this.prefix + id + ".json");
  }
  async read(id) {
    try {
      return JSON.parse(await fs.readFile(this.file(id), "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }
  async write(id, job) {
    const file = this.file(id);
    await fs.writeFile(file + ".tmp", JSON.stringify(job));
    await fs.rename(file + ".tmp", file);
  }
  view(job) {
    return job
      ? {
          finishing:
            (job.finishRequested === true ||
              (this.prefix === "quick-edit-" &&
                job.finishRequested !== false)) &&
            job.results.some((r) => !isFinished(r)),
          matchSet: !!job.matchSet,
          matching:
            !!job.matchSet && (job.matchDone?.length || 0) < job.entries.length,
          model: job.model,
          mode: job.mode,
          cropMode: job.cropMode || "free",
          ids: job.entries.map((p) => p.id),
          results: job.results,
          done: job.results.length,
          total: job.entries.length,
        }
      : null;
  }
  async status(id) {
    const job = await this.read(id);
    if (!job) return null;
    try {
      this.check(id, job);
      return this.view(job);
    } catch {
      return { ...this.view(job), stale: true };
    }
  }
  async discard(id) {
    if (this.lib.busy) throw Error("Please wait for the current operation");
    await fs.rm(this.file(id), { force: true });
  }
  pause() {
    this.controller?.abort();
  }
  check(id, job) {
    const a = this.lib.album(id);
    for (const entry of job.entries) {
      const p = a.photos.find((p) => p.id === entry.id);
      if (
        !p ||
        JSON.stringify(p.edits) !== entry.base ||
        p.category !== entry.category
      )
        throw Error(
          "Photos or edits changed since this batch was created. Discard the batch and start again.",
        );
    }
    return a;
  }
  async run(
    id,
    ids,
    model,
    mode,
    progress = () => {},
    cropMode = "free",
    concurrency = 16,
    finish = true,
    match = false,
  ) {
    if (this.lib.busy) throw Error("Please wait for the current operation");
    this.lib.busy = true;
    this.controller = new AbortController();
    try {
      if (!["both", "edit", "crop"].includes(mode))
        throw Error("Choose an editing task");
      if (!require("./crop.cjs").cropModes.includes(cropMode))
        throw Error("Choose a valid crop framing mode");
      let job = await this.read(id);
      if (job) {
        if (
          job.model !== model ||
          job.mode !== mode ||
          (job.cropMode || "free") !== cropMode
        )
          throw Error(
            "Resume with the saved model, task and framing, or discard this batch.",
          );
        this.check(id, job);
      } else {
        const a = this.lib.album(id);
        if (
          !Array.isArray(ids) ||
          !ids.length ||
          ids.length !== new Set(ids).size ||
          ids.some((pid) => !a.photos.some((p) => p.id === pid))
        )
          throw Error("Choose photos for this batch");
        job = {
          model,
          mode,
          matchSet: match === true && mode !== "crop",
          cropMode,
          entries: ids.map((pid) => {
            const p = a.photos.find((p) => p.id === pid);
            return {
              id: pid,
              base: JSON.stringify(p.edits),
              category: p.category,
            };
          }),
          results: [],
          createdAt: new Date().toISOString(),
        };
      }
      if (
        job.results.length < job.entries.length &&
        !(await this.auth.models()).some((m) => m.id === model)
      )
        throw Error("Choose an available ChatGPT model");
      if (this.prefix === "quick-edit-" || mode !== "crop") {
        job.finishRequested = this.prefix === "quick-edit-" ? finish : true;
        job.albumId = id;
      }
      await this.write(id, job);
      const done = new Set(job.results.map((p) => p.id)),
        remaining = job.entries.filter((p) => !done.has(p.id));
      const previewInputs = new Map();
      const detailInputs = new Map();
      if (job.finishRequested && remaining.length) {
        job.prepared ||= {};
        const prepared = {
          albumId: id,
          results: remaining.map(
            (entry) =>
              job.prepared[entry.id] || {
                id: entry.id,
                edits: {
                  ...require("./analysis.cjs").defaultEdits(),
                  rotation: this.lib.photo(id, entry.id).edits.rotation || 0,
                },
              },
          ),
        };
        await finishQuick(
          this.lib,
          prepared,
          async () => {
            for (const r of prepared.results) job.prepared[r.id] = r;
            await this.write(id, job);
          },
          progress,
          this.controller.signal,
        );
      }
      if (job.prepared) {
        for (let i = 0; i < remaining.length; i++) {
          if (this.controller.signal.aborted)
            throw Error("Batch paused. Prepared photos are saved.");
          const pid = remaining[i].id,
            prepared = job.prepared[pid];
          if (prepared?.edits.rawDenoiseKey) {
            progress({
              phase: "Preparing clean editing previews",
              done: i,
              total: remaining.length,
              file: this.lib.photo(id, pid).name,
            });
            previewInputs.set(
              pid,
              await this.lib.denoiser.input(
                this.lib.photo(id, pid),
                prepared.edits,
                2400,
              ),
            );
          }
          if (job.finishRequested)
            detailInputs.set(
              pid,
              await require("./noise-samples.cjs").noiseSamples(
                this.lib,
                this.lib.photo(id, pid),
                prepared?.edits,
              ),
            );
        }
      }
      progress({
        phase: "AI auto edit",
        file: `Up to ${concurrency} photos in parallel · counter shows completed suggestions`,
        done: job.results.length,
        total: job.entries.length,
      });
      if (![2, 8, 16, 24].includes(concurrency))
        throw Error("Choose a valid AI speed");
      try {
        await runQueue(
          remaining,
          async (p) => {
            this.check(id, job);
            const prepared = job.prepared?.[p.id];
            const input = previewInputs.get(p.id);
            const result = await analyze(
              this.lib,
              this.auth,
              id,
              p.id,
              model,
              mode,
              AbortSignal.any([
                this.controller.signal,
                AbortSignal.timeout(180000),
              ]),
              cropMode,
              !!job.finishRequested,
              input,
              detailInputs.get(p.id),
            );
            if (prepared) {
              for (const key of [
                "rawDenoiseKey",
                "aiDenoise",
                "noiseReduction",
                "colorNoiseReduction",
                "sharpening",
                "sharpenRadius",
                "sharpenMasking",
              ])
                if (prepared.edits[key] !== undefined)
                  result.edits[key] = prepared.edits[key];
              result.finish = { ...prepared.finish };
              if (
                result.edits.rawDenoiseKey &&
                result.denoiseAmount !== undefined
              ) {
                result.edits.aiDenoise = result.denoiseAmount;
                result.finish.strength = result.denoiseAmount;
                if (result.denoiseAmount !== prepared.edits.aiDenoise) {
                  const chosenSource = await this.lib.denoiser.input(
                    this.lib.photo(id, p.id),
                    result.edits,
                    2400,
                  );
                  Object.assign(
                    result,
                    await require("./ai-edit-safety.cjs").protectHighlights(
                      chosenSource,
                      result,
                      mode,
                    ),
                  );
                }
              }
            }
            return {
              id: p.id,
              ...result,
              editInput: input ? "denoised-raw" : "camera-preview",
            };
          },
          async (result) => {
            job.results.push(result);
            await this.write(id, job);
            progress({
              phase: "AI auto edit",
              file: `Up to ${concurrency} photos in parallel · counter shows completed suggestions`,
              done: job.results.length,
              total: job.entries.length,
            });
          },
          { concurrency, signal: this.controller.signal },
        );
      } catch (error) {
        throw Error(
          this.controller.signal.aborted
            ? "Batch paused. Completed suggestions are saved."
            : error.message +
                ". Completed suggestions are saved; resume to retry remaining photos.",
        );
      }
      this.check(id, job);
      if (job.finishRequested)
        await finishQuick(
          this.lib,
          job,
          () => this.write(id, job),
          progress,
          this.controller.signal,
        );
      if (job.matchSet)
        await require("./set-matching.cjs").matchSet(
          this.lib,
          this.auth,
          job,
          () => this.write(id, job),
          progress,
          this.controller.signal,
        );
      return this.view(job);
    } finally {
      this.lib.busy = false;
      this.controller = null;
    }
  }
  async apply(id, ids) {
    if (this.lib.busy) throw Error("Please wait for the current operation");
    this.lib.busy = true;
    try {
      const job = await this.read(id);
      if (!job) throw Error("No saved editing batch");
      if (
        (job.finishRequested === true ||
          (this.prefix === "quick-edit-" && job.finishRequested !== false)) &&
        job.results.some((r) => !isFinished(r))
      )
        throw Error("Finish denoising these suggestions before applying them.");
      if (job.matchSet && (job.matchDone?.length || 0) < job.entries.length)
        throw Error("Finish set matching before applying these suggestions.");
      const a = this.check(id, job),
        set = new Set(ids);
      if (
        !Array.isArray(ids) ||
        !ids.length ||
        set.size !== ids.length ||
        ids.some((pid) => !job.results.some((r) => r.id === pid))
      )
        throw Error("Choose completed suggestions to apply");
      // Validate every selected result before changing any photo.
      const map = new Map(
        job.results
          .filter((r) => set.has(r.id))
          .map((r) => [r.id, validateEdits(r.edits)]),
      );
      const before = a.photos;
      a.photos = a.photos.map((p) =>
        map.has(p.id) ? { ...p, edits: map.get(p.id) } : p,
      );
      try {
        await this.lib.save();
      } catch (e) {
        a.photos = before;
        throw e;
      }
      job.entries = job.entries.filter((p) => !set.has(p.id));
      job.results = job.results.filter((p) => !set.has(p.id));
      // Album edits are already committed. A stale checkpoint after an I/O failure
      // is safely refused by check() rather than applied twice.
      try {
        if (job.entries.length) await this.write(id, job);
        else await fs.rm(this.file(id), { force: true });
      } catch {
        // Do not report a committed edit as failed (the caller would roll back
        // memory/Undo). status() identifies any leftover checkpoint as stale.
        console.warn(
          "Applied AI edits; the saved batch could not be cleaned up. Discard its stale checkpoint.",
        );
      }
      return a;
    } finally {
      this.lib.busy = false;
    }
  }
}
module.exports = { AIEditBatch };

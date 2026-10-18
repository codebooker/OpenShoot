const path = require("node:path");
const { RAW_EXTENSIONS } = require("./file-types.cjs");
const { validateEdits } = require("./library.cjs");
const isFinished = (result) =>
  result.finish?.status === "done" && result.finish.version >= 2;
async function finishQuick(lib, job, save, progress, signal) {
  for (let i = 0; i < job.results.length; i++) {
    if (signal?.aborted)
      throw Error("Batch paused. Completed finishing work is saved.");
    const result = job.results[i],
      photo = lib.photo(job.albumId, result.id);
    if (isFinished(result)) continue;
    const report = (detail) =>
      progress({
        phase: "Denoising & finishing previews",
        done: i,
        total: job.results.length,
        file: photo.name + (detail ? " · " + detail : ""),
      });
    report();
    let method = "RGB noise reduction",
      warning = "";
    const edits = { ...result.edits };
    if (RAW_EXTENSIONS.includes(path.extname(photo.path).toLowerCase())) {
      try {
        if (!lib.denoiser) throw Error("RAW denoiser is unavailable");
        const generated = await lib.denoiser.generate(
          photo,
          (p) => report(p.phase),
          true,
        );
        edits.rawDenoiseKey = generated.key;
        edits.aiDenoise = 85;
        method = "AI RAW denoise";
      } catch (error) {
        if (signal?.aborted)
          throw Error("Batch paused. Completed finishing work is saved.");
        warning =
          "AI RAW denoise unavailable: " +
          error.message +
          " Using local image noise reduction instead.";
      }
    }
    if (method !== "AI RAW denoise") {
      edits.noiseReduction = Math.max(edits.noiseReduction || 0, 15);
      edits.colorNoiseReduction = Math.max(edits.colorNoiseReduction || 0, 20);
    }
    // Gentle output detail; avoid forcing sharpening over an explicit AI choice.
    if (edits.sharpening === undefined) {
      edits.sharpening = 20;
      edits.sharpenRadius = 0.8;
      edits.sharpenMasking = 60;
    }
    result.edits = validateEdits(edits);
    result.finish = {
      status: "done",
      method,
      warning,
      version: 3,
      strength: method === "AI RAW denoise" ? edits.aiDenoise : null,
    };
    await save();
    progress({
      phase: "Denoising & finishing previews",
      done: i + 1,
      total: job.results.length,
      file: photo.name + " · " + method,
    });
  }
}
module.exports = { finishQuick, isFinished };

const fs = require("node:fs/promises"),
  path = require("node:path"),
  crypto = require("node:crypto");
const sharp = require("sharp"),
  exifr = require("exifr");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const exec = promisify(execFile);
const {
  measure,
  classify,
  xmp,
  render,
  defaultEdits,
} = require("./analysis.cjs");
const { RAW_EXTENSIONS, supported, filterFiles } = require("./file-types.cjs");
class Library {
  constructor(root) {
    this.root = root;
    this.cache = path.join(root, "previews");
    this.previewJobs = new Map();
    this.recoveryQueue = Promise.resolve();
    this.db = { version: 1, albums: [] };
    this.queue = Promise.resolve();
    this.busy = false;
    this.cancelled = false;
  }
  async init() {
    await fs.mkdir(this.cache, { recursive: true });
    // Older builds shared Chromium's case-insensitive Cache directory on macOS.
    // Migrate only our UUID-named JPEGs, never Chromium's own cache contents.
    const legacy = path.join(this.root, "cache");
    try {
      for (const name of await fs.readdir(legacy)) {
        if (!/^[a-f0-9-]{36}(?:-thumb|-source)?\.jpg$/.test(name)) continue;
        try {
          await fs.access(path.join(this.cache, name));
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
          await fs.rename(path.join(legacy, name), path.join(this.cache, name));
        }
      }
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    try {
      this.db = JSON.parse(
        await fs.readFile(path.join(this.root, "library.json"), "utf8"),
      );
    } catch (e) {
      if (e.code !== "ENOENT")
        throw Error(
          "Library could not be read. Your data has been preserved: " +
            e.message,
        );
    }
    return this;
  }
  async save() {
    const data = JSON.stringify(this.db);
    this.queue = this.queue
      .catch(() => {})
      .then(async () => {
        const p = path.join(this.root, "library.json");
        await fs.writeFile(p + ".tmp", data);
        await fs.rename(p + ".tmp", p);
      });
    await this.queue;
  }
  album(id) {
    const a = this.db.albums.find((a) => a.id === id && !a.archived);
    if (!a) throw Error("Album not found");
    return a;
  }
  list() {
    return this.db.albums
      .filter((a) => !a.archived)
      .map((a) => ({
        ...a,
        photos: a.photos.slice(0, 4),
        count: a.photos.length,
        selected: a.photos.filter((p) => p.category === "Selected").length,
      }));
  }
  async create(name, genre) {
    const a = {
      id: crypto.randomUUID(),
      name: (name || "Untitled album").trim().slice(0, 150),
      genre: genre || "Wedding & engagement",
      createdAt: new Date().toISOString(),
      status: "Imported",
      photos: [],
    };
    this.db.albums.unshift(a);
    await this.save();
    return a;
  }
  async walk(paths, depth = 0) {
    if (depth > 64) throw Error("Folder nesting exceeds 64 levels");
    const out = [];
    for (const p of paths) {
      const stat = await fs.lstat(p);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        const children = await fs.readdir(p);
        out.push(
          ...(await this.walk(
            children
              .filter((n) => !n.startsWith("."))
              .map((n) => path.join(p, n)),
            depth + 1,
          )),
        );
      } else if (supported.has(path.extname(p).toLowerCase())) out.push(p);
    }
    return out;
  }
  async ensurePreview(id) {
    try {
      await Promise.all([
        fs.access(path.join(this.cache, id + ".jpg")),
        fs.access(path.join(this.cache, id + "-thumb.jpg")),
      ]);
      return;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    if (this.previewJobs.has(id)) return this.previewJobs.get(id);
    const photo = this.db.albums
      .flatMap((a) => a.photos)
      .find((p) => p.id === id);
    if (!photo) throw Error("Photo not found");
    const job = this.recoveryQueue
      .catch(() => {})
      .then(() => this.decode(photo.path, id));
    this.recoveryQueue = job.catch(() => {});
    this.previewJobs.set(id, job);
    try {
      await job;
    } finally {
      this.previewJobs.delete(id);
    }
  }
  async decode(source, id) {
    const cache = this.cache,
      preview = path.join(cache, id + ".jpg");
    let input = source,
      converted = false,
      metadata;
    try {
      metadata = await sharp(source).metadata();
      await sharp(source)
        .rotate()
        .resize(2400, 2400, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 88 })
        .toFile(preview);
    } catch (e) {
      if (process.platform !== "darwin")
        throw Error("This format needs a compatible RAW / image decoder");
      input = path.join(cache, id + "-source.jpg");
      await exec(
        "/usr/bin/sips",
        ["-s", "format", "jpeg", source, "--out", input],
        { timeout: 60000, maxBuffer: 1024 * 1024 },
      );
      metadata = await sharp(input).metadata();
      await sharp(input)
        .rotate()
        .resize(2400, 2400, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 88 })
        .toFile(preview);
      converted = true;
    }
    await sharp(preview)
      .resize(640, 640, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toFile(path.join(cache, id + "-thumb.jpg"));
    let exif = {};
    try {
      exif =
        (await exifr.parse(source, {
          pick: [
            "Make",
            "Model",
            "LensModel",
            "ISO",
            "FNumber",
            "ExposureTime",
            "FocalLength",
            "DateTimeOriginal",
          ],
        })) || {};
    } catch {}
    const swapped = [5, 6, 7, 8].includes(metadata.orientation);
    return {
      width: swapped ? metadata.height : metadata.width,
      height: swapped ? metadata.width : metadata.height,
      exif,
      analysis: await measure(preview),
      converted,
    };
  }
  async import(id, paths, progress = () => {}) {
    if (this.busy) throw Error("Please wait for the current operation");
    this.busy = true;
    this.cancelled = false;
    try {
      const a = this.album(id),
        files = await this.walk(paths),
        existing = new Set(a.photos.map((p) => p.path)),
        errors = [];
      let added = 0;
      for (let i = 0; i < files.length; i++) {
        if (this.cancelled) break;
        const source = files[i];
        progress({
          phase: "Importing photos",
          done: i,
          total: files.length,
          file: path.basename(source),
        });
        if (existing.has(source)) continue;
        const pid = crypto.randomUUID();
        try {
          const info = await this.decode(source, pid),
            stat = await fs.stat(source);
          a.photos.push({
            id: pid,
            path: source,
            name: path.basename(source),
            size: stat.size,
            ...info,
            category: "Unrated",
            rating: 0,
            label: "",
            edits: defaultEdits(),
          });
          existing.add(source);
          added++;
        } catch (e) {
          errors.push({ file: path.basename(source), error: e.message });
        }
        if (i % 20 === 0) await this.save();
      }
      await this.save();
      return { album: a, added, errors, cancelled: this.cancelled };
    } finally {
      this.busy = false;
    }
  }
  async cull(id, settings, progress = () => {}) {
    if (this.busy) throw Error("Please wait for the current operation");
    this.busy = true;
    try {
      const a = this.album(id);
      this.cancelled = false;
      for (let i = 0; i < a.photos.length; i++) {
        if (this.cancelled)
          throw Error(
            "Culling stopped. Your previous selections are preserved.",
          );
        const p = a.photos[i];
        if (p.analysis.version !== 2) {
          await this.ensurePreview(p.id);
          p.analysis = await measure(path.join(this.cache, p.id + ".jpg"));
        }
        progress({
          phase: "Finding your best photos",
          done: i,
          total: a.photos.length,
        });
      }
      await new Promise((r) => setTimeout(r, 80));
      a.photos = classify(a.photos, settings);
      a.status = "Culled";
      a.cullSettings = settings;
      a.culledAt = new Date().toISOString();
      await this.save();
      return a;
    } finally {
      this.busy = false;
    }
  }
  async remove(id, ids) {
    if (this.busy) throw Error("Please wait for the current operation");
    const a = this.album(id);
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length !== new Set(ids).size ||
      ids.some((pid) => !a.photos.some((p) => p.id === pid))
    )
      throw Error("Choose existing photos to remove");
    const removed = new Set(ids),
      before = a.photos;
    a.photos = a.photos.filter((p) => !removed.has(p.id));
    try {
      await this.save();
    } catch (e) {
      a.photos = before;
      throw e;
    }
    return a;
  }
  async patch(id, ids, patch) {
    const a = this.album(id);
    const allowed = {};
    for (const k of ["rating", "label", "category", "edits"])
      if (k in patch) allowed[k] = patch[k];
    if (allowed.rating !== undefined)
      allowed.rating = Math.max(
        0,
        Math.min(5, Math.round(allowed.rating) || 0),
      );
    if (
      allowed.category &&
      ![
        "Selected",
        "Maybe",
        "Duplicates",
        "Blurred",
        "Closed Eyes",
        "Rejected",
        "Unrated",
      ].includes(allowed.category)
    )
      throw Error("Invalid category");
    if (allowed.edits) allowed.edits = validateEdits(allowed.edits);
    const set = new Set(ids);
    a.photos = a.photos.map((p) => (set.has(p.id) ? { ...p, ...allowed } : p));
    await this.save();
    return a;
  }
  async rename(id, name) {
    const a = this.album(id);
    if (!name.trim()) throw Error("Please enter an album name");
    a.name = name.trim().slice(0, 150);
    await this.save();
    return a;
  }
  async archive(id) {
    this.album(id).archived = true;
    await this.save();
  }
  async restore() {
    for (const a of this.db.albums) a.archived = false;
    await this.save();
    return this.list();
  }
  photo(id, pid) {
    const p = this.album(id).photos.find((p) => p.id === pid);
    if (!p) throw Error("Photo not found");
    return p;
  }
  async input(p, edits = p.edits) {
    try {
      await fs.access(p.path);
    } catch {
      throw Error(
        "Original file is unavailable. Reconnect its drive or restore it to " +
          p.path,
      );
    }
    if (edits?.rawDenoiseKey && edits.aiDenoise > 0) {
      if (!this.denoiser)
        throw Error("RAW denoising is unavailable in this runtime");
      return this.denoiser.input(p, edits);
    }
    if (p.converted) {
      const decoded = path.join(this.cache, p.id + "-source.jpg");
      try {
        await fs.access(decoded);
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
        await this.decode(p.path, p.id);
      }
      return decoded;
    }
    return p.path;
  }
  async editPreview(id, pid, edits) {
    const p = this.photo(id, pid);
    await this.ensurePreview(p.id);
    const safe = validateEdits(edits);
    let preview = path.join(this.cache, p.id + ".jpg");
    if (safe.rawDenoiseKey && safe.aiDenoise > 0) {
      if (!this.denoiser)
        throw Error("RAW denoising is unavailable in this runtime");
      preview = await this.denoiser.input(p, safe, 2400);
    }
    const data = await render(preview, safe, 1600);
    return "data:image/jpeg;base64," + data.toString("base64");
  }
  async export(id, options, destination, progress = () => {}) {
    if (this.busy) throw Error("Please wait for the current operation");
    this.busy = true;
    this.cancelled = false;
    try {
      const a = this.album(id);
      const presets = require("./export-presets.json"),
        preset = options.preset ? presets[options.preset] : null;
      if (options.preset && !Object.hasOwn(presets, options.preset))
        throw Error("Invalid export preset");
      if (
        options.scope === "ids" &&
        (!Array.isArray(options.ids) ||
          !options.ids.length ||
          new Set(options.ids).size !== options.ids.length ||
          options.ids.some((id) => !a.photos.some((p) => p.id === id)))
      )
        throw Error("Invalid preview export selection");
      const requested = new Set(options.ids || []);
      const photos = a.photos.filter(
        (p) =>
          options.scope === "all" ||
          (options.scope === "ids" && requested.has(p.id)) ||
          (options.scope === "rated" && p.rating >= 4) ||
          (options.scope === "selected" && p.category === "Selected"),
      );
      if (!photos.length) throw Error("No photos match the export selection");
      // Every export gets its own directory; source images and existing sidecars remain untouched.
      const folder = await fs.mkdtemp(path.join(destination, "OpenShoot-"));
      const failures = [];
      let written = 0;
      for (let i = 0; i < photos.length; i++) {
        if (this.cancelled) break;
        const p = photos[i];
        progress({
          phase: "Exporting photos",
          done: i,
          total: photos.length,
          file: p.name,
        });
        const base = path.parse(p.name).name + "-" + p.id.slice(0, 8);
        try {
          if (options.format === "original")
            await fs.copyFile(
              p.path,
              path.join(folder, base + path.extname(p.name)),
            );
          if (options.format === "jpeg") {
            let output = await render(
              await this.input(p),
              p.edits,
              preset
                ? Math.max(preset.width, preset.height)
                : options.maxSize
                  ? Number(options.maxSize)
                  : undefined,
            );
            if (preset)
              output = await sharp(output)
                .resize(preset.width, preset.height, {
                  fit: "contain",
                  background: "#101114",
                })
                .jpeg({ quality: 92 })
                .toBuffer();
            await fs.writeFile(path.join(folder, base + ".jpg"), output);
          }
          await fs.writeFile(path.join(folder, base + ".xmp"), xmp(p));
          written++;
        } catch (e) {
          failures.push({ file: p.name, error: e.message });
        }
      }
      await fs.writeFile(
        path.join(folder, "openshoot-manifest.json"),
        JSON.stringify(
          {
            album: a.name,
            exportedAt: new Date().toISOString(),
            options,
            written,
            failures,
            photos: photos.map((p) => ({
              name: p.name,
              rating: p.rating,
              label: p.label,
              category: p.category,
              edits: p.edits,
            })),
          },
          null,
          2,
        ),
      );
      return { folder, written, failures, cancelled: this.cancelled };
    } finally {
      this.busy = false;
    }
  }
}
function validateEdits(e) {
  const controls = require("./edit-controls.json");
  const v = defaultEdits();
  for (const [k, min, max] of [
    ["exposure", -3, 3],
    ["contrast", -100, 100],
    ["saturation", -100, 100],
    ["temperature", -100, 100],
  ])
    v[k] = Math.max(min, Math.min(max, Number(e[k]) || 0));
  for (const [key, control] of Object.entries(controls)) {
    if (e[key] !== undefined) {
      if (!Number.isFinite(e[key])) throw Error("Invalid adjustment: " + key);
      v[key] = Math.max(control.min, Math.min(control.max, e[key]));
    }
  }
  v.rotation = [0, 90, 180, 270].includes(e.rotation) ? e.rotation : 0;
  v.crop = ["original", "1:1", "4:5", "3:2", "16:9"].includes(e.crop)
    ? e.crop
    : "original";
  if (e.cropRect && typeof e.cropRect === "object") {
    const c = e.cropRect;
    if (
      ![c.x, c.y, c.width, c.height].every(Number.isFinite) ||
      c.x < 0 ||
      c.y < 0 ||
      c.width < (e.cropRatio && e.cropRatio !== "original" ? 0.01 : 0.25) ||
      c.height < (e.cropRatio && e.cropRatio !== "original" ? 0.01 : 0.25) ||
      c.x + c.width > 1.000001 ||
      c.y + c.height > 1.000001
    )
      throw Error("Invalid crop rectangle");
    v.cropRect = { x: c.x, y: c.y, width: c.width, height: c.height };
    if (
      require("./crop.cjs").cropModes.includes(e.cropRatio) &&
      e.cropRatio !== "free"
    ) {
      if (e.cropRatio === "original")
        v.cropRect = require("./crop.cjs").originalRatioCrop(v.cropRect);
      v.cropRatio = e.cropRatio;
    }
  }
  if (e.rawDenoiseKey !== undefined) {
    if (
      typeof e.rawDenoiseKey !== "string" ||
      !/^[a-f0-9]{64}$/.test(e.rawDenoiseKey)
    )
      throw Error("Invalid RAW denoise key");
    v.rawDenoiseKey = e.rawDenoiseKey;
    v.aiDenoise = Math.max(0, Math.min(100, Number(e.aiDenoise) || 0));
  }
  v.monochrome = !!e.monochrome;
  return v;
}
module.exports = {
  Library,
  validateEdits,
  filterFiles,
  RAW_EXTENSIONS,
  supported,
};

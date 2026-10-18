const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  sharp = require("sharp");
const {
  QuickPreview,
  validateAssessments,
  validateSelection,
  genreGuidance,
} = require("../electron/quick-preview.cjs");
const { Library } = require("../electron/library.cjs");
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openshoot-showcase-")),
    lib = await new Library(root).init(),
    album = await lib.create("Showcase", "Sports & action");
  const buffer = await sharp({
    create: { width: 100, height: 60, channels: 3, background: "#608020" },
  })
    .jpeg()
    .toBuffer();
  for (let i = 0; i < 5; i++) {
    const id = "photo-" + i,
      file = path.join(root, id + ".jpg");
    await fs.writeFile(file, buffer);
    await fs.writeFile(path.join(lib.cache, id + ".jpg"), buffer);
    album.photos.push({
      id,
      path: file,
      name: id + ".jpg",
      width: 100,
      height: 60,
      exif: {},
      category: i ? "Rejected" : "Selected",
      rating: i,
      edits: {
        exposure: 0,
        contrast: 0,
        saturation: 0,
        temperature: 0,
        rotation: 0,
        monochrome: false,
        crop: "original",
      },
    });
  }
  await lib.save();
  return { root, lib, album };
}
test("AI showcase examines the whole album with genre guidance, resumes final curation and never changes album classifications", async () => {
  const { root, lib, album } = await fixture();
  try {
    const before = structuredClone(album);
    let analysis = 0,
      curation = 0,
      fail = true;
    const auth = {
      models: async () => [{ id: "test" }],
      respond: async (body) => {
        assert.match(body.instructions, /Sports & action/);
        assert.match(body.instructions, /peak action/);
        if (body.instructions.includes("Examine EVERY")) {
          analysis++;
          const content = body.input[0].content,
            ids = content
              .filter((c) => c.type === "input_text")
              .map((c) => c.text.slice("Image id: ".length));
          assert.equal(ids.length, 5);
          return JSON.stringify({
            photos: ids.map((id) => ({
              id,
              score: 80,
              moment: "Visible play",
              reason: "Strong composition",
            })),
          });
        }
        curation++;
        if (fail) throw Error("temporary outage");
        return JSON.stringify({ ids: album.photos.map((p) => p.id).reverse() });
      },
    };
    let service = new QuickPreview(lib, auth);
    await assert.rejects(service.run(album.id, 25, "test"), /outage/);
    assert.equal((await service.status(album.id)).assessments.length, 5);
    assert.deepEqual(album, before);
    fail = false;
    service = new QuickPreview(lib, auth);
    const job = await service.run(album.id, 25, "test");
    assert.equal(analysis, 1);
    assert.equal(curation, 2);
    assert.deepEqual(
      job.selected,
      album.photos.map((p) => p.id),
    );
    assert.equal(job.target, 25);
    assert.deepEqual(album, before);
    album.genre = "Wedding & engagement";
    assert.equal((await service.status(album.id)).stale, true);
    await assert.rejects(service.run(album.id, 25, "test"), /changed/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("showcase validates membership/count/scores and provides guidance for every album type", () => {
  assert.throws(
    () => validateSelection('{"ids":["a","a"]}', ["a", "b"], 2),
    /count/,
  );
  assert.throws(
    () => validateSelection('{"ids":["outside"]}', ["a"], 1),
    /count/,
  );
  assert.throws(
    () =>
      validateAssessments(
        JSON.stringify({
          photos: [{ id: "a", score: 101, moment: "m", reason: "r" }],
        }),
        ["a"],
      ),
    /Invalid/,
  );
  for (const genre of [
    "Wedding & engagement",
    "Portraits",
    "Family & newborn",
    "Events",
    "Sports & action",
    "Landscape & travel",
    "Other",
  ])
    assert.ok(genreGuidance(genre).length > 100);
  assert.match(genreGuidance("Wedding & engagement"), /ceremony/);
  assert.match(genreGuidance("Landscape & travel"), /scenery/);
});
test("preview export writes only explicitly chosen photos, regardless of culling category", async () => {
  const { root, lib, album } = await fixture();
  try {
    const ids = album.photos.slice(2, 4).map((p) => p.id),
      result = await lib.export(
        album.id,
        { scope: "ids", ids, format: "jpeg", maxSize: "2400" },
        root,
      );
    assert.equal(result.written, 2);
    assert.equal(result.failures.length, 0);
    const names = await fs.readdir(result.folder);
    assert.equal(names.filter((n) => n.endsWith(".jpg")).length, 2);
    await assert.rejects(
      lib.export(
        album.id,
        { scope: "ids", ids: ["outside"], format: "jpeg", maxSize: "2400" },
        root,
      ),
      /Invalid/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("social crops stay vertical after rotation and every social export has exact canvas dimensions", async () => {
  const { ratioCrop, targetRatio } = require("../electron/crop.cjs"),
    { render } = require("../electron/analysis.cjs"),
    { validateEdits } = require("../electron/library.cjs");
  const presets = require("../electron/export-presets.json");
  const source = await sharp({
    create: { width: 300, height: 200, channels: 3, background: "#a03060" },
  })
    .jpeg()
    .toBuffer();
  for (const mode of ["9:16", "4:5-portrait"])
    for (const rotation of [0, 90]) {
      const edits = validateEdits({
        rotation,
        cropRatio: mode,
        cropRect: ratioCrop(
          { x: 0.1, y: 0.1, width: 0.7, height: 0.6 },
          mode,
          1.5,
          rotation,
        ),
      });
      const meta = await sharp(await render(source, edits)).metadata(),
        wanted = mode === "9:16" ? 9 / 16 : 4 / 5;
      assert.ok(Math.abs(meta.width / meta.height - wanted) < 0.015);
      assert.ok(meta.height > meta.width);
    }
  const { root, lib, album } = await fixture();
  try {
    for (const [key, preset] of Object.entries(presets)) {
      const result = await lib.export(
        album.id,
        {
          scope: "ids",
          ids: [album.photos[0].id],
          format: "jpeg",
          preset: key,
        },
        root,
      );
      assert.equal(result.written, 1);
      const file = (await fs.readdir(result.folder)).find((f) =>
          f.endsWith(".jpg"),
        ),
        m = await sharp(path.join(result.folder, file)).metadata();
      assert.equal(m.width, preset.width);
      assert.equal(m.height, preset.height);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("showcase Apply markers reflect committed edits and reset after per-photo Undo", async () => {
  const { root, lib, album } = await fixture();
  try {
    const service = new QuickPreview(lib, {}),
      photo = album.photos[0],
      baseline = structuredClone(photo.edits),
      { fingerprint } = require("../electron/ai.cjs"),
      { validateEdits } = require("../electron/library.cjs");
    await service.write(album.id, {
      model: "test",
      genre: album.genre,
      fingerprint: fingerprint(album),
      selected: [photo.id],
      applied: [],
      assessments: [],
    });
    const changed = validateEdits({ ...baseline, exposure: 0.5 });
    await service.applied(
      album.id,
      [photo.id],
      [{ id: photo.id, edits: changed }],
    );
    assert.equal((await service.status(album.id)).applied.length, 0);
    photo.edits = changed;
    assert.equal((await service.status(album.id)).applied.length, 1);
    photo.edits = baseline;
    assert.equal((await service.status(album.id)).applied.length, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("omitted showcase assessments are saved individually and only missing photos are retried", async () => {
  const { root, lib, album } = await fixture();
  try {
    const calls = [];
    let initial = true;
    const auth = {
      models: async () => [{ id: "test" }],
      respond: async (body) => {
        if (!body.instructions.includes("Examine EVERY"))
          return JSON.stringify({ ids: album.photos.map((p) => p.id) });
        const ids = body.input[0].content
          .filter((c) => c.type === "input_text")
          .map((c) => c.text.slice("Image id: ".length));
        calls.push(ids);
        const chosen = initial ? ((initial = false), ids.slice(0, 3)) : ids;
        return JSON.stringify({
          photos: chosen.map((id) => ({
            id,
            score: 80,
            moment: "Distinct moment",
            reason: "Strong frame",
          })),
        });
      },
    };
    const result = await new QuickPreview(lib, auth).run(album.id, 25, "test");
    assert.equal(result.assessments.length, 5);
    assert.deepEqual(
      calls.map((c) => c.length),
      [5, 2],
    );
    assert.deepEqual(
      calls[1],
      album.photos.slice(3).map((p) => p.id),
    );
    assert.equal(new Set(result.assessments.map((p) => p.id)).size, 5);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("malformed repeated responses stop after bounded recovery and preserve valid partial assessments across restart", async () => {
  const { root, lib, album } = await fixture();
  try {
    let first = true,
      bad = true,
      calls = 0;
    const auth = {
      models: async () => [{ id: "test" }],
      respond: async (body) => {
        if (!body.instructions.includes("Examine EVERY"))
          return JSON.stringify({ ids: album.photos.map((p) => p.id) });
        calls++;
        const ids = body.input[0].content
          .filter((c) => c.type === "input_text")
          .map((c) => c.text.slice("Image id: ".length));
        if (first) {
          first = false;
          return JSON.stringify({
            photos: ids
              .slice(0, 4)
              .map((id) => ({ id, score: 70, moment: "m", reason: "r" })),
          });
        }
        if (bad) return "not JSON";
        assert.equal(ids.length, 1);
        return JSON.stringify({
          photos: ids.map((id) => ({
            id,
            score: 75,
            moment: "m",
            reason: "r",
          })),
        });
      },
    };
    let service = new QuickPreview(lib, auth);
    await assert.rejects(
      service.run(album.id, 25, "test"),
      /Completed assessments are saved/,
    );
    assert.equal(calls, 4);
    assert.equal((await service.status(album.id)).assessments.length, 4);
    assert.equal(lib.busy, false);
    bad = false;
    service = new QuickPreview(lib, auth);
    const result = await service.run(album.id, 25, "test");
    assert.equal(calls, 5);
    assert.equal(result.assessments.length, 5);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("final showcase retries invalid counts without repeating visual analysis", async () => {
  const { root, lib, album } = await fixture();
  try {
    let visual = 0,
      final = 0;
    const auth = {
      models: async () => [{ id: "test" }],
      respond: async (body) => {
        if (body.instructions.includes("Examine EVERY")) {
          visual++;
          return JSON.stringify({
            photos: album.photos.map((p) => ({
              id: p.id,
              score: 80,
              moment: "m",
              reason: "r",
            })),
          });
        }
        final++;
        return JSON.stringify({
          ids: album.photos.slice(0, final === 1 ? 4 : 5).map((p) => p.id),
        });
      },
    };
    const result = await new QuickPreview(lib, auth).run(album.id, 25, "test");
    assert.equal(result.selected.length, 5);
    assert.equal(visual, 1);
    assert.equal(final, 2);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test(
  "showcase speed 24 permits three groups of eight photos in flight and reports completion grouping",
  { timeout: 5000 },
  async () => {
    const { root, lib, album } = await fixture();
    let release;
    try {
      const buffer = await fs.readFile(
        path.join(lib.cache, album.photos[0].id + ".jpg"),
      );
      for (let i = 5; i < 32; i++) {
        const p = structuredClone(album.photos[0]);
        p.id = "photo-" + i;
        p.name = p.id + ".jpg";
        album.photos.push(p);
        await fs.writeFile(path.join(lib.cache, p.id + ".jpg"), buffer);
      }
      let active = 0,
        max = 0,
        started;
      const ready = new Promise((r) => (started = r)),
        gate = new Promise((r) => (release = r)),
        progress = [];
      const auth = {
        models: async () => [{ id: "test" }],
        respond: async (body) => {
          if (!body.instructions.includes("Examine EVERY"))
            return JSON.stringify({
              ids: album.photos.slice(0, 25).map((p) => p.id),
            });
          const ids = body.input[0].content
            .filter((c) => c.type === "input_text")
            .map((c) => c.text.slice("Image id: ".length));
          active += ids.length;
          max = Math.max(max, active);
          if (active === 24) started();
          await gate;
          active -= ids.length;
          return JSON.stringify({
            photos: ids.map((id) => ({
              id,
              score: 80,
              moment: "m",
              reason: "r",
            })),
          });
        },
      };
      const running = new QuickPreview(lib, auth).run(
        album.id,
        25,
        "test",
        (p) => progress.push(p),
        "",
        24,
      );
      await ready;
      assert.equal(max, 24);
      release();
      const result = await running;
      assert.equal(result.selected.length, 25);
      assert.ok(max <= 24);
      assert.match(progress[0].file, /24 photos.*groups of 8/);
    } finally {
      release?.();
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);

const { test } = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  sharp = require("sharp");
const { Library } = require("../electron/library.cjs");
const { AIEditBatch } = require("../electron/ai-edit-batch.cjs");
const response = {
  exposure: 0.2,
  contrast: 8,
  saturation: 4,
  temperature: 2,
  cropRect: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
  reason: "Synthetic batch recommendation",
  confidence: 0.9,
};
response.advanced = {
  ...Object.fromEntries(
    Object.entries(require("../electron/edit-controls.json"))
      .filter(
        ([key, c]) =>
          ["Light", "Color", "Color mixer", "Color grading"].includes(
            c.group,
          ) || ["texture", "clarity", "dehaze"].includes(key),
      )
      .map(([key, c]) => [key, c.default]),
  ),
  ...response.advanced,
};
response.denoiseAmount = 85;

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openshoot-batch-")),
    lib = await new Library(path.join(root, "db")).init(),
    album = await lib.create("Test batch", "Sports & action"),
    files = [];
  for (let i = 0; i < 5; i++) {
    const file = path.join(root, i + ".jpg");
    await sharp({
      create: {
        width: 80,
        height: 60,
        channels: 3,
        background: { r: 40 + i * 20, g: 80, b: 100 },
      },
    })
      .jpeg()
      .toFile(file);
    files.push(file);
  }
  await lib.import(album.id, files);
  await lib.patch(
    album.id,
    album.photos.slice(0, 4).map((p) => p.id),
    {
      category: "Selected",
      rating: 4,
      edits: {
        exposure: 3,
        contrast: 100,
        highlights: 100,
        monochrome: true,
        rotation: 90,
        crop: "4:5",
      },
    },
  );
  return { root, lib, album: lib.album(album.id) };
}
test("batch runs two at a time, checkpoints partial success, resumes without repeats, stages safely, applies atomically and preserves culling", async () => {
  const { root, lib, album } = await fixture();
  try {
    const ids = album.photos
        .filter((p) => p.category === "Selected")
        .map((p) => p.id),
      before = structuredClone(album);
    let calls = 0,
      active = 0,
      max = 0,
      fail = true;
    const auth = {
      models: async () => [{ id: "test" }],
      respond: async () => {
        calls++;
        active++;
        max = Math.max(max, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        if (fail && calls <= 2) throw Error("Simulated outage");
        return JSON.stringify(response);
      },
    };
    // Make just the second request in the first group fail.
    auth.respond = async () => {
      const call = ++calls;
      active++;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      if (fail && call === 2) throw Error("Simulated outage");
      return JSON.stringify(response);
    };
    let batch = new AIEditBatch(lib, auth);
    await assert.rejects(
      batch.run(album.id, ids, "test", "both", () => {}, "free", 2),
      /saved/,
    );
    assert.equal((await batch.status(album.id)).done, 1);
    assert.deepEqual(album, before);
    assert.equal(lib.busy, false);
    assert.equal(max, 2);
    // Recreate the service to simulate reopening the app.
    batch = new AIEditBatch(lib, auth);
    fail = false;
    const job = await batch.run(album.id, ids, "test", "both");
    assert.equal(job.done, 4);
    assert.equal(calls, 5);
    assert.deepEqual(album, before);
    const snapshot = structuredClone(album);
    const result = await batch.apply(
      album.id,
      job.results.map((p) => p.id),
    );
    for (const photo of result.photos) {
      const old = before.photos.find((p) => p.id === photo.id);
      assert.equal(photo.category, old.category);
      assert.equal(photo.rating, old.rating);
      if (ids.includes(photo.id)) {
        assert.equal(photo.edits.exposure, 0.2);
        assert.equal(photo.edits.highlights, 0);
        assert.equal(photo.edits.monochrome, false);
        assert.equal(photo.edits.rotation, 90);
      } else assert.deepEqual(photo, old);
    }
    assert.equal(await batch.status(album.id), null);
    // Equivalent album snapshot used by the main process Undo wrapper.
    lib.db.albums[0] = snapshot;
    await lib.save();
    const reopened = await new Library(lib.root).init();
    assert.deepEqual(reopened.album(album.id), before);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("pause aborts in-flight requests, retains finished results, and blocks conflicting work", async () => {
  const { root, lib, album } = await fixture();
  try {
    let started;
    const ready = new Promise((r) => (started = r));
    const auth = {
      models: async () => [{ id: "test" }],
      respond: async (_, signal) => {
        started();
        return new Promise((resolve, reject) => {
          if (signal.aborted) return reject(Error("aborted"));
          signal.addEventListener("abort", () => reject(Error("aborted")), {
            once: true,
          });
        });
      },
    };
    const batch = new AIEditBatch(lib, auth),
      running = batch.run(
        album.id,
        album.photos.map((p) => p.id),
        "test",
        "crop",
      );
    await ready;
    await assert.rejects(batch.discard(album.id), /wait/);
    await assert.rejects(batch.run(album.id, [], "test", "crop"), /wait/);
    batch.pause();
    await assert.rejects(running, /paused/);
    assert.equal(lib.busy, false);
    assert.equal((await batch.status(album.id)).done, 0);
    await batch.discard(album.id);
    assert.equal(await batch.status(album.id), null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("stale or invalid results cannot partially overwrite edits; crop-only preserves the saved look", async () => {
  const { root, lib, album } = await fixture();
  try {
    const batch = new AIEditBatch(lib, {
        models: async () => [{ id: "test" }],
        respond: async () => JSON.stringify(response),
      }),
      ids = album.photos.slice(0, 2).map((p) => p.id),
      job = await batch.run(album.id, ids, "test", "crop");
    assert.equal(job.results[0].edits.highlights, 100);
    assert.equal(job.results[0].edits.monochrome, true);
    await lib.patch(album.id, [ids[1]], { edits: { exposure: -2 } });
    const current = structuredClone(lib.album(album.id));
    await assert.rejects(batch.apply(album.id, ids), /changed/);
    assert.deepEqual(lib.album(album.id), current);
    await assert.rejects(batch.run(album.id, ids, "test", "crop"), /changed/);
    await batch.discard(album.id);
    await batch.run(album.id, ids, "test", "edit");
    const saved = await batch.read(album.id);
    saved.results[1].edits.cropRect = { x: 1, y: 1, width: 1, height: 1 };
    await batch.write(album.id, saved);
    await assert.rejects(batch.apply(album.id, ids), /Invalid crop/);
    assert.deepEqual(lib.album(album.id), current);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("batch framing is checkpointed, enforced for every photo and cannot change during resume", async () => {
  const { root, lib, album } = await fixture();
  try {
    const ids = album.photos.slice(0, 2).map((p) => p.id);
    const auth = {
      models: async () => [{ id: "test" }],
      respond: async (body) => {
        assert.match(body.input[0].content[0].text, /width MUST equal/);
        return JSON.stringify({
          ...response,
          cropRect: { x: 0.5, y: 0.1, width: 0.3, height: 0.6 },
        });
      },
    };
    const batch = new AIEditBatch(lib, auth),
      job = await batch.run(
        album.id,
        ids,
        "test",
        "crop",
        () => {},
        "original",
      );
    assert.equal(job.cropMode, "original");
    for (const r of job.results) {
      assert.equal(r.edits.cropRatio, "original");
      assert.equal(r.edits.cropRect.width, r.edits.cropRect.height);
    }
    assert.equal(
      (await new AIEditBatch(lib, auth).status(album.id)).cropMode,
      "original",
    );
    await assert.rejects(
      batch.run(album.id, ids, "test", "crop", () => {}, "free"),
      /saved model/,
    );
    const applied = await batch.apply(album.id, ids);
    for (const p of applied.photos.filter((p) => ids.includes(p.id)))
      assert.equal(p.edits.cropRatio, "original");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("print ratio survives batch checkpoint and apply; another ratio requires a new batch", async () => {
  const { root, lib, album } = await fixture();
  try {
    const batch = new AIEditBatch(lib, {
        models: async () => [{ id: "test" }],
        respond: async (body) => {
          assert.match(body.input[0].content[0].text, /framing ratio 4:5/);
          return JSON.stringify(response);
        },
      }),
      ids = album.photos.slice(0, 2).map((p) => p.id);
    const job = await batch.run(album.id, ids, "test", "crop", () => {}, "4:5");
    assert.equal(job.cropMode, "4:5");
    for (const r of job.results) assert.equal(r.edits.cropRatio, "4:5");
    await assert.rejects(
      batch.run(album.id, ids, "test", "crop", () => {}, "16:9"),
      /saved model/,
    );
    const result = await batch.apply(album.id, ids);
    for (const p of result.photos.filter((p) => ids.includes(p.id)))
      assert.equal(p.edits.cropRatio, "4:5");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

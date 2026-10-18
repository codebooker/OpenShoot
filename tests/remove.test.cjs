const { test } = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  sharp = require("sharp");
const { Library } = require("../electron/library.cjs"),
  { restoreAlbum } = require("../electron/history.cjs");
test("album removal is persistent, preserves originals and previews, and undo restores edits/order alongside later imports", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openshoot-remove-"));
  try {
    const lib = await new Library(path.join(root, "db")).init(),
      a = await lib.create("Remove test", "Other"),
      files = [];
    for (let i = 0; i < 3; i++) {
      const file = path.join(root, i + ".jpg");
      await sharp({
        create: {
          width: 64,
          height: 48,
          channels: 3,
          background: { r: 50 + i * 10, g: 70, b: 90 },
        },
      })
        .jpeg()
        .toFile(file);
      files.push(file);
    }
    await lib.import(a.id, files.slice(0, 2));
    await lib.patch(a.id, [a.photos[0].id], {
      rating: 5,
      edits: { exposure: 0.5 },
    });
    const snapshot = structuredClone(a),
      original = await fs.readFile(files[0]),
      removed = snapshot.photos[0];
    await assert.rejects(lib.remove(a.id, [removed.id, "missing"]), /existing/);
    assert.deepEqual(a, snapshot);
    await lib.remove(a.id, [removed.id]);
    assert.equal(a.photos.length, 1);
    assert.deepEqual(await fs.readFile(files[0]), original);
    await fs.access(path.join(lib.cache, removed.id + ".jpg"));
    const reopened = await new Library(lib.root).init();
    assert.equal(reopened.album(a.id).photos.length, 1);
    await lib.import(a.id, [files[2]]);
    const restored = restoreAlbum(snapshot, a);
    assert.deepEqual(restored.photos.slice(0, 2), snapshot.photos);
    assert.equal(restored.photos.length, 3);
    const reimported = {
      ...a,
      photos: [...a.photos, { ...removed, id: "new-id-for-same-source" }],
    };
    assert.equal(
      restoreAlbum(snapshot, reimported).photos.filter(
        (p) => p.path === removed.path,
      ).length,
      1,
    );
    lib.db.albums[0] = restored;
    await lib.save();
    assert.equal(
      (await new Library(lib.root).init()).album(a.id).photos[0].rating,
      5,
    );
    await lib.remove(
      a.id,
      restored.photos.map((p) => p.id),
    );
    assert.equal(restored.photos.length, 0);
    for (const file of files) await fs.access(file);
    await lib.import(a.id, [files[0]]);
    assert.equal(restored.photos.length, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

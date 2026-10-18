const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  sharp = require("sharp");
const { matchSet, validateMatch } = require("../electron/set-matching.cjs"),
  { defaultEdits } = require("../electron/analysis.cjs");
const keys = [
  "exposure",
  "contrast",
  "saturation",
  "temperature",
  "tint",
  "vibrance",
  "highlights",
  "shadows",
  "whites",
  "blacks",
];
test("matching checkpoints lighting groups, resumes and preserves geometry, noise and individual edits", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openshoot-match-"));
  try {
    const photos = Array.from({ length: 7 }, (_, i) => ({
      id: "p" + i,
      name: `IMG_000${i}.jpg`,
    }));
    const buffer = await sharp({
      create: { width: 80, height: 60, channels: 3, background: "#807060" },
    })
      .jpeg()
      .toBuffer();
    for (const p of photos)
      await fs.writeFile(path.join(root, p.id + ".jpg"), buffer);
    const lib = {
        cache: root,
        photo: (a, id) => photos.find((p) => p.id === id),
      },
      job = {
        albumId: "a",
        model: "test",
        entries: photos.map((p) => ({ id: p.id })),
        results: photos.map((p) => ({
          id: p.id,
          edits: {
            ...defaultEdits(),
            cropRect: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
            noiseReduction: 15,
          },
          reason: "Individual",
          confidence: 0.9,
        })),
      };
    let calls = 0,
      saves = 0;
    const auth = {
      respond: async (body) => {
        calls++;
        const entries = body.input[0].content
            .filter((c) => c.type === "input_text")
            .map((c) => JSON.parse(c.text)),
          ids = entries.filter((e) => !e.referenceOnly),
          ref = entries.find((e) => e.referenceOnly) || ids[0];
        return JSON.stringify({
          photos: ids.map((e) => ({
            id: e.id,
            reference: ref.id,
            controls: {
              ...e.controls,
              exposure: e.controls.exposure + (e.id === ref.id ? 0 : 0.1),
            },
            reason: "Same field lighting",
          })),
        });
      },
    };
    const controller = new AbortController();
    await assert.rejects(
      matchSet(
        lib,
        auth,
        job,
        async () => {
          saves++;
        },
        (p) => {
          if (p.done === 6) controller.abort();
        },
        controller.signal,
      ),
      /paused/,
    );
    assert.equal(job.matchDone.length, 6);
    assert.equal(calls, 1);
    assert.equal(saves, 1);
    const snapshot = structuredClone(job.results.slice(0, 6));
    await matchSet(
      lib,
      auth,
      job,
      async () => {
        saves++;
      },
      () => {},
    );
    assert.equal(calls, 2);
    assert.equal(job.matchDone.length, 7);
    assert.deepEqual(job.results.slice(0, 6), snapshot);
    for (const r of job.results) {
      assert.equal(r.edits.noiseReduction, 15);
      assert.deepEqual(r.edits.cropRect, r.individualEdits.cropRect);
      assert.equal(r.individualEdits.exposure, 0);
    }
    assert.equal(job.results[6].matching.reference, "p0");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("matching rejects missing photos, excessive changes and changed references", () => {
  const base = Object.fromEntries(keys.map((k) => [k, 0])),
    bases = new Map([["p", base]]),
    row = { id: "p", reference: "p", controls: base, reason: "Reference" };
  assert.equal(validateMatch({ photos: [row] }, ["p"], ["p"], bases)[0], row);
  assert.throws(
    () => validateMatch({ photos: [] }, ["p"], ["p"], bases),
    /omitted/,
  );
  assert.throws(
    () =>
      validateMatch(
        { photos: [{ ...row, reference: "unknown" }] },
        ["p"],
        ["p"],
        bases,
      ),
    /Invalid/,
  );
  assert.throws(
    () =>
      validateMatch(
        { photos: [{ ...row, controls: { ...base, exposure: 2 } }] },
        ["p"],
        ["p"],
        bases,
      ),
    /limit/,
  );
  assert.throws(
    () =>
      validateMatch(
        { photos: [{ ...row, controls: { ...base, exposure: 0.1 } }] },
        ["p"],
        ["p"],
        bases,
      ),
    /Reference/,
  );
});

test("both workflows refuse Apply while matching is incomplete", async () => {
  const { AIEditBatch } = require("../electron/ai-edit-batch.cjs");
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "openshoot-match-apply-"),
  );
  try {
    const lib = { root, busy: false, album: () => ({ id: "a" }) };
    for (const prefix of ["ai-edit-", "quick-edit-"]) {
      const batch = new AIEditBatch(lib, {}, prefix);
      await batch.write("a", {
        entries: [{ id: "p" }],
        results: [{ id: "p" }],
        matchSet: true,
        matchDone: [],
        finishRequested: false,
      });
      await assert.rejects(batch.apply("a", ["p"]), /Finish set matching/);
      assert.equal(lib.busy, false);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  sharp = require("sharp");
const { Library } = require("../electron/library.cjs"),
  { AIEditBatch } = require("../electron/ai-edit-batch.cjs"),
  { validate } = require("../electron/ai-edit.cjs");
const response = {
  exposure: 0.3,
  contrast: 5,
  saturation: 3,
  temperature: 2,
  cropRect: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
  reason: "Natural balanced result",
  confidence: 0.9,
  advanced: { highlights: -30, shadows: 25, vibrance: 8 },
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openshoot-finish-")),
    lib = await new Library(root).init(),
    album = await lib.create("Test", "Sports & action");
  const buffer = await sharp({
    create: { width: 100, height: 60, channels: 3, background: "#705050" },
  })
    .jpeg()
    .toBuffer();
  for (let i = 0; i < 2; i++) {
    const file = path.join(root, i + ".jpg");
    await fs.writeFile(file, buffer);
    await lib.import(album.id, [file]);
  }
  album.photos[0].path = path.join(root, "raw.CR3");
  await fs.writeFile(album.photos[0].path, buffer);
  return { root, lib, album };
}
test("full Quick Preview stages denoise and detail with advanced tone controls, checkpoints and resumes without repeating AI or GPU", async () => {
  const { root, lib, album } = await fixture();
  try {
    let calls = 0,
      gpu = 0;
    const before = structuredClone(album),
      auth = {
        models: async () => [{ id: "test" }],
        respond: async (body) => {
          calls++;
          assert.match(body.instructions, /Also return advanced/);
          return JSON.stringify(response);
        },
      };
    lib.denoiser = {
      input: async (photo) => path.join(lib.cache, photo.id + ".jpg"),
      generate: async (p, progress, ownsLock) => {
        assert.equal(lib.busy, true);
        assert.equal(ownsLock, true);
        gpu++;
        return { key: "a".repeat(64) };
      },
    };
    const batch = new AIEditBatch(lib, auth, "quick-edit-"),
      ids = album.photos.map((p) => p.id),
      result = await batch.run(album.id, ids, "test", "both");
    assert.equal(calls, 2);
    assert.equal(gpu, 1);
    assert.equal(result.finishing, false);
    assert.equal(result.results[0].edits.highlights, -30);
    assert.ok(result.results.some((r) => r.edits.aiDenoise === 85));
    assert.ok(result.results.some((r) => r.edits.noiseReduction === 15));
    assert.ok(result.results.every((r) => r.edits.sharpening === 20));
    assert.deepEqual(album, before);
    assert.equal((await batch.status(album.id)).stale, undefined);
    auth.models = async () => {
      throw Error("Finishing should work offline");
    };
    await batch.run(album.id, ids, "test", "both");
    assert.equal(calls, 2);
    assert.equal(gpu, 1);
    await batch.apply(album.id, ids);
    assert.ok(album.photos.some((p) => p.edits.aiDenoise === 85));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("RAW fallback is explicit; pause preserves completed finishing and does not apply drafts", async () => {
  const { root, lib, album } = await fixture();
  try {
    const auth = {
        models: async () => [{ id: "test" }],
        respond: async () => JSON.stringify(response),
      },
      batch = new AIEditBatch(lib, auth, "quick-edit-");
    lib.denoiser = {
      generate: async () => {
        throw Error("Unsupported sensor");
      },
    };
    const result = await batch.run(
      album.id,
      album.photos.map((p) => p.id),
      "test",
      "both",
    );
    const raw = result.results.find((r) => r.id === album.photos[0].id);
    assert.match(raw.finish.warning, /Unsupported sensor/);
    assert.equal(raw.edits.noiseReduction, 15);
    assert.equal(raw.edits.rawDenoiseKey, undefined);
    await batch.discard(album.id);
    let finished = 0;
    await assert.rejects(
      batch.run(
        album.id,
        album.photos.map((p) => p.id),
        "test",
        "both",
        (p) => {
          if (p.phase === "Denoising & finishing previews" && p.done === 1) {
            finished++;
            batch.pause();
          }
        },
      ),
      /paused/,
    );
    assert.equal(finished, 1);
    assert.ok(
      Object.values((await batch.read(album.id)).prepared).some(
        (r) => r.finish?.status === "done",
      ),
    );
    assert.equal(lib.busy, false);
    assert.equal(album.photos[0].edits.aiDenoise, undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("AI advanced controls reject unknown, nonnumeric and out-of-range adjustments", () => {
  const base = {
    exposure: 0,
    contrast: 0,
    saturation: 0,
    temperature: 0,
    crop: "original",
    rotation: 0,
    monochrome: false,
  };
  for (const advanced of [
    { highlights: 101 },
    { shadows: "20" },
    { arbitrary: 10 },
  ])
    assert.throws(
      () => validate(JSON.stringify({ ...response, advanced }), "both", base),
      /advanced/,
    );
  assert.equal(
    validate(JSON.stringify(response), "crop", base).edits.highlights,
    undefined,
  );
});

test("legacy half-strength finishing is upgraded to 85% clean output and versioned for resume", async () => {
  const { root, lib, album } = await fixture();
  try {
    const { finishQuick, isFinished } = require("../electron/quick-finish.cjs");
    const result = {
      id: album.photos[0].id,
      edits: {
        ...album.photos[0].edits,
        rawDenoiseKey: "b".repeat(64),
        aiDenoise: 50,
      },
      finish: { status: "done", method: "AI RAW denoise" },
    };
    assert.equal(isFinished(result), false);
    let saved = 0;
    lib.busy = true;
    lib.denoiser = { generate: async () => ({ key: "b".repeat(64) }) };
    await finishQuick(
      lib,
      { albumId: album.id, results: [result] },
      async () => saved++,
      () => {},
      new AbortController().signal,
    );
    assert.equal(result.edits.aiDenoise, 85);
    assert.equal(result.finish.strength, 85);
    assert.equal(result.finish.version, 3);
    assert.equal(isFinished(result), true);
    assert.equal(saved, 1);
    assert.equal(lib.busy, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("an applied showcase can stage 85% re-finishing without changing saved edits or repeating AI selection", async () => {
  const { root, lib, album } = await fixture();
  try {
    const { QuickPreview } = require("../electron/quick-preview.cjs");
    album.photos[0].edits = {
      ...album.photos[0].edits,
      exposure: 0.7,
      shadows: 35,
      aiDenoise: 50,
      rawDenoiseKey: "c".repeat(64),
    };
    const before = structuredClone(album),
      showcase = new QuickPreview(lib, {}),
      ids = album.photos.map((p) => p.id);
    await showcase.write(album.id, {
      model: "test",
      genre: album.genre,
      selected: ids,
      applied: ids,
      ids,
      assessments: [],
      target: 25,
      fingerprint: "old",
    });
    const edits = new AIEditBatch(
      lib,
      {
        models: async () => {
          throw Error("Must not call AI");
        },
      },
      "quick-edit-",
    );
    lib.denoiser = { generate: async () => ({ key: "c".repeat(64) }) };
    const staged = await showcase.refinish(album.id, edits);
    assert.deepEqual(album, before);
    assert.equal((await showcase.status(album.id)).stale, false);
    assert.deepEqual((await showcase.status(album.id)).applied, []);
    const result = await edits.run(
      album.id,
      ids,
      staged.model,
      staged.mode,
      () => {},
      staged.cropMode,
    );
    assert.equal(result.results[0].edits.exposure, 0.7);
    assert.equal(result.results[0].edits.shadows, 35);
    assert.equal(result.results[0].edits.aiDenoise, 85);
    assert.equal(result.results[0].localOnly, true);
    assert.deepEqual(album, before);
    await assert.rejects(showcase.refinish(album.id, edits), /pending/);
    await fs.rm(edits.file(album.id));
    for (const p of album.photos) p.edits.cropRatio = "1:1";
    const reevaluated = await showcase.refinish(album.id, edits, true);
    assert.equal(reevaluated.cropMode, "1:1");
    assert.deepEqual(reevaluated.results, []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Quick Preview AI sees the actual clean RAW source, not the original camera JPEG or prior saved edits", async () => {
  const { root, lib, album } = await fixture();
  try {
    const clean = path.join(root, "clean-preview.jpg");
    await sharp({
      create: { width: 120, height: 80, channels: 3, background: "#0000ee" },
    })
      .jpeg()
      .toFile(clean);
    lib.denoiser = {
      generate: async () => ({ key: "d".repeat(64) }),
      input: async () => clean,
    };
    let inspected = false;
    const auth = {
      models: async () => [{ id: "test" }],
      respond: async (body) => {
        assert.match(
          body.instructions,
          /actual locally denoised RAW rendering/,
        );
        const image = body.input[0].content.find(
            (c) => c.type === "input_image",
          ),
          buffer = Buffer.from(image.image_url.split(",")[1], "base64"),
          stats = await sharp(buffer).stats();
        assert.ok(stats.channels[2].mean > 220);
        assert.ok(stats.channels[0].mean < 10);
        assert.match(
          body.input[0].content[0].text,
          /width \/ cropRect.height = 0.666667/,
        );
        inspected = true;
        return JSON.stringify(response);
      },
    };
    const job = await new AIEditBatch(lib, auth, "quick-edit-").run(
      album.id,
      [album.photos[0].id],
      "test",
      "both",
      () => {},
      "1:1",
    );
    assert.equal(inspected, true);
    assert.equal(job.results[0].editInput, "denoised-raw");
    assert.equal(job.results[0].edits.aiDenoise, 85);
    assert.equal(album.photos[0].edits.rawDenoiseKey, undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("invalid AI crop gets one corrective retry without accepting unsafe coordinates", async () => {
  const { root, lib, album } = await fixture();
  try {
    const { analyze } = require("../electron/ai-edit.cjs");
    let calls = 0;
    const auth = {
      respond: async (body) => {
        calls++;
        if (calls === 1)
          return JSON.stringify({
            ...response,
            cropRect: { x: 0.9, y: 0.9, width: 0.5, height: 0.5 },
          });
        assert.match(body.instructions, /Recheck the JSON/);
        return JSON.stringify(response);
      },
    };
    const result = await analyze(
      lib,
      auth,
      album.id,
      album.photos[0].id,
      "test",
      "both",
    );
    assert.equal(calls, 2);
    assert.equal(result.edits.exposure, 0.3);
    calls = 0;
    await assert.rejects(
      analyze(
        lib,
        {
          respond: async () => {
            calls++;
            return JSON.stringify({
              ...response,
              cropRect: { x: 2, y: 0, width: 0.5, height: 0.5 },
            });
          },
        },
        album.id,
        album.photos[0].id,
        "test",
        "both",
      ),
      /Invalid AI crop/,
    );
    assert.equal(calls, 2);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("regular auto edit prepares RAW at 85%, accepts lighter denoise and color grading, checkpoints and applies it", async () => {
  const { root, lib, album } = await fixture();
  try {
    const photo = album.photos[0],
      seen = [];
    let generated = 0;
    lib.denoiser = {
      generate: async () => {
        generated++;
        return { key: "d".repeat(64) };
      },
      input: async (p, e) => {
        seen.push(e.aiDenoise);
        return path.join(lib.cache, p.id + ".jpg");
      },
    };
    const auth = {
      models: async () => [{ id: "test" }],
      respond: async (body) => {
        assert.match(body.instructions, /shadowGradeHue \[0,360\]/);
        assert.match(body.instructions, /redHue \[-100,100\]/);
        assert.match(body.instructions, /starts at 85%/);
        return JSON.stringify({
          ...response,
          exposure: 0,
          contrast: 0,
          denoiseAmount: 75,
          advanced: {
            ...response.advanced,
            redHue: 3,
            redSaturation: -4,
            shadowGradeHue: 220,
            shadowGradeSaturation: 4,
            highlightGradeHue: 40,
            highlightGradeSaturation: 2,
          },
        });
      },
    };
    const batch = new AIEditBatch(lib, auth);
    const job = await batch.run(album.id, [photo.id], "test", "both");
    assert.equal(generated, 1);
    assert.deepEqual(seen, [85, 0, 75]);
    assert.equal(job.results[0].edits.aiDenoise, 75);
    assert.equal(job.results[0].finish.strength, 75);
    assert.equal(job.results[0].edits.shadowGradeHue, 220);
    assert.equal(job.results[0].edits.redSaturation, -4);
    assert.equal(photo.edits.aiDenoise, undefined);
    await batch.apply(album.id, [photo.id]);
    assert.equal(lib.photo(album.id, photo.id).edits.aiDenoise, 75);
    assert.equal(
      lib.photo(album.id, photo.id).edits.highlightGradeSaturation,
      2,
    );
    for (const denoiseAmount of [75, 85, 90, 100])
      assert.equal(
        validate(
          JSON.stringify({ ...response, denoiseAmount }),
          "both",
          photo.edits,
        ).denoiseAmount,
        denoiseAmount,
      );
    for (const denoiseAmount of [0, 74, 86, 101, "85"])
      assert.throws(
        () =>
          validate(
            JSON.stringify({ ...response, denoiseAmount }),
            "both",
            photo.edits,
          ),
        /denoise/,
      );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("omitted color/advanced controls trigger correction instead of a silently incomplete suggestion", async () => {
  const { root, lib, album } = await fixture();
  try {
    const { analyze } = require("../electron/ai-edit.cjs");
    let calls = 0;
    const auth = {
      respond: async (body) => {
        calls++;
        if (calls === 1) {
          const { advanced, ...partial } = response;
          return JSON.stringify(partial);
        }
        assert.match(body.instructions, /missing fields are not accepted/);
        return JSON.stringify(response);
      },
    };
    const result = await analyze(
      lib,
      auth,
      album.id,
      album.photos[1].id,
      "test",
      "edit",
    );
    assert.equal(calls, 2);
    assert.equal(result.edits.shadowGradeSaturation, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("both auto edit and Quick Preview integrate optional matching after finishing and before Apply", async () => {
  for (const prefix of ["ai-edit-", "quick-edit-"])
    for (const enabled of [true, false]) {
      const { root, lib, album } = await fixture();
      try {
        lib.denoiser = {
          generate: async () => ({ key: "b".repeat(64) }),
          input: async (p) => path.join(lib.cache, p.id + ".jpg"),
        };
        let matchCalls = 0;
        const auth = {
          models: async () => [{ id: "test" }],
          respond: async (body) => {
            if (!body.instructions.startsWith("Match photographic"))
              return JSON.stringify(response);
            matchCalls++;
            const entries = body.input[0].content
              .filter((c) => c.type === "input_text")
              .map((c) => JSON.parse(c.text));
            const ref = entries[0];
            return JSON.stringify({
              photos: entries
                .filter((e) => !e.referenceOnly)
                .map((e) => ({
                  id: e.id,
                  reference: ref.id,
                  controls: {
                    ...e.controls,
                    temperature:
                      e.controls.temperature + (e.id === ref.id ? 0 : 2),
                  },
                  reason: "Match field lighting",
                })),
            });
          },
        };
        const batch = new AIEditBatch(lib, auth, prefix),
          before = structuredClone(album),
          ids = album.photos.map((p) => p.id);
        const result = await batch.run(
          album.id,
          ids,
          "test",
          "both",
          () => {},
          "free",
          2,
          true,
          enabled,
        );
        assert.equal(matchCalls, enabled ? 1 : 0);
        assert.equal(result.matchSet, enabled);
        assert.equal(result.matching, false);
        assert.deepEqual(album, before);
        assert.equal(
          result.results.find((r) => r.id === ids[0]).edits.aiDenoise,
          85,
        );
        if (enabled) {
          assert.ok(
            result.results.every((r) => r.matching && r.individualEdits),
          );
          assert.equal(
            result.results.find((r) => r.id === ids[1]).edits.temperature,
            response.temperature + 2,
          );
        }
        await batch.apply(album.id, ids);
        assert.equal(lib.photo(album.id, ids[0]).edits.aiDenoise, 85);
        assert.equal(
          lib.photo(album.id, ids[1]).edits.temperature,
          response.temperature + (enabled ? 2 : 0),
        );
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    }
});

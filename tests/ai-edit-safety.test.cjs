const { test } = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const {
  protectHighlights,
  addedClipping,
} = require("../electron/ai-edit-safety.cjs");
const { defaultEdits } = require("../electron/analysis.cjs");
test("AI highlight protection reduces global brightening of a lit subject against a dark background", async () => {
  const image = await sharp({
    create: { width: 160, height: 100, channels: 3, background: "#101020" },
  })
    .composite([
      {
        input: await sharp({
          create: { width: 80, height: 80, channels: 3, background: "#c8c0aa" },
        })
          .png()
          .toBuffer(),
        left: 40,
        top: 10,
      },
    ])
    .png()
    .toBuffer();
  const result = {
    edits: {
      ...defaultEdits(),
      exposure: 1.5,
      contrast: 20,
      highlights: -50,
      cropRect: { x: 0, y: 0, width: 1, height: 1 },
    },
    reason: "Lift the player",
    confidence: 0.9,
  };
  const protectedResult = await protectHighlights(image, result, "both");
  assert.ok(protectedResult.edits.exposure < 1.5);
  assert.ok(protectedResult.highlightProtection.addedClipping <= 0.005);
  assert.deepEqual(protectedResult.edits.cropRect, result.edits.cropRect);
  assert.equal(result.edits.exposure, 1.5);
  assert.match(protectedResult.reason, /Highlight protection/);
  assert.equal(await protectHighlights(image, result, "crop"), result);
});
test("highlight protection keeps restrained safe edits and does not count existing clipping as new", async () => {
  const image = await sharp({
    create: { width: 40, height: 40, channels: 3, background: "#606060" },
  })
    .png()
    .toBuffer();
  const result = {
    edits: { ...defaultEdits(), exposure: 0.1 },
    reason: "Small lift",
    confidence: 0.8,
  };
  assert.deepEqual(await protectHighlights(image, result, "edit"), result);
  assert.equal(
    addedClipping(Buffer.from([255, 255, 255]), Buffer.from([255, 255, 255])),
    0,
  );
  assert.equal(
    addedClipping(Buffer.from([200, 190, 150]), Buffer.from([255, 240, 200])),
    1,
  );
});

test("regular editing judges an enabled denoise source instead of the camera JPEG", async () => {
  const fs = require("node:fs/promises"),
    path = require("node:path"),
    os = require("node:os");
  const { analyze } = require("../electron/ai-edit.cjs");
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "openshoot-clean-source-"),
  );
  try {
    await sharp({
      create: { width: 60, height: 40, channels: 3, background: "#603020" },
    })
      .jpeg()
      .toFile(path.join(root, "p.jpg"));
    const clean = path.join(root, "clean.png");
    await sharp({
      create: { width: 60, height: 40, channels: 3, background: "#204060" },
    })
      .png()
      .toFile(clean);
    const photo = {
      id: "p",
      edits: {
        ...defaultEdits(),
        rawDenoiseKey: "a".repeat(64),
        aiDenoise: 100,
      },
    };
    const lib = {
      cache: root,
      ensurePreview: async () => {},
      album: () => ({ photos: [photo] }),
      denoiser: {
        input: async (p, e) => {
          assert.equal(e.aiDenoise, 100);
          return clean;
        },
      },
    };
    const auth = {
      respond: async (request) => {
        const content = request.input[0].content.find(
          (c) => c.type === "input_image",
        );
        const { channels } = await sharp(
          Buffer.from(content.image_url.split(",")[1], "base64"),
        ).stats();
        assert.ok(channels[2].mean > channels[0].mean);
        assert.match(request.instructions, /actual locally denoised RAW/);
        assert.match(request.instructions, /highlights \[.*shadows \[/);
        assert.match(request.instructions, /OpenShoot control calibration/);
        assert.match(request.input[0].content[0].text, /exposureOnlyEstimates/);
        return JSON.stringify({
          advanced: Object.fromEntries(
            Object.entries(require("../electron/edit-controls.json"))
              .filter(
                ([key, c]) =>
                  ["Light", "Color", "Color mixer", "Color grading"].includes(
                    c.group,
                  ) || ["texture", "clarity", "dehaze"].includes(key),
              )
              .map(([key, c]) => [key, c.default]),
          ),
          exposure: 0,
          contrast: 0,
          saturation: 0,
          temperature: 0,
          cropRect: { x: 0, y: 0, width: 1, height: 1 },
          reason: "Keep lighting",
          confidence: 0.8,
        });
      },
    };
    const result = await analyze(lib, auth, "a", "p", "test", "edit");
    assert.equal(result.edits.rawDenoiseKey, photo.edits.rawDenoiseKey);
    assert.equal(result.edits.aiDenoise, 100);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

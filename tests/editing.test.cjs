const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  Module = require("node:module");
const ts = require("typescript");
// Exercise the shipped TSX components directly; transpilation only removes types/JSX.
const compiled = new Map();
function loadTS(file) {
  if (compiled.has(file)) return compiled.get(file).exports;
  const mod = new Module(file, module);
  compiled.set(file, mod);
  mod.filename = file;
  mod.paths = Module._nodeModulePaths(path.dirname(file));
  mod.require = function (spec) {
    if (spec.startsWith(".")) {
      for (const ext of [".ts", ".tsx"]) {
        const candidate = path.resolve(path.dirname(file), spec + ext);
        if (fs.existsSync(candidate)) return loadTS(candidate);
      }
    }
    return Module.prototype.require.call(this, spec);
  };
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  mod._compile(source, file);
  return mod.exports;
}
test("editor sliders update the live image before Apply, queue only the newest drag value, and report rendering errors", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: "http://localhost",
  });
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require("react"),
    { act } = React,
    { createRoot } = require("react-dom/client");
  const { Editor } = loadTS(path.resolve("src/editor.tsx")),
    { Preview } = loadTS(path.resolve("src/preview.tsx")),
    { freshEdits } = loadTS(path.resolve("src/types.ts"));
  const requests = [],
    saves = [],
    errors = [];
  let rejectNext = false,
    block = null;
  window.openshoot = {
    preview: async (a, p, edits) => {
      requests.push(edits.exposure);
      if (block) await block;
      if (rejectNext) throw Error("fixture render failure");
      return "data:image/jpeg;base64,exposure-" + edits.exposure;
    },
  };
  const photo = { id: "fixture", edits: freshEdits() };
  function Harness() {
    const [edits, setEdits] = React.useState(photo.edits);
    return React.createElement(
      React.Fragment,
      null,
      React.createElement(Preview, {
        albumId: "album",
        photoId: photo.id,
        originalURL: "openshoot://cache/fixture.jpg",
        alt: "fixture",
        edits,
        onError: (message) => errors.push(message),
      }),
      React.createElement(Editor, {
        photo,
        edits,
        onChange: setEdits,
        onSave: async (value) => saves.push(value),
      }),
    );
  }
  const root = createRoot(document.getElementById("root"));
  const slider = () => document.querySelector('input[aria-label="Exposure"]');
  async function change(value) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      ).set.call(slider(), String(value));
      slider().dispatchEvent(new window.Event("input", { bubbles: true }));
    });
  }
  try {
    await act(async () => root.render(React.createElement(Harness)));
    await change(1);
    assert.equal(slider().value, "1");
    assert.equal(
      document.querySelector(".main-preview").getAttribute("src"),
      "data:image/jpeg;base64,exposure-1",
    );
    assert.equal(
      saves.length,
      0,
      "preview must not require or silently perform Apply",
    );
    let release;
    block = new Promise((r) => (release = r));
    await change(1.5);
    await change(2);
    await change(2.5);
    block = null;
    await act(async () => {
      release();
      await new Promise((r) => setTimeout(r, 0));
    });
    assert.equal(
      document.querySelector(".main-preview").getAttribute("src"),
      "data:image/jpeg;base64,exposure-2.5",
    );
    assert.ok(!requests.includes(2), "intermediate drag request is coalesced");
    await act(async () => {
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent.includes("Apply adjustments"))
        .click();
    });
    assert.equal(saves[0].exposure, 2.5);
    rejectNext = true;
    await change(3);
    assert.match(errors.at(-1), /fixture render failure/);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    delete global.window;
    delete global.document;
    delete global.HTMLElement;
    delete global.IS_REACT_ACT_ENVIRONMENT;
  }
});

test("pinch wheel zoom is bounded and prevents browser page zoom", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require("react"),
    { act } = React,
    { createRoot } = require("react-dom/client");
  const { ZoomSurface } = loadTS(path.resolve("src/zoom-surface.tsx"));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let zoom = 1;
  function Harness() {
    const [scale, setScale] = React.useState(1);
    return React.createElement(
      ZoomSurface,
      {
        scale,
        onScale: (n) => {
          zoom = n;
          setScale(n);
        },
      },
      React.createElement("img", { alt: "fixture" }),
    );
  }
  await act(async () => root.render(React.createElement(Harness)));
  const surface = container.querySelector(".zoom-surface");
  const pinch = new window.WheelEvent("wheel", {
    ctrlKey: true,
    deltaY: -60,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => surface.dispatchEvent(pinch));
  assert.ok(zoom > 1);
  assert.equal(pinch.defaultPrevented, true);
  await act(async () =>
    surface.dispatchEvent(
      new window.WheelEvent("wheel", {
        ctrlKey: true,
        deltaY: -10000,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  assert.equal(zoom, 8);
  await act(async () =>
    surface.dispatchEvent(
      new window.WheelEvent("wheel", {
        ctrlKey: true,
        deltaY: 10000,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  assert.equal(zoom, 1);
  await act(async () => root.unmount());
  container.remove();
});

test("AI panel prompts sign-in before showing controls and loads models after authorization", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require("react"),
    { act } = React,
    { createRoot } = require("react-dom/client");
  let account = { connected: false, enabled: false, pending: false, email: "" },
    signIns = 0,
    modelCalls = 0,
    listener;
  window.openshoot = {
    auth: async () => account,
    onAuth: (cb) => {
      listener = cb;
      return () => {};
    },
    models: async () => {
      modelCalls++;
      return [{ id: "mock", name: "Mock model" }];
    },
    signIn: async () => {
      signIns++;
      account = { ...account, connected: true, enabled: true };
      return account;
    },
  };
  const { AIEditor } = loadTS(path.resolve("src/ai-editor.tsx"));
  const root = createRoot(document.getElementById("root"));
  await act(async () =>
    root.render(
      React.createElement(AIEditor, {
        albumId: "a",
        photoId: "p",
        onPreview: () => {},
        onBefore: () => {},
      }),
    ),
  );
  const signIn = [...document.querySelectorAll("button")].find((b) =>
    b.textContent.includes("Sign in with ChatGPT"),
  );
  assert.ok(signIn);
  assert.equal(document.querySelectorAll("select").length, 0);
  assert.equal(modelCalls, 0);
  await act(async () => signIn.click());
  assert.equal(signIns, 1);
  assert.equal(modelCalls, 1);
  assert.match(document.body.textContent, /ChatGPT connected/);
  assert.equal(
    document.querySelector('[aria-label="ChatGPT model"]').value,
    "mock",
  );
  assert.equal(
    document.querySelector('[aria-label="AI task"]').children.length,
    3,
  );
  assert.equal(
    [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Suggest adjustments",
    ).disabled,
    true,
  );
  account = { ...account, connected: false, enabled: false };
  await act(async () => listener());
  assert.equal(document.querySelectorAll("select").length, 0);
  assert.match(document.body.textContent, /Sign in with ChatGPT/);
  await act(async () => root.unmount());
  dom.window.close();
});

test("AI task, model and preview sharing survive photo changes and remounts; Settings can revoke sharing", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require("react"),
    { act } = React,
    { createRoot } = require("react-dom/client");
  const { AIEditor } = loadTS(path.resolve("src/ai-editor.tsx"));
  const { updateAIPreferences } = loadTS(path.resolve("src/ai-preferences.ts"));
  let requests = 0;
  window.openshoot = {
    auth: async () => ({ connected: true, enabled: true }),
    onAuth: () => () => {},
    models: async () => [
      { id: "one", name: "First" },
      { id: "two", name: "Second" },
    ],
    aiEdit: async () => {
      requests++;
      return { edits: {}, reason: "Test suggestion", confidence: 0.9 };
    },
  };
  let root = createRoot(document.getElementById("root"));
  const renderPhoto = (pid) =>
    root.render(
      React.createElement(AIEditor, {
        key: pid,
        photoId: pid,
        albumId: "a",
        onPreview: () => {},
        onBefore: () => {},
      }),
    );
  await act(async () => renderPhoto("first"));
  await act(async () =>
    [...document.querySelectorAll('[aria-label="AI task"] button')]
      .find((b) => b.textContent === "Crop")
      .click(),
  );
  await act(async () => {
    const select = document.querySelector('[aria-label="ChatGPT model"]');
    select.value = "two";
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  await act(async () =>
    document.querySelector('input[type="checkbox"]').click(),
  );
  assert.equal(document.querySelector('input[type="checkbox"]'), null);
  await act(async () => {
    const framing = document.querySelector('[aria-label="Crop framing"]');
    framing.value = "original";
    framing.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  await act(async () => renderPhoto("second"));
  assert.equal(
    document.querySelector('[aria-label="Crop framing"]').value,
    "original",
  );
  assert.equal(
    document.querySelector('[aria-label="ChatGPT model"]').value,
    "two",
  );
  assert.equal(
    document.querySelector('[aria-pressed="true"]').textContent,
    "Crop",
  );
  const suggest = () =>
    [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Suggest adjustments",
    );
  assert.equal(suggest().disabled, false);
  await act(async () => suggest().click());
  assert.equal(requests, 1);
  assert.equal(suggest().disabled, false);
  await act(async () => root.unmount());
  root = createRoot(document.getElementById("root"));
  await act(async () => renderPhoto("third"));
  assert.equal(
    document.querySelector('[aria-label="ChatGPT model"]').value,
    "two",
  );
  assert.equal(suggest().disabled, false);
  await act(async () => updateAIPreferences({ sharePreviews: false }));
  assert.ok(document.querySelector('input[type="checkbox"]'));
  assert.equal(suggest().disabled, true);
  await act(async () => root.unmount());
  dom.window.close();
});

test("Advanced mode previews adjustments, keeps them in Basic, and persists the mode across photos", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require("react"),
    { act } = React,
    { createRoot } = require("react-dom/client");
  const { Editor } = loadTS(path.resolve("src/editor.tsx")),
    { freshEdits } = loadTS(path.resolve("src/types.ts"));
  let latest,
    saved = 0;
  const photo = { id: "test", edits: freshEdits() };
  function Harness({ pid }) {
    const [edits, setEdits] = React.useState(photo.edits);
    latest = edits;
    return React.createElement(Editor, {
      key: pid,
      photo,
      edits,
      onChange: setEdits,
      onSave: async () => {
        saved++;
      },
    });
  }
  const root = createRoot(document.getElementById("root"));
  await act(async () =>
    root.render(React.createElement(Harness, { pid: "one" })),
  );
  const button = (text) =>
    [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === text,
    );
  await act(async () => button("Advanced").click());
  assert.ok(document.querySelector('[aria-label="Highlights"]'));
  await act(async () => {
    const field = document.querySelector('[aria-label="Highlights value"]');
    Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set.call(field, "-40");
    field.dispatchEvent(new window.Event("input", { bubbles: true }));
    field.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  assert.equal(latest.highlights, -40);
  assert.equal(saved, 0);
  await act(async () => button("Basic").click());
  assert.equal(document.querySelector('[aria-label="Highlights"]'), null);
  assert.equal(latest.highlights, -40);
  await act(async () => button("Advanced").click());
  await act(async () =>
    root.render(React.createElement(Harness, { pid: "two" })),
  );
  assert.ok(document.querySelector('[aria-label="Highlights"]'));
  assert.equal(
    document.querySelector('[aria-label="Highlights value"]').value,
    "-40",
  );
  await act(async () => button("Reset light").click());
  assert.equal(latest.highlights, 0);
  assert.equal(saved, 0);
  await act(async () => root.unmount());
  dom.window.close();
});

test("batch editing defaults to keepers, stages a review without changing the album, then applies all ready results", async () => {
  const { JSDOM } = await import("jsdom"),
    dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require("react"),
    { act } = React,
    { createRoot } = require("react-dom/client");
  const { BatchEditor } = loadTS(path.resolve("src/batch-editor.tsx")),
    { freshEdits } = loadTS(path.resolve("src/types.ts"));
  const album = {
    id: "a",
    name: "Test",
    photos: [
      {
        id: "keep",
        name: "keeper.jpg",
        category: "Selected",
        edits: freshEdits(),
      },
      {
        id: "reject",
        name: "reject.jpg",
        category: "Rejected",
        edits: freshEdits(),
      },
    ],
  };
  let staged = null,
    request = null,
    applied = null,
    changed = 0;
  const busy = [];
  window.openshoot = {
    models: async () => [{ id: "test", name: "Test model" }],
    aiEditBatchStatus: async () => staged,
    aiEditBatchRun: async (
      id,
      ids,
      model,
      mode,
      crop,
      speed,
      kind,
      finish,
      match,
    ) => {
      request = { id, ids, model, mode, match };
      staged = {
        ids,
        model,
        mode,
        done: 1,
        total: 1,
        results: [
          {
            id: "keep",
            edits: { ...freshEdits(), exposure: 0.4 },
            reason: "Mock recommendation",
            confidence: 0.9,
          },
        ],
      };
      return staged;
    },
    aiEditBatchApply: async (id, ids) => {
      applied = ids;
      staged = null;
      return {
        ...album,
        photos: album.photos.map((p) =>
          p.id === "keep" ? { ...p, edits: { ...p.edits, exposure: 0.4 } } : p,
        ),
      };
    },
    preview: async () => "data:image/jpeg;base64,test",
  };
  const root = createRoot(document.getElementById("root"));
  await act(async () =>
    root.render(
      React.createElement(BatchEditor, {
        album,
        picked: [],
        auth: { enabled: true },
        onConnect: () => {},
        onBusy: (b) => busy.push(b),
        onAlbum: () => changed++,
      }),
    ),
  );
  const button = (text) =>
    [...document.querySelectorAll("button")].find((b) =>
      b.textContent.includes(text),
    );
  assert.equal(
    document.querySelector('[aria-label="Batch photo scope"]').value,
    "keepers",
  );
  assert.equal(button("Analyze 1 photos").disabled, true);
  await act(async () =>
    document.querySelector('[aria-label="Allow AI photo previews"]').click(),
  );
  await act(async () => button("Analyze 1 photos").click());
  assert.deepEqual(request.ids, ["keep"]);
  assert.equal(request.match, true);
  assert.equal(
    document.querySelector(
      '[aria-label="Match lighting & color across the set"]',
    ).checked,
    true,
  );
  assert.equal(changed, 0);
  assert.equal(album.photos[0].edits.exposure, 0);
  assert.match(document.body.textContent, /Mock recommendation/);
  assert.match(document.body.textContent, /Before \/ saved/);
  await act(async () => button("Apply all 1 ready suggestions").click());
  assert.deepEqual(applied, ["keep"]);
  assert.equal(changed, 1);
  assert.deepEqual(busy, [true, false, true, false]);
  await act(async () => root.unmount());
  dom.window.close();
});

test("progress ETA learns the current run rate, excludes resumed work, resets phases and handles stalls", () => {
  const { advanceETA, etaLabel } = loadTS(path.resolve("src/progress-eta.tsx"));
  const p = { phase: "AI auto edit", done: 28, total: 191 };
  let timing = advanceETA(null, p, 1000);
  assert.match(etaLabel(timing, 1000), /Estimating/);
  timing = advanceETA(timing, { ...p, done: 30 }, 21000);
  // Only two photos were processed during this run, not the previous 28.
  assert.equal(etaLabel(timing, 21000), "About 27 minutes remaining");
  assert.equal(advanceETA(timing, { ...p, done: 30 }, 25000), timing);
  assert.match(etaLabel(timing, 62000), /Taking longer/);
  timing = advanceETA(timing, { ...p, done: 32 }, 41000);
  assert.match(etaLabel(timing, 41000), /27 minutes/);
  assert.match(
    etaLabel(
      advanceETA(timing, { ...p, phase: "Export", done: 0 }, 45000),
      45000,
    ),
    /Estimating/,
  );
  assert.match(
    etaLabel(advanceETA(timing, { ...p, done: 0 }, 45000), 45000),
    /Estimating/,
  );
  const final = advanceETA(timing, { ...p, done: 191 }, 46000);
  assert.equal(etaLabel(final, 46000), "Finishing up…");
  const short = advanceETA(
    advanceETA(null, { phase: "Test", done: 0, total: 4 }, 0),
    { phase: "Test", done: 2, total: 4 },
    10000,
  );
  assert.equal(etaLabel(short, 10000), "About 10 seconds remaining");
});

test("shared crop choices expose all requested print and screen ratios and remember the choice", async () => {
  const { JSDOM } = await import("jsdom"),
    dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require("react"),
    { act } = React,
    { createRoot } = require("react-dom/client");
  const { CropOptions } = loadTS(path.resolve("src/crop-options.tsx")),
    { useAIPreferences } = loadTS(path.resolve("src/ai-preferences.ts"));
  function Harness() {
    const [p, update] = useAIPreferences();
    return React.createElement(
      "select",
      {
        value: p.cropMode,
        onChange: (e) => update({ cropMode: e.target.value }),
      },
      React.createElement(CropOptions),
    );
  }
  let root = createRoot(document.getElementById("root"));
  await act(async () => root.render(React.createElement(Harness)));
  assert.deepEqual(
    [...document.querySelectorAll("option")].map((o) => o.value),
    [
      "free",
      "original",
      "1:1",
      "4:5",
      "3:2",
      "5:7",
      "4:5-portrait",
      "9:16",
      "16:9",
    ],
  );
  for (const value of ["1:1", "4:5", "3:2", "5:7", "16:9"]) {
    await act(async () => {
      const select = document.querySelector("select");
      select.value = value;
      select.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    assert.equal(document.querySelector("select").value, value);
  }
  await act(async () => root.unmount());
  root = createRoot(document.getElementById("root"));
  await act(async () => root.render(React.createElement(Harness)));
  assert.equal(document.querySelector("select").value, "16:9");
  await act(async () => root.unmount());
  dom.window.close();
});

test("AI RAW denoise generates an unsaved preview, adjusts strength and can be switched off", async () => {
  const { JSDOM } = await import("jsdom"),
    dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require("react"),
    { act } = React,
    { createRoot } = require("react-dom/client"),
    { RawDenoise } = loadTS(path.resolve("src/raw-denoise.tsx"));
  const status = {
    available: true,
    installed: true,
    model: "RawNIND",
    device: { kind: "gpu", adapter: "Test Metal GPU" },
  };
  let latest,
    calls = 0;
  const busy = [];
  window.openshoot = {
    rawStatus: async () => status,
    rawGenerate: async () => {
      calls++;
      return { key: "a".repeat(64), device: status.device };
    },
  };
  function Harness() {
    const [edits, setEdits] = React.useState({ exposure: 0 });
    latest = edits;
    return React.createElement(RawDenoise, {
      photo: { id: "p", name: "photo.CR3" },
      albumId: "a",
      edits,
      onChange: setEdits,
      onBusy: (b) => busy.push(b),
    });
  }
  const root = createRoot(document.getElementById("root"));
  await act(async () => root.render(React.createElement(Harness)));
  const generate = [...document.querySelectorAll("button")].find((b) =>
    b.textContent.includes("Generate denoised RAW"),
  );
  assert.ok(generate);
  await act(async () => generate.click());
  assert.equal(calls, 1);
  assert.equal(latest.aiDenoise, 50);
  assert.equal(latest.rawDenoiseKey, "a".repeat(64));
  assert.match(document.body.textContent, /Test Metal GPU/);
  assert.deepEqual(busy, [true, false]);
  await act(async () => {
    const slider = document.querySelector('[aria-label="AI denoise amount"]');
    Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set.call(slider, "75");
    slider.dispatchEvent(new window.Event("input", { bubbles: true }));
    slider.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  assert.equal(latest.aiDenoise, 75);
  await act(async () =>
    document.querySelector('input[type="checkbox"]').click(),
  );
  assert.equal(latest.aiDenoise, 0);
  await act(async () =>
    document.querySelector('input[type="checkbox"]').click(),
  );
  assert.equal(latest.aiDenoise, 75);
  await act(async () => root.unmount());
  dom.window.close();
});

test("Quick Preview creates an AI selection, rough edits it, applies and exports only that set", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: "http://localhost",
  });
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require("react"),
    { act } = React,
    { createRoot } = require("react-dom/client");
  const { QuickPreview } = loadTS(path.resolve("src/quick-preview.tsx")),
    { freshEdits } = loadTS(path.resolve("src/types.ts"));
  window.localStorage.setItem(
    "openshoot-ai-edit-preferences",
    JSON.stringify({
      model: "test",
      sharePreviews: true,
      mode: "crop",
      concurrency: 16,
    }),
  );
  let album = {
      id: "show",
      genre: "Wedding & engagement",
      photos: Array.from({ length: 32 }, (_, i) => ({
        id: "p" + i,
        name: i + ".jpg",
        category: "Unrated",
        edits: freshEdits(),
      })),
    },
    showcase = null,
    batch = null,
    exported = null,
    request = null;
  window.openshoot = {
    models: async () => [{ id: "test", name: "Test" }],
    quickStatus: async () => showcase,
    quickRun: async (id, count, model) => {
      assert.equal(count, 25);
      showcase = {
        model,
        genre: album.genre,
        target: count,
        ids: album.photos.map((p) => p.id),
        selected: album.photos.slice(0, count).map((p) => p.id),
        applied: [],
        assessments: [],
      };
      return showcase;
    },
    aiEditBatchStatus: async () => batch,
    aiEditBatchRun: async (
      id,
      ids,
      model,
      mode,
      cropMode,
      concurrency,
      kind,
    ) => {
      request = { ids, concurrency, kind, mode };
      batch = {
        model,
        mode,
        cropMode,
        ids,
        done: ids.length,
        total: ids.length,
        results: ids.map((id) => ({
          id,
          edits: { ...freshEdits(), exposure: 0.2 },
          reason: "Visible detail",
          confidence: 0.9,
        })),
      };
      return batch;
    },
    preview: async () => "",
    aiEditBatchApply: async (id, ids, kind) => {
      assert.equal(kind, "quick");
      showcase = { ...showcase, applied: ids };
      batch = null;
      return album;
    },
    export: async (id, opts) => {
      exported = opts;
      return { written: 25, failures: [], cancelled: false };
    },
  };
  const root = createRoot(document.getElementById("root")),
    button = (text) =>
      [...document.querySelectorAll("button")].find((b) =>
        b.textContent.includes(text),
      );
  await act(async () =>
    root.render(
      React.createElement(QuickPreview, {
        album,
        auth: { enabled: true },
        onConnect: () => {},
        onBusy: () => {},
        onAlbum: (a) => (album = a),
      }),
    ),
  );
  assert.match(document.body.textContent, /wedding & engagement/i);
  await act(async () => button("Create 25-photo preview").click());
  assert.equal(request.ids.length, 25);
  assert.equal(request.concurrency, 16);
  assert.equal(request.kind, "quick");
  assert.equal(request.mode, "both");
  assert.equal(
    JSON.parse(window.localStorage.getItem("openshoot-ai-edit-preferences"))
      .mode,
    "crop",
  );
  await act(async () => {
    const details = document.querySelector("details:not(.quick-options)");
    details.open = true;
    details.dispatchEvent(new window.Event("toggle"));
  });
  assert.equal(
    document.querySelectorAll('figure img[alt$="AI suggestion"]').length,
    25,
  );
  assert.match(document.body.textContent, /AI suggestion · not applied/);
  await act(async () => button("Apply all 25 ready suggestions").click());
  assert.equal(
    document.querySelectorAll('figure img[alt$="saved edit"]').length,
    25,
  );
  await act(async () => button("Export 25 preview JPEGs").click());
  assert.equal(exported.scope, "ids");
  assert.deepEqual(exported.ids, showcase.selected);
  assert.equal(exported.maxSize, "2400");
  assert.match(document.body.textContent, /25 preview JPEGs exported/);
  await act(async () => root.unmount());
  dom.window.close();
});

test("completed Quick Preview suggestions can finish locally without ChatGPT sign-in, then become applicable", async () => {
  const { JSDOM } = await import("jsdom"),
    dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require("react"),
    { act } = React,
    { createRoot } = require("react-dom/client"),
    { BatchEditor } = loadTS(path.resolve("src/batch-editor.tsx")),
    { freshEdits } = loadTS(path.resolve("src/types.ts"));
  const album = {
    id: "a",
    photos: [
      { id: "p", name: "Photo.CR3", category: "Selected", edits: freshEdits() },
    ],
  };
  let job = {
      model: "saved-model",
      mode: "both",
      ids: ["p"],
      done: 1,
      total: 1,
      finishing: true,
      results: [
        {
          id: "p",
          edits: { ...freshEdits(), exposure: 0.2 },
          reason: "Good moment",
          confidence: 0.9,
        },
      ],
    },
    called = 0;
  window.openshoot = {
    aiEditBatchStatus: async () => job,
    preview: async () => "",
    aiEditBatchRun: async (...args) => {
      called++;
      assert.equal(args[6], "quick");
      assert.equal(args[7], true);
      job = {
        ...job,
        finishing: false,
        results: job.results.map((r) => ({
          ...r,
          finish: { status: "done", method: "AI RAW denoise", warning: "" },
        })),
      };
      return job;
    },
  };
  const root = createRoot(document.getElementById("root")),
    button = (t) =>
      [...document.querySelectorAll("button")].find((b) =>
        b.textContent.includes(t),
      );
  await act(async () =>
    root.render(
      React.createElement(BatchEditor, {
        album,
        picked: [],
        auth: { enabled: false },
        kind: "quick",
        onConnect: () => {
          throw Error("No sign-in required");
        },
        onBusy: () => {},
        onAlbum: () => {},
      }),
    ),
  );
  assert.equal(button("Finish 1 photos").disabled, false);
  assert.equal(button("Apply all 1").disabled, true);
  await act(async () => button("Finish 1 photos").click());
  assert.equal(called, 1);
  assert.equal(button("Apply all 1").disabled, false);
  assert.match(document.body.textContent, /AI RAW denoise/);
  await act(async () => root.unmount());
  dom.window.close();
});

test("Quick Preview checkbox remembers both choices and forwards matching to its edit workflow", async () => {
  const { JSDOM } = require("jsdom"),
    React = require("react"),
    { act } = React,
    { createRoot } = require("react-dom/client");
  const { QuickPreview } = loadTS(path.resolve("src/quick-preview.tsx"));
  for (const enabled of [false, true]) {
    const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
    global.window = dom.window;
    global.document = dom.window.document;
    global.HTMLElement = dom.window.HTMLElement;
    global.IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.setItem(
      "openshoot-ai-edit-preferences",
      JSON.stringify({
        sharePreviews: true,
        model: "test",
        matchSet: !enabled,
      }),
    );
    const album = {
      id: "a",
      name: "Test",
      genre: "Sports & action",
      photos: [{ id: "p", name: "test.jpg", edits: {} }],
    };
    let request;
    const selection = {
      model: "test",
      selected: ["p"],
      applied: [],
      target: 25,
      ids: ["p"],
      assessments: [],
    };
    window.openshoot = {
      quickStatus: async () => null,
      models: async () => [{ id: "test", name: "Test" }],
      quickRun: async () => selection,
      aiEditBatchRun: async (...args) => {
        request = args;
        return { results: [] };
      },
      aiEditBatchStatus: async () => null,
      preview: async () => "",
    };
    const root = createRoot(document.getElementById("root"));
    await act(async () =>
      root.render(
        React.createElement(QuickPreview, {
          album,
          auth: { enabled: true },
          onConnect: () => {},
          onBusy: () => {},
          onAlbum: () => {},
        }),
      ),
    );
    const checkbox = document.querySelector(
      '[aria-label="Match lighting & color across the set"]',
    );
    assert.ok(checkbox);
    await act(async () => checkbox.click());
    assert.equal(checkbox.checked, enabled);
    assert.equal(
      JSON.parse(window.localStorage.getItem("openshoot-ai-edit-preferences"))
        .matchSet,
      enabled,
    );
    const create = [...document.querySelectorAll("button")].find((b) =>
      b.textContent.includes("-photo preview"),
    );
    assert.ok(create);
    await act(async () => create.click());
    assert.equal(request[6], "quick");
    assert.equal(request[8], enabled);
    await act(async () => root.unmount());
    dom.window.close();
  }
});

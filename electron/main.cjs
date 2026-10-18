const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  protocol,
  net,
  shell,
  Menu,
  safeStorage,
  screen,
} = require("electron");
const path = require("node:path"),
  { pathToFileURL } = require("node:url");
const { restoreAlbum } = require("./history.cjs");
const { RawDenoiser } = require("./raw-denoise.cjs");
const { Library } = require("./library.cjs");
const {
  filterFiles,
  RAW_EXTENSIONS,
  JPEG_EXTENSIONS,
  FILE_TYPES,
  supported,
} = require("./file-types.cjs");
const { ChatGPT } = require("./auth.cjs");
const { suggest } = require("./ai-edit.cjs");
const { QuickPreview } = require("./quick-preview.cjs");
const { AIEditBatch } = require("./ai-edit-batch.cjs");
const { AICulling } = require("./ai.cjs");
const { demo } = require("./demo.cjs");
const startup = (step) => {
  if (process.env.OPENSHOOT_DEBUG_STARTUP)
    console.error("OpenShoot startup:", step);
};
startup("modules loaded");
app.setName("OpenShoot");
if (process.env.OPENSHOOT_DATA_DIR)
  app.setPath("userData", process.env.OPENSHOOT_DATA_DIR);
protocol.registerSchemesAsPrivileged([
  {
    scheme: "openshoot",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
const lock = app.requestSingleInstanceLock();
startup("instance lock: " + lock);
if (!lock) {
  app.quit();
} else
  app
    .whenReady()
    .then(boot)
    .catch((e) => {
      dialog.showErrorBox("OpenShoot could not start", e.message);
      app.quit();
    });
let win, lib, auth, ai, aiEdits, quickEdits, quickPreview, lastExport;
const history = new Map();
const importPlans = new Map();
async function planImport(id, paths) {
  if (lib.busy) throw Error("Please wait for the current operation");
  const a = lib.album(id);
  const files = await lib.walk(paths);
  const counts = {};
  const existing = new Set(a.photos.map((p) => p.path));
  let duplicates = 0;
  for (const file of files) {
    if (existing.has(file)) {
      duplicates++;
      continue;
    }
    const ext = path.extname(file).toLowerCase();
    counts[ext] = (counts[ext] || 0) + 1;
  }
  const token = require("node:crypto").randomUUID();
  for (const [key, p] of importPlans)
    if (p.expires < Date.now()) importPlans.delete(key);
  importPlans.set(token, { id, files, expires: Date.now() + 30 * 60 * 1000 });
  return {
    token,
    counts,
    total: files.length - duplicates,
    duplicates,
    source:
      paths.length === 1
        ? path.basename(paths[0])
        : paths.length + " selected items",
    rawExtensions: RAW_EXTENSIONS,
    jpegExtensions: JPEG_EXTENSIONS,
    fileTypes: FILE_TYPES,
  };
}
function remember(id) {
  const a = lib.album(id);
  const stack = history.get(id) || [];
  stack.push(structuredClone(a));
  if (stack.length > 20) stack.shift();
  history.set(id, stack);
}
async function mutate(id, fn) {
  if (lib.busy) throw Error("Please wait for the current operation");
  remember(id);
  try {
    return await fn();
  } catch (e) {
    const previous = history.get(id)?.pop();
    if (previous) {
      const index = lib.db.albums.findIndex((a) => a.id === id);
      if (index >= 0) lib.db.albums[index] = previous;
    }
    throw e;
  }
}
async function boot() {
  startup("app ready");
  if (process.platform === "darwin")
    app.dock?.setIcon(
      path.join(
        __dirname,
        process.env.OPENSHOOT_DEV_URL
          ? "../public/openshoot-icon.png"
          : "../dist/openshoot-icon.png",
      ),
    );
  lib = await new Library(app.getPath("userData")).init();
  startup("library loaded");
  auth = new ChatGPT(lib.root, safeStorage, (url) => shell.openExternal(url));
  await auth.init();
  startup("connection loaded");
  ai = new AICulling(lib, auth);
  aiEdits = new AIEditBatch(lib, auth);
  quickEdits = new AIEditBatch(lib, auth, "quick-edit-");
  quickPreview = new QuickPreview(lib, auth);
  lib.denoiser = new RawDenoiser(
    lib,
    app.isPackaged
      ? path.join(process.resourcesPath, "openshoot-raw")
      : path.join(__dirname, "../native/openshoot-raw"),
  );
  protocol.handle("openshoot", async (request) => {
    const url = new URL(request.url),
      name = url.pathname.slice(1);
    if (
      url.hostname !== "cache" ||
      !/^[a-f0-9-]{36}(?:-thumb)?\.jpg$/.test(name)
    )
      return new Response("Not found", { status: 404 });
    try {
      await lib.ensurePreview(name.slice(0, 36));
      return await net.fetch(pathToFileURL(path.join(lib.cache, name)).href);
    } catch {
      return new Response(
        "Preview unavailable. Reconnect the original photo drive.",
        { status: 404 },
      );
    }
  });
  // Explicit work-area bounds avoid macOS smart zoom keeping a narrow width.
  const workArea = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint(),
  ).workArea;
  win = new BrowserWindow({
    ...workArea,
    minWidth: Math.min(1080, workArea.width),
    minHeight: Math.min(720, workArea.height),
    show: false,
    backgroundColor: "#111111",
    title: "OpenShoot",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 17, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  startup("window created");
  win.once("ready-to-show", () => {
    win.setBounds(workArea);
    startup("window bounds: " + JSON.stringify(win.getBounds()));
    win.show();
  });
  win.webContents.on("render-process-gone", (_, details) =>
    startup("renderer ended: " + details.reason),
  );
  win.webContents.on("did-fail-load", (_, code, description) =>
    startup("page load failed: " + code + " " + description),
  );
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });
  const progress = (p) => {
    if (!win.isDestroyed()) win.webContents.send("progress", p);
  };
  auth.onChange = (p) => {
    if (!win.isDestroyed()) win.webContents.send("auth", p);
  };
  const handler = (name, fn) =>
    ipcMain.handle(name, async (event, ...args) => {
      if (event.sender !== win.webContents) throw Error("Unknown sender");
      return fn(...args);
    });
  handler("library:list", () => lib.list());
  handler("library:get", (id) => lib.album(id));
  handler("library:create", (name, genre) => lib.create(name, genre));
  handler("library:rename", (id, name) =>
    mutate(id, () => lib.rename(id, name)),
  );
  handler("library:archive", (id) => {
    if (lib.busy) throw Error("Please wait for the current operation");
    return lib.archive(id);
  });
  handler("library:restore", () => lib.restore());
  handler("library:demo", () => demo(lib, progress));
  handler("library:chooseImport", async (id, folder) => {
    const r = await dialog.showOpenDialog(win, {
      title: folder ? "Choose a shoot folder" : "Choose photos",
      properties: folder ? ["openDirectory"] : ["openFile", "multiSelections"],
      filters: folder
        ? []
        : [
            {
              name: "Photos",
              extensions: [...supported].map((e) => e.slice(1)),
            },
          ],
    });
    if (r.canceled) return null;
    return planImport(id, r.filePaths);
  });
  handler("library:planDrop", (id, paths) => planImport(id, paths));
  handler("library:import", async (id, token, extensions) => {
    const plan = importPlans.get(token);
    if (!plan || plan.id !== id || plan.expires < Date.now())
      throw Error("Import selection expired. Please choose the source again.");
    const files = filterFiles(plan.files, extensions);
    const result = await lib.import(id, files, progress);
    importPlans.delete(token);
    return result;
  });
  handler("library:cull", (id, settings) =>
    mutate(id, () => lib.cull(id, settings, progress)),
  );
  handler("library:patch", (id, ids, patch) =>
    mutate(id, () => lib.patch(id, ids, patch)),
  );
  handler("library:remove", (id, ids) => mutate(id, () => lib.remove(id, ids)));
  handler("library:undo", async (id) => {
    if (lib.busy) throw Error("Please wait for the current operation");
    const a = history.get(id)?.pop();
    if (!a) return lib.album(id);
    const index = lib.db.albums.findIndex((p) => p.id === id);
    const current = lib.db.albums[index];
    lib.db.albums[index] = restoreAlbum(a, current);
    await lib.save();
    return lib.db.albums[index];
  });
  handler("library:preview", (id, pid, edits) =>
    lib.editPreview(id, pid, edits),
  );
  handler("library:export", async (id, options) => {
    if (
      !["selected", "all", "rated", "ids"].includes(options.scope) ||
      !["original", "jpeg", "xmp"].includes(options.format)
    )
      throw Error("Invalid export settings");
    const r = await dialog.showOpenDialog(win, {
      title: "Choose export destination",
      properties: ["openDirectory", "createDirectory"],
    });
    if (r.canceled) return null;
    const result = await lib.export(id, options, r.filePaths[0], progress);
    lastExport = result.folder;
    return result;
  });
  handler("library:cancel", () => {
    lib.cancelled = true;
    ai.pause();
    aiEdits.pause();
    quickEdits.pause();
    quickPreview.pause();
    lib.denoiser.cancel();
  });
  handler("library:reveal", (id, pid) =>
    shell.showItemInFolder(lib.photo(id, pid).path),
  );
  handler("library:openExport", () =>
    lastExport ? shell.openPath(lastExport) : null,
  );
  handler("raw:status", () => lib.denoiser.status());
  handler("raw:download", () => lib.denoiser.download(progress));
  handler("raw:generate", (id, pid) =>
    lib.denoiser.generate(lib.photo(id, pid), progress),
  );
  handler("raw:install", async () => {
    const r = await dialog.showOpenDialog(win, {
      title: "Install RawNIND Bayer model",
      properties: ["openFile"],
      filters: [{ name: "RawNIND model", extensions: ["onnx", "dtmodel"] }],
    });
    if (r.canceled) return null;
    return lib.denoiser.install(r.filePaths[0], progress);
  });
  handler("chatgpt:status", () => auth.status());
  handler("chatgpt:signIn", () => auth.signIn());
  handler("chatgpt:disconnect", () => auth.disconnect());
  handler("chatgpt:edit", (id, pid, model, mode, cropMode) =>
    suggest(lib, auth, id, pid, model, mode, cropMode),
  );
  const editService = (kind) => (kind === "quick" ? quickEdits : aiEdits);
  handler("quick:refinish", async (id, reevaluate, parallel = 16) => {
    const job = await quickPreview.refinish(
      id,
      quickEdits,
      reevaluate === true,
    );
    return quickEdits.run(
      id,
      job.entries.map((p) => p.id),
      job.model,
      job.mode,
      progress,
      job.cropMode,
      parallel,
      true,
    );
  });
  handler("quick:status", (id) => quickPreview.status(id));
  handler("quick:run", (id, count, model, preset, parallel) =>
    quickPreview.run(id, count, model, progress, preset, parallel),
  );
  handler("quick:discard", async (id) => {
    await quickEdits.discard(id);
    await quickPreview.discard(id);
  });
  handler("chatgpt:editBatchStatus", (id, kind) =>
    editService(kind).status(id),
  );
  handler(
    "chatgpt:editBatchRun",
    (id, ids, model, mode, cropMode, concurrency, kind, finish, match) =>
      editService(kind).run(
        id,
        ids,
        model,
        mode,
        progress,
        cropMode,
        concurrency,
        finish,
        match,
      ),
  );
  handler("chatgpt:editBatchDiscard", (id, kind) =>
    editService(kind).discard(id),
  );
  handler("chatgpt:editBatchApply", async (id, ids, kind) => {
    if (kind === "quick") {
      const job = await quickEdits.read(id);
      if (!job) throw Error("No saved showcase edits");
      await quickPreview.applied(id, ids, job.results);
    }
    return mutate(id, () => editService(kind).apply(id, ids));
  });
  handler("chatgpt:models", () => auth.models());
  handler("chatgpt:queue", (id) => ai.status(id));
  handler("chatgpt:discard", (id) => ai.discard(id));
  handler("chatgpt:cull", (id, model) =>
    mutate(id, () => ai.run(id, model, progress)),
  );
  const send = (command) => win.webContents.send("command", command);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "OpenShoot",
        submenu: [
          { role: "about" },
          { type: "separator" },
          {
            label: "Settings…",
            accelerator: "CmdOrCtrl+,",
            click: () => send("settings"),
          },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      {
        label: "File",
        submenu: [
          {
            label: "New Album",
            accelerator: "CmdOrCtrl+N",
            click: () => send("new"),
          },
          {
            label: "Import Photos…",
            accelerator: "CmdOrCtrl+I",
            click: () => send("import"),
          },
          { label: "Import Folder…", click: () => send("importFolder") },
          {
            label: "Export…",
            accelerator: "CmdOrCtrl+Shift+E",
            click: () => send("export"),
          },
        ],
      },
      {
        label: "Edit",
        submenu: [
          {
            label: "Undo photo changes",
            accelerator: "CmdOrCtrl+Z",
            click: () => send("undo"),
          },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "View",
        submenu: [
          { label: "Grid", accelerator: "G", click: () => send("grid") },
          { label: "Loupe", accelerator: "E", click: () => send("loupe") },
          { role: "togglefullscreen" },
          { role: "toggleDevTools" },
        ],
      },
      { role: "windowMenu" },
    ]),
  );
  if (process.env.OPENSHOOT_DEV_URL)
    await win.loadURL(process.env.OPENSHOOT_DEV_URL);
  else await win.loadFile(path.join(__dirname, "../dist/index.html"));
  startup("page loaded");
  app.on("second-instance", () => {
    if (win.isMinimized()) win.restore();
    win.focus();
  });
}
app.on("window-all-closed", () => app.quit());

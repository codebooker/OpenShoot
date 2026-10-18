const { contextBridge, ipcRenderer, webUtils } = require("electron");
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const events = (channel, callback) => {
  const listener = (_, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld("openshoot", {
  list: () => invoke("library:list"),
  get: (id) => invoke("library:get", id),
  create: (name, genre) => invoke("library:create", name, genre),
  rename: (id, name) => invoke("library:rename", id, name),
  archive: (id) => invoke("library:archive", id),
  restore: () => invoke("library:restore"),
  chooseImport: (id, folder) => invoke("library:chooseImport", id, folder),
  planDrop: (id, files) => invoke("library:planDrop", id, files),
  import: (id, token, extensions) =>
    invoke("library:import", id, token, extensions),
  filePath: (file) => webUtils.getPathForFile(file),
  demo: () => invoke("library:demo"),
  cull: (id, settings) => invoke("library:cull", id, settings),
  patch: (id, ids, patch) => invoke("library:patch", id, ids, patch),
  remove: (id, ids) => invoke("library:remove", id, ids),
  undo: (id) => invoke("library:undo", id),
  preview: (id, pid, edits) => invoke("library:preview", id, pid, edits),
  export: (id, options) => invoke("library:export", id, options),
  cancel: () => invoke("library:cancel"),
  reveal: (id, pid) => invoke("library:reveal", id, pid),
  openExport: () => invoke("library:openExport"),
  rawStatus: () => invoke("raw:status"),
  rawInstall: () => invoke("raw:install"),
  rawDownload: () => invoke("raw:download"),
  rawGenerate: (id, pid) => invoke("raw:generate", id, pid),
  auth: () => invoke("chatgpt:status"),
  signIn: () => invoke("chatgpt:signIn"),
  disconnect: () => invoke("chatgpt:disconnect"),
  models: () => invoke("chatgpt:models"),
  aiEdit: (id, pid, model, mode, cropMode) =>
    invoke("chatgpt:edit", id, pid, model, mode, cropMode),
  quickRefinish: (id, reevaluate) => invoke("quick:refinish", id, reevaluate),
  quickStatus: (id) => invoke("quick:status", id),
  quickRun: (id, count, model, preset, parallel) =>
    invoke("quick:run", id, count, model, preset, parallel),
  quickDiscard: (id) => invoke("quick:discard", id),
  aiEditBatchStatus: (id, kind) => invoke("chatgpt:editBatchStatus", id, kind),
  aiEditBatchRun: (
    id,
    ids,
    model,
    mode,
    cropMode,
    concurrency,
    kind,
    finish,
    match,
  ) =>
    invoke(
      "chatgpt:editBatchRun",
      id,
      ids,
      model,
      mode,
      cropMode,
      concurrency,
      kind,
      finish,
      match,
    ),
  aiEditBatchDiscard: (id, kind) =>
    invoke("chatgpt:editBatchDiscard", id, kind),
  aiEditBatchApply: (id, ids, kind) =>
    invoke("chatgpt:editBatchApply", id, ids, kind),
  aiStatus: (id) => invoke("chatgpt:queue", id),
  aiCull: (id, model) => invoke("chatgpt:cull", id, model),
  aiDiscard: (id) => invoke("chatgpt:discard", id),
  onProgress: (cb) => events("progress", cb),
  onAuth: (cb) => events("auth", cb),
  onCommand: (cb) => events("command", cb),
});

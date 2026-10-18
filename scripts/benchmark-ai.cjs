// Run with Electron: electron scripts/benchmark-ai.cjs
// Uses existing signed-in account and previews; never applies or saves photo edits.
const { app, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ChatGPT } = require('../electron/auth.cjs');
const { Library } = require('../electron/library.cjs');
const { analyze } = require('../electron/ai-edit.cjs');
app.setName('OpenShoot');
console.log('Benchmark boot');
const root = path.join(app.getPath('appData'), 'OpenShoot');
app.setPath('userData', path.resolve('.test-data/ai-benchmark-runtime'));
app.whenReady().then(async () => {
  console.log('Benchmark ready');
  const report = { startedAt: new Date().toISOString(), levels: [] };
  const output = path.resolve('.test-data/ai-concurrency-' + Date.now() + '.json');
  await fs.mkdir(path.dirname(output), { recursive: true });
  const save = () => fs.writeFile(output, JSON.stringify(report, null, 2));
  try {
    const auth = new ChatGPT(root, safeStorage, () => { throw Error('Sign in in OpenShoot first'); });
    await auth.init();
    if (!auth.status().connected) throw Error('Existing ChatGPT connection could not be unlocked');
    const lib = new Library(root);
    lib.db = JSON.parse(await fs.readFile(path.join(root, 'library.json'), 'utf8'));
    // Only existing cached previews: benchmark must not trigger imports or library writes.
    lib.ensurePreview = async pid => fs.access(path.join(lib.cache, pid + '.jpg'));
    const album = lib.db.albums.find(a => a.name.toLowerCase() === 'baseball');
    if (!album) throw Error('BaseBall album not found');
    const job = JSON.parse(await fs.readFile(path.join(root, 'ai-edit-' + album.id + '.json'), 'utf8'));
    const model = job.model;
    if (!(await auth.models()).some(m => m.id === model)) throw Error('Previous batch model unavailable');
    const photos = album.photos.filter(p => p.category === 'Selected').slice(0, 24);
    report.model = model; report.album = album.name;
    // One warm-up excluded from timing, then two waves per concurrency level.
    console.log(JSON.stringify({ phase: 'warmup', model, output }));
    await analyze(lib, auth, album.id, photos[0].id, model, 'both', AbortSignal.timeout(120000), job.cropMode || 'free');
    const levels = (process.env.OPENSHOOT_BENCH_LEVELS || '2,4,6,8,12').split(',').map(Number);
    if (!levels.length || levels.some(n => !Number.isInteger(n) || n < 1 || n > 24)) throw Error('Concurrency levels must be integers from 1 to 24');
    for (const concurrency of levels) {
      const level = { concurrency, requests: concurrency * 2, results: [] };
      report.levels.push(level);
      let cursor = 0, stopped = false;
      const start = performance.now();
      await Promise.all(Array.from({ length: concurrency }, async () => {
        while (!stopped && cursor < level.requests) {
          const index = cursor++, photo = photos[index % photos.length], begun = performance.now();
          try {
            const result = await analyze(lib, auth, album.id, photo.id, model, 'both', AbortSignal.timeout(120000), job.cropMode || 'free');
            level.results.push({ index, seconds: (performance.now()-begun)/1000, ok: true, confidence: result.confidence });
          } catch (error) {
            level.results.push({ index, seconds: (performance.now()-begun)/1000, ok: false, error: error.message });
            stopped = true;
          }
          console.log(JSON.stringify({ concurrency, completed: level.results.length, target: level.requests, ...level.results.at(-1) }));
        }
      }));
      level.seconds = (performance.now()-start)/1000;
      level.succeeded = level.results.filter(r=>r.ok).length;
      level.photosPerMinute = level.succeeded / level.seconds * 60;
      console.log(JSON.stringify({ phase:'level-complete', concurrency, seconds:level.seconds, photosPerMinute:level.photosPerMinute, succeeded:level.succeeded }));
      await save();
      if (stopped) break;
    }
    report.finishedAt = new Date().toISOString(); await save();
    console.log(JSON.stringify({ phase:'complete', output }));
  } catch(error) { report.error=error.message; await save(); console.error(error.message); process.exitCode=1; }
  app.quit();
});

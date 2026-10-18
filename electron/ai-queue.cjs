const { setTimeout: delay } = require("node:timers/promises");
const retryable = (error) => [429, 500, 502, 503, 504].includes(error.status);
async function runQueue(
  items,
  task,
  save,
  { concurrency = 16, signal, retryDelay = 2000 } = {},
) {
  let cursor = 0,
    active = 0,
    limit = concurrency,
    cooldown = 0,
    failure;
  let writes = Promise.resolve();
  const wait = (ms) => delay(ms, undefined, { signal });
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (!failure && !signal?.aborted) {
        const item = items[cursor++];
        if (item === undefined) return;
        try {
          let result;
          for (let attempt = 0; ; attempt++) {
            while (active >= limit || Date.now() < cooldown) {
              if (failure) return;
              await wait(Math.max(10, Math.min(100, cooldown - Date.now())));
            }
            if (failure || signal?.aborted) return;
            active++;
            try {
              result = await task(item);
              break;
            } catch (error) {
              if (!retryable(error) || attempt >= 2 || signal?.aborted)
                throw error;
              limit = Math.max(1, Math.floor(limit / 2));
              cooldown = Math.max(
                cooldown,
                Date.now() +
                  Math.max(error.retryAfterMs || 0, retryDelay * 2 ** attempt),
              );
            } finally {
              active--;
            }
          }
          // Serialize completion writes so atomic checkpoint renames never race.
          writes = writes.then(() => save(result));
          await writes;
        } catch (error) {
          failure ||= error;
        }
      }
    }),
  );
  await writes;
  if (signal?.aborted)
    throw Error("Batch paused. Completed suggestions are saved.");
  if (failure) throw failure;
}
module.exports = { runQueue };

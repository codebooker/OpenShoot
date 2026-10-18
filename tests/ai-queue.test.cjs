const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { runQueue } = require("../electron/ai-queue.cjs");
test("continuous queue fills a freed slot before the slower request finishes and serializes checkpoints", async () => {
  let release, third;
  const slow = new Promise((r) => (release = r)),
    started = new Promise((r) => (third = r));
  let writes = 0,
    maxWrites = 0;
  const saved = [];
  const running = runQueue(
    [0, 1, 2],
    async (item) => {
      if (item === 0) await slow;
      if (item === 2) third();
      return item;
    },
    async (result) => {
      maxWrites = Math.max(maxWrites, ++writes);
      await new Promise((r) => setTimeout(r, 2));
      saved.push(result);
      writes--;
    },
    { concurrency: 2 },
  );
  await started;
  assert.ok(!saved.includes(0));
  release();
  await running;
  assert.equal(maxWrites, 1);
  assert.deepEqual(saved.sort(), [0, 1, 2]);
});
test("transient service limits retry with backoff; invalid responses are not retried", async () => {
  let calls = 0;
  const saved = [];
  await runQueue(
    [1, 2, 3],
    async (x) => {
      if (++calls === 1)
        throw Object.assign(Error("busy"), { status: 429, retryAfterMs: 1 });
      return x;
    },
    async (r) => saved.push(r),
    { concurrency: 2, retryDelay: 1 },
  );
  assert.equal(calls, 4);
  assert.deepEqual(saved.sort(), [1, 2, 3]);
  calls = 0;
  await assert.rejects(
    runQueue(
      [1, 2, 3],
      async () => {
        calls++;
        throw Error("invalid JSON");
      },
      async () => {},
      { concurrency: 1 },
    ),
    /invalid/,
  );
  assert.equal(calls, 1);
});
test("pause interrupts rate-limit backoff promptly", async () => {
  const controller = new AbortController();
  let began;
  const ready = new Promise((r) => (began = r));
  const running = runQueue(
    [1],
    async () => {
      began();
      throw Object.assign(Error("busy"), { status: 429 });
    },
    async () => {},
    { concurrency: 1, signal: controller.signal },
  );
  await ready;
  controller.abort();
  await assert.rejects(running, /paused/);
});

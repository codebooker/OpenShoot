import { createServer } from "vite";
import { spawn } from "node:child_process";
const server = await createServer({
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
});
await server.listen();
const child = spawn("node_modules/.bin/electron", ["."], {
  stdio: "inherit",
  env: { ...process.env, OPENSHOOT_DEV_URL: "http://127.0.0.1:5173" },
});
child.on("exit", () => {
  server.close();
  process.exit();
});

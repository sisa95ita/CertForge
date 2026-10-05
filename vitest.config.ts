import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { server: { deps: { inline: ["next-intl"] } }, environment: "node", pool: "forks", maxWorkers: 1, fileParallelism: false, isolate: false },
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "server-only": path.resolve(__dirname, "src/lib/__tests__/server-only.ts") } },
});

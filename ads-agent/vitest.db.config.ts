import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Database-backed tests. Separate from vitest.config.ts because they need a live
// PostgreSQL 18 at TEST_DATABASE_URL and take seconds, not milliseconds.
// Run with: npx vitest run --config vitest.db.config.ts
export default defineConfig({
  test: {
    include: ["**/*.db.test.ts"],
    // Transaction-atomicity tests contend on the same rows; serialise them.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      SKIP_DB_ROLE_CHECK: "1",
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});

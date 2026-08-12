import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Without this alias "@/lib/x" and "../x" resolve to separate module instances,
// so vi.mock() silently misses one of them and tests hit real APIs.
export default defineConfig({
  oxc: {
    jsx: {
      runtime: "automatic",
    },
  },
  test: {
    passWithNoTests: true,
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/*.db.test.ts"],
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

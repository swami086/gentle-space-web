import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

// Without this alias "@/lib/x" and "../x" resolve to separate module instances,
// so vi.mock() silently misses one of them and tests hit real APIs.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    // .worktrees/ holds full nested checkouts used for isolated parallel task
    // execution; without this exclude, running tests from the main checkout
    // while one is open picks up its test files too, as if they were ours.
    exclude: [...configDefaults.exclude, ".worktrees/**"],
  },
});

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Without this alias "@/lib/x" and "../x" resolve to separate module instances,
// so vi.mock() silently misses one of them and tests hit real APIs.
export default defineConfig({
  test: {
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});

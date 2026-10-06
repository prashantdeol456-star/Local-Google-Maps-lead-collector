import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Each test file builds the app on its own SQLite database; under a full parallel run
    // a single test can pass the default 5 s on a slower machine.
    testTimeout: 15_000,
  },
});

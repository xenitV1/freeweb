import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts"],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    pool: "forks",
    env: {
      Z_API_KEY: process.env.Z_API_KEY || "",
    },
  },
});

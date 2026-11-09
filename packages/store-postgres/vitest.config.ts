import { defineConfig } from "vitest/config";

// Roda a suíte do domínio contra o PostgreSQL (TEST_DATABASE_URL) e os testes próprios do store.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "../domain/src/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});

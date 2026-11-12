import { defineConfig } from "vitest/config";

// Testes de contrato (S2-07): falam com a API por HTTP e dependem da ordem
// dentro do arquivo, por isso rodam em sequencia e com tempo limite folgado.
export default defineConfig({
  test: {
    include: ["tests/contract/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/release/**",
      "**/cdk.out/**",
      "next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Scripts de empacotamento rodam em Node.
    files: ["**/scripts/**/*.mjs", "**/next.config.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        fetch: "readonly",
        crypto: "readonly",
        setTimeout: "readonly",
        Buffer: "readonly",
        URL: "readonly",
      },
    },
  },
  {
    // Respostas HTTP dos testes ponta a ponta são dinâmicas.
    files: ["**/*.test.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
);

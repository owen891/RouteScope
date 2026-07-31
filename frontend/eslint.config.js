import tseslint from "typescript-eslint"

export default tseslint.config(
  { ignores: [".vite", "dist", "node_modules", "test-results", "playwright-report"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
)

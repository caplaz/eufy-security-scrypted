module.exports = {
  parser: "@typescript-eslint/parser",
  extends: ["eslint:recommended"],
  plugins: ["@typescript-eslint"],
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: "module",
  },
  rules: {
    // Allow console statements in development
    "no-console": "off",
    // Allow unused variables that start with underscore
    "no-unused-vars": "off", // Let TypeScript handle this
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    // Allow require statements
    "no-undef": "off", // TypeScript handles this
  },
  env: {
    node: true,
    es2020: true,
  },
  ignorePatterns: ["node_modules/", "dist/", "coverage/", "*.js", "*.d.ts"],
};

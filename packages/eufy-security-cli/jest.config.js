module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src", "<rootDir>/tests"],
  testMatch: ["**/__tests__/**/*.ts", "**/?(*.)+(spec|test).ts"],
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/main.ts", // Exclude main entry point from coverage
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html", "cobertura"], // coverageReports updated
  setupFilesAfterEnv: ["<rootDir>/tests/setup.ts"],
  testTimeout: 30000,
  verbose: true,
  // Add JUnit reporter for CI test result collection
  reporters: [
    "default",
    ["jest-junit", { outputDirectory: ".", outputName: "jest-results.xml" }],
  ],
  // Ensure all test directories are included
  testPathIgnorePatterns: ["<rootDir>/node_modules/", "<rootDir>/dist/"],
};

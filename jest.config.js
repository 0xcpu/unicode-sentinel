export default {
  testEnvironment: "jest-environment-jsdom",
  transform: {},
  testMatch: ["**/tests/**/*.test.js"],
  testPathIgnorePatterns: ["/node_modules/", "<rootDir>/.worktrees/"],
};

const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: "line",
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});


const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
  testDir: "./test/browser",
  testMatch: "*.spec.js",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:3199",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node test/browser/server.js",
    url: "http://127.0.0.1:3199/dashboard",
    reuseExistingServer: false,
    timeout: 15000,
  },
});

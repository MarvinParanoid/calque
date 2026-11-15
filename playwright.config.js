// Browser regression tests for Calque. The app is static, so tests open
// index.html directly from disk (file://) - no server needed.
//
//   npm install
//   npx playwright install chromium      # once, downloads the matching browser
//   npm test
//
// To reuse an already installed Chromium instead of downloading one:
//   PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome npm test
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests',
    fullyParallel: true,
    reporter: [['list']],
    use: {
        ...devices['Desktop Chrome'],
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
            ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
            : {},
    },
});

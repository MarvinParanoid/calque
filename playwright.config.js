// Browser regression tests for Calque. The app is static, so tests open
// index.html directly from disk (file://) - no server needed.
//
//   npm install
//   npx playwright install chromium      # once, downloads the matching browser
//   npm test                             # Chromium and Firefox
//   npx playwright test --project=chromium
//
// Firefox runs the regular installed Firefox through WebDriver BiDi
// (channel "moz-firefox"), no patched build needed.
//
// Environment overrides:
//   PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome   reuse an installed Chromium
//   PLAYWRIGHT_FIREFOX_PATH=/path/to/firefox   Firefox binary if not found automatically
//   CALQUE_URL=https://.../calque/             test a deployed site instead of the local files
const { defineConfig, devices } = require('@playwright/test');

const executable = (variable) => (process.env[variable] ? { executablePath: process.env[variable] } : {});

module.exports = defineConfig({
    testDir: './tests',
    fullyParallel: true,
    reporter: [['list']],
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'], launchOptions: executable('PLAYWRIGHT_CHROMIUM_PATH') },
        },
        {
            name: 'firefox',
            use: {
                ...devices['Desktop Firefox'],
                channel: 'moz-firefox',
                launchOptions: executable('PLAYWRIGHT_FIREFOX_PATH'),
            },
        },
    ],
});

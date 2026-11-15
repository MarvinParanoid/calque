// No sideways page scroll and no clipped examples on any target size, in both themes.
const { test, expect } = require('@playwright/test');
const { open } = require('./helpers');

const TEXT = [
    'price = 1200',
    'monthly:',
    '  rent = 800',
    'big = 123456789 * 1000',
    '2 inch to cm',
    'foo +',
].join('\n');

const SIZES = [[360, 740], [390, 844], [768, 1024], [1280, 800], [1920, 1080]];

for (const [width, height] of SIZES) {
    for (const theme of ['light', 'dark']) {
        test(`${width}x${height} ${theme}`, async ({ page }) => {
            await page.setViewportSize({ width, height });
            await open(page, { text: TEXT, theme });

            const layout = await page.evaluate(() => ({
                theme: document.documentElement.getAttribute('data-theme'),
                pageScrollsHorizontally: document.documentElement.scrollWidth > window.innerWidth,
                clippedExamples: [...document.querySelectorAll('.card pre')]
                    .filter((pre) => pre.scrollWidth > pre.clientWidth + 1)
                    .map((pre) => pre.textContent),
                resultsRendered: document.querySelectorAll('#output .value').length,
            }));

            expect(layout.theme).toBe(theme);
            expect(layout.pageScrollsHorizontally).toBe(false);
            expect(layout.clippedExamples).toEqual([]);
            expect(layout.resultsRendered).toBe(5);
        });
    }
}

// Desktop browsers with classic (non-overlay) scrollbars - Firefox on Linux,
// Chrome/Edge on Windows - give the scrolling sidebar less room. Firefox draws
// its own classic scrollbar; Playwright starts Chromium with --hide-scrollbars,
// so a separate Chromium is launched without it and given a 17px (Windows) one.
for (const width of [1024, 1280, 1366, 1440, 1600, 1920]) {
    test(`bug: examples fit next to a classic scrollbar at ${width}px`, async ({ page: defaultPage, browserName, playwright, launchOptions }) => {
        let browser = null;
        let page = defaultPage;
        if (browserName === 'chromium') {
            browser = await playwright.chromium.launch({ ...launchOptions, ignoreDefaultArgs: ['--hide-scrollbars'] });
            page = await browser.newPage();
        }
        try {
            await page.setViewportSize({ width, height: 700 }); // short enough for the sidebar to scroll
            await open(page);
            if (browserName === 'chromium') {
                await page.addStyleTag({ content: '.info::-webkit-scrollbar { width: 17px; } .info::-webkit-scrollbar-thumb { background: #888; }' });
            }
            const layout = await page.evaluate(() => {
                const info = document.querySelector('.info');
                return {
                    scrollbar: info.offsetWidth - info.clientWidth - 1, // minus the 1px border
                    sidebarShare: info.offsetWidth / window.innerWidth,
                    clipped: [...document.querySelectorAll('.card pre')]
                        .filter((pre) => pre.scrollWidth > pre.clientWidth + 1)
                        .map((pre) => pre.textContent),
                };
            });
            expect(layout.scrollbar).toBeGreaterThanOrEqual(browserName === 'chromium' ? 17 : 8); // the scenario is real
            expect(layout.clipped).toEqual([]);
            expect(layout.sidebarShare).toBeLessThanOrEqual(0.33);
        } finally {
            if (browser) await browser.close();
        }
    });
}

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

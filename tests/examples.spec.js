// Clicking an example adds it to the editor; on phones, where the editor is
// above the sidebar, the user must see what was added without searching for it.
const { test, expect } = require('@playwright/test');
const { open } = require('./helpers');

const sumsCard = (page) => page.locator('.group', { hasText: 'Sums' }).locator('.card');

// The last line with a result must be inside the visible part of the editor and the viewport.
function insertedLineVisible(page) {
    return page.evaluate(() => {
        const rows = [...document.querySelectorAll('#output > div')].filter((d) => d.querySelector('.data').textContent);
        const last = rows[rows.length - 1].getBoundingClientRect();
        const editor = document.querySelector('.interface').getBoundingClientRect();
        return last.top >= Math.max(0, editor.top) - 1 && last.bottom <= Math.min(window.innerHeight, editor.bottom) + 1;
    });
}

const LONG_TEXT = Array.from({ length: 40 }, (_, i) => `x${i} = ${i}`).join('\n');

for (const focusScrolls of [true, false]) {
    test.describe(`phone, focus() ${focusScrolls ? 'scrolls the page' : 'does not scroll (iOS-like)'}`, () => {
        test.use({ viewport: { width: 390, height: 740 }, isMobile: true, hasTouch: true });

        test.beforeEach(async ({ page }) => {
            if (!focusScrolls) {
                await page.addInitScript(() => {
                    const focus = HTMLElement.prototype.focus;
                    HTMLElement.prototype.focus = function () { return focus.call(this, { preventScroll: true }); };
                });
            }
        });

        test('tapping an example brings the editor and the new lines into view', async ({ page }) => {
            await open(page, { text: LONG_TEXT });
            await sumsCard(page).scrollIntoViewIfNeeded();
            expect(await page.evaluate(() => document.querySelector('.interface').getBoundingClientRect().bottom)).toBeLessThan(0);

            await sumsCard(page).tap();

            await expect.poll(() => insertedLineVisible(page)).toBe(true);
            await expect(page.locator('#input')).toBeFocused();
            await expect(page.locator('#input')).toHaveValue(/x39 = 39\n\nmonthly:\n {2}rent = 800\n {2}food = 350\nmonthly \* 12\n$/);
            await expect(page.locator('#output > div').nth(41)).toContainText('= 1150');
        });
    });
}

test.describe('desktop', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('clicking examples appends them and keeps the page in place', async ({ page }) => {
        await open(page);
        await sumsCard(page).click();
        await page.locator('.group', { hasText: 'Functions' }).locator('.card').click();

        await expect(page.locator('#input')).toHaveValue('monthly:\n  rent = 800\n  food = 350\nmonthly * 12\n\npow2(x) = x ^ 2\npow2(6)\n');
        await expect(page.locator('#output > div').nth(0)).toContainText('= 1150');
        await expect(page.locator('#output > div').nth(6)).toContainText('= 36');
        expect(await page.evaluate(() => window.scrollY)).toBe(0);
        expect(await insertedLineVisible(page)).toBe(true);
    });
});

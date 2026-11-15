// Rendering only changed rows and caching compiled expressions must not change
// results, and large documents must stay responsive.
const { test, expect } = require('@playwright/test');
const { open, calc } = require('./helpers');

test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page);
});

test('editing a line updates dependent rows above and below it', async ({ page }) => {
    // only changed rows are re-rendered: the sum header above the edited line
    // and the lines using the edited variable below must still update
    await calc(page, 'total:\n  a = 5\n  b = 7\ntotal * 2\na');
    const rows = page.locator('#output > div .data');
    await expect(rows.nth(0)).toHaveText(/= 12 /);

    const input = page.locator('#input');
    await input.focus();
    await input.evaluate((el) => el.setSelectionRange(14, 14)); // after "a = 5"
    await page.keyboard.type('0');
    await expect(input).toHaveValue('total:\n  a = 50\n  b = 7\ntotal * 2\na\n');
    await expect(rows.nth(0)).toHaveText(/= 57 /);
    await expect(rows.nth(3)).toHaveText(/= 114 /);
    await expect(rows.nth(4)).toHaveText(/= 50 /);
});

test('a 1000-line document stays responsive while typing', async ({ page }) => {
    const text = Array.from({ length: 1000 }, (_, i) => (i % 10 === 0 ? `g${i}:` : `  v${i} = ${i} * 2`)).join('\n');
    await calc(page, text);
    const ms = await page.evaluate(() => {
        const input = document.querySelector('#input');
        input.focus();
        input.setSelectionRange(input.value.length - 1, input.value.length - 1);
        const start = performance.now();
        for (let i = 0; i < 10; i++) document.execCommand('insertText', false, '1');
        return (performance.now() - start) / 10;
    });
    // generous bound to stay stable on slow machines; typical value is ~10 ms
    expect(ms).toBeLessThan(100);
    await expect(page.locator('#output > div')).toHaveCount(1001);
    await expect(page.locator('#output > div').first().locator('.value')).toHaveText(' = 90'); // 2 * (1 + ... + 9)
});

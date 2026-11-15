// Long expressions, hex/bin and error messages must be reachable on phones by
// scrolling the editor horizontally, without the page itself scrolling sideways,
// and the text/results/caret/active line must stay in sync.
const { test, expect } = require('@playwright/test');
const { open, editorState } = require('./helpers');

const LONG = [
    'big = 123456789',
    'big * 1000',
    'long_variable_name = 42',
    'foo +',
    'x = 1',
].join('\n');

for (const width of [360, 390]) {
    test.describe(`${width}px phone`, () => {
        // mobile/touch emulation where the browser supports it (not Firefox via BiDi)
        test.use({
            viewport: { width, height: 740 },
            isMobile: async ({ browserName }, use) => use(browserName === 'chromium'),
            hasTouch: async ({ browserName }, use) => use(browserName === 'chromium'),
        });

        test('results beyond the screen are reachable by horizontal scroll', async ({ page }) => {
            await open(page, { text: LONG });

            const before = await editorState(page);
            expect(before.hiddenResults).toBeGreaterThan(0); // the scenario really overflows
            expect(before.pageScrollsHorizontally).toBe(false);

            await page.locator('.interface').evaluate((el) => { el.scrollLeft = el.scrollWidth; });
            const after = await editorState(page);
            expect(after.hiddenResults).toBe(0);
            expect(after.layersAligned).toBe(true);
            expect(after.pageScrollsHorizontally).toBe(false);
        });

        test('results stay attached to their line after scrolling', async ({ page }) => {
            await open(page, { text: LONG });
            await page.locator('.interface').evaluate((el) => { el.scrollLeft = 120; });

            const offsets = await page.evaluate(() => {
                const input = document.querySelector('#input');
                const style = getComputedStyle(input);
                const ctx = document.createElement('canvas').getContext('2d');
                ctx.font = style.fontSize + ' ' + style.fontFamily;
                const inputRect = input.getBoundingClientRect();
                const lines = input.value.split('\n');
                return [...document.querySelectorAll('#output > div')].map((row, i) => {
                    const data = row.querySelector('.data').getBoundingClientRect();
                    const expectedX = inputRect.left + parseFloat(style.paddingLeft) + ctx.measureText(lines[i] + ' ').width;
                    const expectedY = inputRect.top + parseFloat(style.paddingTop) + i * parseFloat(style.lineHeight);
                    return Math.max(Math.abs(data.left - expectedX), Math.abs(row.getBoundingClientRect().top - expectedY));
                });
            });
            for (const offset of offsets) expect(offset).toBeLessThan(0.6);
        });

        test('active line highlight spans the row when scrolled', async ({ page }) => {
            await open(page, { text: LONG });
            await page.locator('#input').focus();
            await page.locator('#input').evaluate((el) => el.setSelectionRange(0, 0));
            await page.keyboard.press('ArrowRight');
            await page.locator('.interface').evaluate((el) => { el.scrollLeft = el.scrollWidth; });

            const covers = await page.evaluate(() => {
                const active = document.querySelector('#output > .active').getBoundingClientRect();
                const scroller = document.querySelector('.interface').getBoundingClientRect();
                return active.left <= scroller.left + 1 && active.right >= scroller.right - 1;
            });
            expect(covers).toBe(true);
        });

        test('caret follows typing, Home/End and backwards selection', async ({ page }) => {
            await open(page);
            await page.locator('#input').focus();
            await page.keyboard.type('a_really_long_variable_name = 123456789 * 1000 + 42');
            await expect.poll(async () => (await editorState(page)).caretVisible).toBe(true);
            expect((await editorState(page)).scrollLeft).toBeGreaterThan(0);

            await page.keyboard.press('Home');
            await expect.poll(async () => (await editorState(page)).scrollLeft).toBe(0);

            await page.keyboard.press('End');
            await expect.poll(async () => (await editorState(page)).caretVisible).toBe(true);

            await page.keyboard.press('Shift+Home');
            await expect.poll(async () => (await editorState(page)).caretVisible).toBe(true);
            const selection = await page.locator('#input').evaluate((el) => [el.selectionStart, el.selectionEnd]);
            expect(selection).toEqual([0, 51]);
        });
    });
}

test.describe('desktop', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('caret stays visible with many lines, Ctrl+Home returns to the top', async ({ page }) => {
        await open(page);
        await page.locator('#input').focus();
        await page.keyboard.insertText(Array.from({ length: 60 }, (_, i) => `v${i} = ${i}`).join('\n'));
        await expect.poll(async () => (await editorState(page)).caretVisible).toBe(true);

        await page.keyboard.press('Control+Home');
        await expect.poll(() => page.locator('.interface').evaluate((el) => el.scrollTop)).toBe(0);

        for (let i = 0; i < 45; i++) await page.keyboard.press('ArrowDown');
        await expect.poll(async () => (await editorState(page)).caretVisible).toBe(true);
        expect((await editorState(page)).layersAligned).toBe(true);

        const rows = await page.locator('#output > div').count();
        expect(rows).toBe(60);
    });

    test('mouse click puts the caret on the clicked line after scrolling', async ({ page }) => {
        await open(page, { text: Array.from({ length: 80 }, (_, i) => `v${i} = ${i}`).join('\n') });
        await page.locator('.interface').evaluate((el) => { el.scrollTop = 600; });

        // Click in the middle of the row that shows "v40 = 40"
        const row = page.locator('#output > div').nth(40);
        const box = await row.boundingBox();
        await page.mouse.click(box.x + 40, box.y + box.height / 2);

        const line = await page.locator('#input').evaluate((el) => el.value.slice(0, el.selectionStart).split('\n').length - 1);
        expect(line).toBe(40);
    });
});

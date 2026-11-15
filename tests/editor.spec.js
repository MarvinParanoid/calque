// Editor behaviour: alignment, undo/redo, auto-indent, IME, toggles, theme.
const { test, expect } = require('@playwright/test');
const { open, calc } = require('./helpers');

test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page);
});

// Offset in px between where the textarea draws the end of each line and
// where its result starts (measured with a mirror element in the same font).
function resultOffsets(page, lines) {
    return page.evaluate((lines) => {
        const input = document.querySelector('#input');
        input.value = lines.join('\n') + '\n';
        input.dispatchEvent(new Event('input'));
        const style = getComputedStyle(input);
        const mirror = document.createElement('div');
        Object.assign(mirror.style, { position: 'absolute', whiteSpace: 'pre', font: style.font, tabSize: style.tabSize, visibility: 'hidden' });
        document.body.appendChild(mirror);
        const left = input.getBoundingClientRect().left + parseFloat(style.paddingLeft);
        return [...document.querySelectorAll('#output > div')].slice(0, lines.length).map((row, i) => {
            mirror.textContent = lines[i] + ' ';
            return Math.abs(row.querySelector('.data').getBoundingClientRect().left - left - mirror.getBoundingClientRect().width);
        });
    }, lines);
}

test('bug: results line up after tabs, emoji, CJK and accented letters', async ({ page }) => {
    const offsets = await resultOffsets(page, ['a\t= 1', 'ab\t\t= 2', '😀 = 3', '数 = 4', 'é = 5', 'цена = 6', '  x = 7', 'foo +']);
    for (const offset of offsets) expect(offset).toBeLessThan(0.6);
});

test('bug: rows stay on their lines after blank lines', async ({ page }) => {
    const lines = ['a = 1', '', 'b = 2', '', '', 's:', '  3', '', 'c = 4', 'x +'];
    const tops = await page.evaluate((lines) => {
        const input = document.querySelector('#input');
        input.value = lines.join('\n') + '\n';
        input.dispatchEvent(new Event('input'));
        const style = getComputedStyle(input);
        const top = input.getBoundingClientRect().top + parseFloat(style.paddingTop);
        const lineHeight = parseFloat(style.lineHeight);
        return [...document.querySelectorAll('#output > div')].map((row, i) => Math.abs(row.getBoundingClientRect().top - top - i * lineHeight));
    }, lines);
    expect(tops).toHaveLength(lines.length + 1);
    for (const offset of tops) expect(offset).toBeLessThan(0.6);
});

test('indentation guides are drawn for lines inside sums', async ({ page }) => {
    await calc(page, 's:\n  1\n  t:\n    2');
    const guides = await page.locator('#output .prefix').evaluateAll((els) => els.map((el) => el.getAttribute('data-prefix')));
    expect(guides.slice(0, 4)).toEqual(['', '| ', '| ', '| | ']);
});

test('undo and redo of typing and auto-indent', async ({ page }) => {
    const input = page.locator('#input');
    await input.focus();
    await page.keyboard.type('s:');
    await page.keyboard.press('Enter');
    await page.keyboard.type('5');
    await expect(input).toHaveValue('s:\n  5');

    // Browsers group undo steps differently (Chrome merges the auto-indent with
    // the next typed character, Firefox keeps them apart), so the test checks
    // the states passed through and the end state, not the number of steps.
    const earlier = ['s:\n  5', 's:\n  ', 's:', 's', ''];
    const undone = [];
    for (let i = 0; i < earlier.length && (await input.inputValue()) !== ''; i++) {
        await page.keyboard.press('Control+z');
        undone.push(await input.inputValue());
    }
    expect(undone[undone.length - 1]).toBe('');
    expect(undone).toContain('s:');                       // the auto-indent is undone separately from "s:"
    for (const state of undone) expect(earlier).toContain(state);

    const redone = [];
    for (let i = 0; i < earlier.length && (await input.inputValue()) !== 's:\n  5'; i++) {
        await page.keyboard.press(i % 2 ? 'Control+y' : 'Control+Shift+z'); // both redo shortcuts
        redone.push(await input.inputValue());
    }
    expect(redone[redone.length - 1]).toBe('s:\n  5');
    for (const state of redone) expect(earlier).toContain(state);
    await expect(page.locator('#output > div').first()).toContainText('= 5');
});

test('bug: inserting an example can be undone', async ({ page }) => {
    const input = page.locator('#input');
    await input.focus();
    await page.keyboard.type('a = 1');
    await page.locator('.group', { hasText: 'Functions' }).locator('.card').click();
    await expect(input).toHaveValue('a = 1\n\npow2(x) = x ^ 2\npow2(6)\n');

    await page.keyboard.press('Control+z');
    await expect(input).toHaveValue('a = 1');
    await page.keyboard.press('Control+Shift+z');
    await expect(input).toHaveValue('a = 1\n\npow2(x) = x ^ 2\npow2(6)\n');
    await expect(page.locator('#output > div').nth(3)).toContainText('= 36');
});

test('multi-line paste is calculated and kept in the URL', async ({ page }) => {
    await page.locator('#input').focus();
    await page.keyboard.insertText('a = 2\nb = a * 3\n  c:\nb + 1');
    const rows = await page.locator('#output > div .data').allTextContents();
    expect(rows.map((t) => t.trim())).toEqual(['= 2 = 0x2 = 0b10', '= 6 = 0x6 = 0b110', expect.stringContaining('Unexpected indent'), '= 7 = 0x7 = 0b111']);
    expect(await page.evaluate(() => location.hash)).not.toBe('');
});

test('auto-indent ignores Enter during IME composition', async ({ page }) => {
    const result = await page.evaluate(() => {
        const input = document.querySelector('#input');
        input.value = 'a:';
        input.setSelectionRange(2, 2);
        const event = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, cancelable: true, bubbles: true });
        input.dispatchEvent(event);
        return { prevented: event.defaultPrevented, value: input.value };
    });
    expect(result).toEqual({ prevented: false, value: 'a:' });
});

test('dec / hex / bin toggles change the output only', async ({ page }) => {
    await calc(page, '255');
    const first = page.locator('#output > div').first();
    await expect(first).toHaveText(/= 255 = 0xFF = 0b11111111/);
    await page.locator('label:has(#checkHex)').click();
    await expect(first).toHaveText(/= 255 = 0b11111111/);
    await page.locator('label:has(#checkDec)').click();
    await page.locator('label:has(#checkBin)').click();
    await expect(first.locator('.data')).toHaveText('');
    await page.locator('label:has(#checkDec)').click();
    await expect(first.locator('.data')).toHaveText(' = 255');
    await expect(page.locator('#input')).toHaveValue('255\n');
});

test('theme switch keeps results aligned', async ({ page }) => {
    const before = await resultOffsets(page, ['x = 1', 'long_name = 2']);
    await page.locator('label:has(#rbDark)').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const after = await resultOffsets(page, ['x = 1', 'long_name = 2']);
    for (const offset of [...before, ...after]) expect(offset).toBeLessThan(0.6);
});

test('typical use produces no JavaScript errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

    await open(page, { text: 'price = 1200\nprice * 3\n' });
    const input = page.locator('#input');
    await input.focus();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('monthly:');
    await page.keyboard.press('Enter');
    await page.keyboard.type('rent = 800');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('foo +');
    await page.keyboard.press('Enter');
    await page.keyboard.type('0xFF + sqrt(-4) + 2 inch to cm');
    await page.keyboard.press('Control+z');
    await page.locator('.group', { hasText: 'Functions' }).locator('.card').click();
    for (const toggle of ['#checkHex', '#checkBin', '#rbDark', '#checkHex', '#rbLight']) await page.locator(`label:has(${toggle})`).click();
    await page.locator('#copyLink').click();
    await page.evaluate(() => { location.hash = 'a' + btoa('1 + 1'); });
    await expect(input).toHaveValue('1 + 1');

    await expect(page.locator('#output > div').first()).toContainText('= 2');
    expect(errors).toEqual([]);
});

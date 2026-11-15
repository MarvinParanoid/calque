// The document lives in the URL hash: it must round-trip exactly and broken
// hashes must not break the page.
const { test, expect } = require('@playwright/test');
const { INDEX, open } = require('./helpers');

const decode = (page) => page.evaluate(() => {
    const hash = location.hash.slice(1);
    if (!hash) return '';
    return hash[0] === 'a' ? atob(hash.slice(1)) : unescape(atob(hash.slice(1)));
});

for (const [name, text] of Object.entries({
    'ASCII': 'price = 1200\nprice * 3',
    'Cyrillic and symbols': 'цена = 5 € — ok\nцена * 2',
    'indentation and blank lines': 'monthly:\n  rent = 800\n\n  food = 350\n',
    'quotes, percent, hash, plus': '"a" + \'b\' % # + & ? =',
    'emoji and CJK': '😀 = 1\n数 = 2',
})) {
    test(`round-trip: ${name}`, async ({ page }) => {
        await open(page);
        await page.locator('#input').fill(text);
        expect(await decode(page)).toBe(text);

        await page.reload();
        await expect(page.locator('#input')).toHaveValue(text);
    });
}

test('old-style links (a/e prefixes) still open', async ({ page }) => {
    await page.goto(INDEX + '#a' + Buffer.from('2+2').toString('base64'));
    await expect(page.locator('#input')).toHaveValue('2+2');
    await page.goto(INDEX + '#e' + Buffer.from(escape('цена = 5')).toString('base64'));
    await page.reload();
    await expect(page.locator('#input')).toHaveValue('цена = 5');
});

for (const [name, hash] of Object.entries({
    'invalid base64': '#a!!!',
    'unknown prefix': '#zAAAA',
    'single character': '#a',
    'broken escape sequence': '#e' + Buffer.from('%u12%zz%').toString('base64'),
})) {
    test(`broken hash does not break the page: ${name}`, async ({ page }) => {
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(INDEX + hash);
        await page.waitForFunction(() => window.calque);
        await page.locator('#input').fill('1 + 1');
        await expect(page.locator('#output > div').first()).toContainText('= 2');
        expect(errors).toEqual([]);
    });
}

test('bug: opening another link in the same tab loads its text', async ({ page }) => {
    await open(page, { text: 'first = 1' });
    // same document, only the hash changes - the browser does not reload
    await page.goto(INDEX + '#e' + Buffer.from(escape('second = 2')).toString('base64'));
    await expect(page.locator('#input')).toHaveValue('second = 2');
    await expect(page.locator('#output > div').first()).toContainText('= 2');

    // typing afterwards keeps the new document in the URL
    await page.locator('#input').press('End');
    await page.keyboard.type(' * 3');
    expect(await decode(page)).toBe('second = 2 * 3');
});

test('clearing the editor removes the hash', async ({ page }) => {
    await open(page, { text: '1 + 1' });
    await page.locator('#input').fill('');
    // read from the page: page.url() learns about replaceState asynchronously
    expect(await page.evaluate(() => location.hash)).toBe('');
});

test('large document round-trips', async ({ page }) => {
    const text = Array.from({ length: 1000 }, (_, i) => `v${i} = ${i} * 2`).join('\n');
    await open(page, { text });
    await expect(page.locator('#input')).toHaveValue(text);
    await expect(page.locator('#output > div').nth(999)).toContainText('= 1998');
});

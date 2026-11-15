// Text arrives from shared links, so expressions are untrusted input.
const { test, expect } = require('@playwright/test');
const { open, values, calc } = require('./helpers');

test.beforeEach(async ({ page }) => {
    await open(page);
});

test('results and error messages are rendered as text, not HTML', async ({ page }) => {
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
    const rows = await calc(page, [
        '"<img src=x onerror=alert(1)>"',
        '"<script>alert(2)</script>"',
        '"\\" data-x=\\"1"',
        '<img src=x onerror=alert(3)>',
        'undefinedFn("<b>x</b>")',
    ].join('\n'));
    expect(rows[0].text).toBe('= <img src=x onerror=alert(1)>');
    expect(rows[1].text).toBe('= <script>alert(2)</script>');
    expect(rows[3].cls).toBe('error');
    expect(await page.locator('#output img, #output script, #output b').count()).toBe(0);
    expect(dialogs).toEqual([]);
});

test('JavaScript is not reachable from expressions', async ({ page }) => {
    const v = await values(page, [
        'cos.constructor',
        '[].constructor',
        '"".constructor.constructor("return 1")',
        'f(x) = x\nf.constructor("return 1")',
    ].join('\n'));
    for (const line of [v[0], v[1], v[2], v[4]]) expect(line).toMatch(/^ERR Error: No access to (property|method) "constructor"/);
});

test('expressions cannot change math.js configuration or units', async ({ page }) => {
    const v = await values(page, [
        'config({number: "BigNumber"})',
        'createUnit("cm", "1000 m", {override: true})',
        'import({pi: 3})',
        'evaluate("config({number: \\"BigNumber\\"})")',
        'parse("createUnit(\\"foo\\")").evaluate()',
    ].join('\n'));
    for (const line of v) expect(line).toMatch(/^ERR Error: Function (config|createUnit|import) is not available in Calque$/);

    // nothing leaked into later calculations
    expect(await values(page, 'typeOf(0.1)\n2 inch to cm\npi')).toEqual(['number', '5.08 cm', '3.14159265358979']);
});

test('huge allocations are refused instead of freezing the tab', async ({ page }) => {
    const started = Date.now();
    const v = await values(page, [
        'ones(20000, 20000)', 'zeros([5000, 5000])', 'identity(2000)', 'range(1, 1e8)', 'range("0:1e-7:1")',
        'random([2000, 2000])', 'resize([1], [2000, 2000])', 'kron(ones(1000, 1000), ones(10, 10))',
        'setPowerset(range(1, 30))', 'matrixFromFunction([2000, 2000], f(i) = 1)',
    ].join('\n'));
    for (const line of v) expect(line).toMatch(/^ERR Error: Result of \w+ is too large/);
    expect(Date.now() - started).toBeLessThan(3000);
});

test('normal matrix and range use is not limited', async ({ page }) => {
    expect(await values(page, 'size(zeros(1000, 1000))\nsum(range(1, 101))\nsize(identity(100))\nrandomInt(1, 7) < 7\nsetPowerset([1, 2])')).toEqual(
        ['[1000, 1000]', '5050', '[100, 100]', 'true', '[[], [1], [2], [1, 2]]']);
});

test('a malicious link does not freeze the page on load', async ({ page }) => {
    await page.goto('about:blank'); // a real page load, as when the link opens in a new tab
    await open(page, { text: 'ones(20000, 20000)\nrange(1, 1e9)\n2 + 2\n' });
    await expect(page.locator('#output > div').nth(2)).toContainText('= 4');
});

test('huge matrices are summarised, long results cut', async ({ page }) => {
    const rows = await calc(page, 'zeros(1000, 1000)\nones(1, 900)');
    expect(rows[0].text).toBe('= matrix 1000 × 1000');
    // 900 elements: formatted (not summarised), but the text is cut at 1000 characters
    expect(rows[1].text.startsWith('= [[1, 1, 1')).toBe(true);
    expect(rows[1].text.length).toBe(2 + 1000 + 1);
    expect(rows[1].text.endsWith('…')).toBe(true);
});

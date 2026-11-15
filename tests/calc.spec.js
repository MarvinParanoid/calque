// Calculation behaviour as the user sees it. Tests marked "bug:" reproduce
// problems found in the audit; the expected value is the corrected behaviour.
const { test, expect } = require('@playwright/test');
const { open, calc, values } = require('./helpers');

test.beforeEach(async ({ page }) => {
    await open(page);
});

test.describe('arithmetic and precedence', () => {
    test('operators, precedence, functions', async ({ page }) => {
        expect(await values(page, [
            '2 + 3 * 4', '(2 + 3) * 4', '2 ^ 3 ^ 2', '-2 ^ 2', '10 / 4', '7 mod 3', '5!', 'sqrt(3^2 + 4^2)', '1e3', '2 * pi > 6',
        ].join('\n'))).toEqual(['14', '20', '512', '-4', '2.5', '1', '120', '5', '1000', 'true']);
    });

    test('zero, negative and fractional results are shown', async ({ page }) => {
        expect(await values(page, '0\n-5\n0.5\n1/4\n-0.25')).toEqual(['0', '-5', '0.5', '0.25', '-0.25']);
    });

    test('NaN and Infinity', async ({ page }) => {
        expect(await values(page, '0/0\n1/0\n-1/0')).toEqual(['NaN', 'Infinity', '-Infinity']);
    });
});

test.describe('variables and functions', () => {
    test('definition, use, redefinition', async ({ page }) => {
        expect(await values(page, 'a = 2\na * 3\na = a * 10\na\nf(x) = x + 1\nf(1)\nf(x) = x * 2\nf(3)')).toEqual(
            ['2', '6', '20', '20', 'fn', '2', 'fn', '6']);
    });

    test('use before definition is an error, later lines still work', async ({ page }) => {
        expect(await values(page, 'a + 1\na = 2\na + 1')).toEqual(['ERR Error: Undefined symbol a', '2', '3']);
    });

    test('last refers to the previous result', async ({ page }) => {
        expect(await values(page, '5\nlast * 2\n\nlast + 1')).toEqual(['5', '10', '', '11']);
    });

    test('bug: an error line does not reset last', async ({ page }) => {
        expect(await values(page, '5\nfoo +\nlast + 1')).toEqual(['5', 'ERR SyntaxError: Unexpected end of expression (char 6)', '6']);
    });

    test('variable names with spaces', async ({ page }) => {
        expect(await values(page, 'my var = 5\nmy var * 2\nmy variable = 3\nmy variable + my var')).toEqual(['5', '10', '3', '8']);
    });
});

test.describe('sums', () => {
    test('sum of indented lines, including zero, negative and fractions', async ({ page }) => {
        expect(await values(page, 's:\n  0\n  -3\n  1.5\ns')).toEqual(['-1.5', '0', '-3', '1.5', '-1.5']);
    });

    test('nested sums and outdent', async ({ page }) => {
        expect(await values(page, 'a:\n  b:\n    1\n    2\n  3\n  c:\n    10\na\nb\nc')).toEqual(
            ['16', '3', '1', '2', '3', '10', '10', '16', '3', '10']);
    });

    test('error lines inside a sum are skipped', async ({ page }) => {
        const v = await values(page, 's:\n  5\n  foo +\n  3\ns');
        expect([v[0], v[3], v[4]]).toEqual(['8', '3', '8']);
        expect(v[2]).toMatch(/^ERR/);
    });

    test('blank lines do not close a sum; an unindented line does', async ({ page }) => {
        expect(await values(page, 's:\n  1\n\n  2\nafter = s\n  7\ns')).toEqual(['3', '1', '', '2', '3', '7', '3']);
    });

    test('bug: sum of values with units', async ({ page }) => {
        expect(await values(page, 'len:\n  5 cm\n  2 cm\nlen')).toEqual(['7 cm', '5 cm', '2 cm', '7 cm']);
    });

    test('bug: nested sums with units', async ({ page }) => {
        expect(await values(page, 'total:\n  a:\n    5 cm\n  20 mm\ntotal')).toEqual(['7 cm', '5 cm', '5 cm', '20 mm', '7 cm']);
    });

    test('bug: a function definition inside a sum does not break it', async ({ page }) => {
        expect(await values(page, 's:\n  f(x) = x + 1\n  f(2)\n  10\ns')).toEqual(['13', 'fn', '3', '10', '13']);
    });

    test('bug: a failed sum leaves no partial value in its variable', async ({ page }) => {
        // 5 cm is added, 3 kg cannot be: the sum is an error, and so is any use of it
        expect(await values(page, 'len:\n  5 cm\n  3 kg\n  2 cm\nlen\nlen + 1 cm')).toEqual([
            'ERR Error: Sum can not be calculated', '5 cm', '3 kg', '2 cm',
            'ERR Error: Undefined symbol len', 'ERR Error: Undefined symbol len',
        ]);
        // ("s" alone would be the unit "second", so the sum is named "total")
        expect(await values(page, 'total:\n  1\n  "abc"\n  2\ntotal')).toEqual([
            'ERR Error: Sum can not be calculated', '1', 'abc', '2', 'ERR Error: Undefined symbol total',
        ]);
    });

    test('bug: fixing and breaking a sum line recalculates without stale values', async ({ page }) => {
        const input = page.locator('#input');
        const rows = page.locator('#output > div');
        await values(page, 'len:\n  5 cm\n  3 kg\n  2 cm\nlen');
        await expect(rows.nth(4)).toHaveClass(/error/);

        // fix the broken line: 3 kg -> 3 cm
        await input.focus();
        await input.evaluate((el) => { const at = el.value.indexOf('kg'); el.setSelectionRange(at, at + 2); });
        await page.keyboard.type('cm');
        await page.keyboard.press('Control+End');
        await expect(rows.nth(0).locator('.value')).toHaveText(' = 10 cm');
        await expect(rows.nth(4).locator('.value')).toHaveText(' = 10 cm');

        // break it again: the old 10 cm must not survive in the variable
        await input.evaluate((el) => { const at = el.value.indexOf('3 cm') + 2; el.setSelectionRange(at, at + 2); });
        await page.keyboard.type('kg');
        await page.keyboard.press('Control+End');
        await expect(rows.nth(0)).toHaveClass(/error/);
        await expect(rows.nth(4)).toHaveClass(/error/);
        await expect(rows.nth(4).locator('.message')).toHaveText('Error: Undefined symbol len');
    });

    test('a header without items is 0', async ({ page }) => {
        expect(await values(page, 'empty:\nempty + 1')).toEqual(['0', '1']);
    });

    test('header with unexpected indent is reported', async ({ page }) => {
        expect((await values(page, 'a:\n    b:\n      1'))[1]).toBe('ERR Error: Unexpected indent');
    });
});

test.describe('hex and binary', () => {
    test('literals and output in all bases', async ({ page }) => {
        const rows = await calc(page, '0xFF\n0b1010\n0x0b1\n0xff + 0b11\n-0x10\n255');
        expect(rows.map((r) => r.text)).toEqual([
            '= 255 = 0xFF = 0b11111111', '= 10 = 0xA = 0b1010', '= 177 = 0xB1 = 0b10110001',
            '= 258 = 0x102 = 0b100000010', '= -16 = -0x10 = -0b10000', '= 255 = 0xFF = 0b11111111',
        ]);
    });

    test('hex/bin are not shown for non-integers, units, complex, booleans', async ({ page }) => {
        const rows = await calc(page, '0.5\n5 cm\n2i\ntrue\n2^60');
        expect(rows.map((r) => r.text)).toEqual(['= 0.5', '= 5 cm', '= 2i', '= true', '= 1152921504606847000']);
    });

    test('bug: invalid literals are errors, not wrong numbers', async ({ page }) => {
        const v = await values(page, '0b102\n10b1\n0xFFcm\n0x1.8');
        expect(v[0]).toMatch(/^ERR/);   // was 22
        expect(v[1]).toMatch(/^ERR/);   // was 11
        expect(v[2]).toMatch(/^ERR/);   // was 4.092 km (0xFFc m)
        expect(v[3]).toBe('1.5');       // hexadecimal fraction, was 1.8
    });

    test('bug: hex-like parts of identifiers and strings are left alone', async ({ page }) => {
        expect(await values(page, 'a1 = 3\na0x1 = 5\na1\na0x1\n"0xFF"')).toEqual(['3', '5', '3', '5', '0xFF']);
    });

    test('large literals', async ({ page }) => {
        expect(await values(page, '0xFFFFFFFF\n0x7FFFFFFFFFFFFFFF')).toEqual(['4294967295', '9223372036854776000']);
    });
});

test.describe('number formatting', () => {
    test('non-integers: 15 significant digits, no floating point noise', async ({ page }) => {
        expect(await values(page, '0.1 + 0.2\n100 * 1.1\n1/3\n2/3\n123456.5\n0.001234\n1e-7\n(0.1 + 0.2) + 2i\n[0.1 + 0.2, 3]')).toEqual(
            ['0.3', '110', '0.333333333333333', '0.666666666666667', '123456.5', '0.001234', '1e-7', '0.3 + 2i', '[0.3, 3]']);
    });

    test('integers are shown in full, as before', async ({ page }) => {
        expect(await values(page, '2^53 - 1\n2^60\n1e21\n-42')).toEqual(['9007199254740991', '1152921504606847000', '1e+21', '-42']);
    });
});

test.describe('units and complex numbers', () => {
    test('conversions and arithmetic', async ({ page }) => {
        expect(await values(page, '2 inch to cm\n5 cm + 2 inch\n10 kg * 9.81 m/s^2\nsqrt(-4)\n(1+2i)*(3-i)')).toEqual(
            ['5.08 cm', '10.08 cm', '98.1 N', '2i', '5 + 5i']);
    });

    test('incompatible units are an error', async ({ page }) => {
        expect(await values(page, '5 cm + 3 kg')).toEqual(['ERR Error: Units do not match']);
    });
});

test.describe('unicode', () => {
    test('Cyrillic variable names, with spaces and ё', async ({ page }) => {
        expect(await values(page, 'цена = 100\nцена * 2\nмоя цена = 5\nмоя цена + цена\nёлка = 1\nёлка')).toEqual(
            ['100', '200', '5', '105', '1', '1']);
    });

    test('Cyrillic in error messages is readable', async ({ page }) => {
        expect(await values(page, 'сумма + 1')).toEqual(['ERR Error: Undefined symbol сумма']);
    });

    test('bug: Cyrillic string literals are shown as typed', async ({ page }) => {
        expect(await values(page, '"привет"\n"цена: " + "5"')).toEqual(['привет', 'ERR Error: Cannot convert "цена: " to a number']);
    });

    test('bug: "=" and spaces inside strings are not treated as assignments', async ({ page }) => {
        expect((await calc(page, '"a b = c"'))[0].text).toBe('= a b = c');
    });

    test('bug: other Cyrillic letters (Ukrainian, Belarusian)', async ({ page }) => {
        expect(await values(page, 'ціна = 5\nціна * 2\nўзровень = 3\nґанок = 1\nєнот = 2')).toEqual(['5', '10', '3', '1', '2']);
    });
});

test.describe('invalid expressions', () => {
    test('errors do not affect following lines', async ({ page }) => {
        const v = await values(page, '1 +\n2 + 2\n)\n3 * 3\nunknownFn(2)\n4');
        expect([v[1], v[3], v[5]]).toEqual(['4', '9', '4']);
        expect([v[0], v[2], v[4]].every((x) => x.startsWith('ERR'))).toBe(true);
    });

    test('errors on the active line are hidden until the caret leaves it', async ({ page }) => {
        await page.locator('#input').focus();
        await page.keyboard.type('1 +');
        await expect(page.locator('#output > div').first()).toHaveClass(/empty/);
        await page.keyboard.press('Enter');
        await expect(page.locator('#output > div').first()).toHaveClass(/error/);
    });
});

// "Copied!" must appear only after the copy really succeeded.
const { test, expect } = require('@playwright/test');
const { open } = require('./helpers');

const button = (page) => page.locator('#copyLink');
const hint = (page) => page.locator('#copyHint');

test('Clipboard API success shows Copied! and copies the URL', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page, { text: '2 + 2' });
    await button(page).click();

    await expect(button(page)).toHaveText('Copied!');
    await expect(button(page)).toHaveClass(/copied/);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await page.evaluate(() => location.href));
    await expect(button(page)).toHaveText('Copy link', { timeout: 3000 });
});

test('falls back to execCommand when the Clipboard API is refused', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText: () => Promise.reject(new Error('denied')) },
        });
        window.__copied = null;
        document.execCommand = (command) => {
            window.__copied = command === 'copy' ? document.activeElement.value : null;
            return true;
        };
    });
    await open(page, { text: '2 + 2' });
    await button(page).click();

    await expect(button(page)).toHaveText('Copied!');
    expect(await page.evaluate(() => window.__copied)).toBe(await page.evaluate(() => location.href));
});

test('shows a failure state when copying is impossible', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText: () => Promise.reject(new Error('denied')) },
        });
        document.execCommand = () => false;
    });
    await open(page);
    await button(page).click();

    await expect(button(page)).toHaveText('Couldn’t copy');
    await expect(button(page)).toHaveClass(/failed/);
    await expect(button(page)).not.toHaveClass(/copied/);
    await expect(hint(page)).toHaveText('Copy the link from the address bar.');
});

test('shows a failure state when there is no clipboard support at all', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', { value: undefined });
        document.execCommand = () => { throw new Error('not supported'); };
    });
    await open(page);
    await button(page).click();

    await expect(button(page)).toHaveText('Couldn’t copy');
    await expect(button(page)).toHaveText('Copy link', { timeout: 6000 });
    await expect(hint(page)).toHaveText('The link contains everything you typed.');
});

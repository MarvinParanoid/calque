# Calque

A calculator notepad in the browser: type expressions line by line, results
appear next to each line. Built on [math.js](https://mathjs.org); static files,
no build step. Open `index.html` or https://marvinparanoid.github.io/calque/.

## Syntax

```
price = 1200              variables (names may contain spaces and Cyrillic)
price * 3                 expressions, functions, units: 2 inch to cm
last + 1                  previous result
f(x) = x ^ 2              functions
0xFF + 0b101              hex / binary / octal literals; results also shown in hex and bin

monthly:                  a line ending with ":" sums the lines indented below it
  rent = 800
  food = 350
monthly * 12
```

The document is stored in the URL hash, so the link contains everything you typed.

## Notes

- **Precision.** Non-integer results are *displayed* rounded to 15 significant
  digits, which hides binary floating point noise (`0.1 + 0.2` shows `0.3`).
  Calculations themselves use full double precision; integers are shown in full.
- **Untrusted links.** Expressions cannot run JavaScript or change math.js
  configuration (`config`, `createUnit`, `import` are disabled), and functions
  that create matrices, ranges or sets refuse results over 1,000,000 elements.
  This protection against resource-heavy expressions is **not complete**: a
  costly computation within the limits can still make the tab unresponsive.

## Tests

Browser tests use Playwright:

```
npm install
npx playwright install chromium   # once
npm test
```

To reuse an installed Chromium: `PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome npm test`.

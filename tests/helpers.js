const path = require('path');
const { pathToFileURL } = require('url');

const INDEX = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

// Same encoding as calque.js encodeData('e' variant): works for any text.
function hashFor(text) {
    return 'e' + Buffer.from(escape(text)).toString('base64');
}

async function open(page, { text = '', theme } = {}) {
    const query = theme ? '?style=' + theme : '';
    await page.goto(INDEX + query + (text ? '#' + hashFor(text) : ''));
    await page.waitForFunction(() => window.calque);
}

// Caret and results geometry, measured the same way the editor lays them out.
function editorState(page) {
    return page.evaluate(() => {
        const input = document.querySelector('#input');
        const output = document.querySelector('#output');
        const scroller = input.parentNode;
        const style = getComputedStyle(input);
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.font = style.fontSize + ' ' + style.fontFamily;
        const caretPos = input.selectionDirection === 'backward' ? input.selectionStart : input.selectionEnd;
        const before = input.value.slice(0, caretPos);
        const row = before.split('\n').length - 1;
        const lineHeight = parseFloat(style.lineHeight);
        const caretX = parseFloat(style.paddingLeft) + ctx.measureText(before.slice(before.lastIndexOf('\n') + 1)).width
            - input.scrollLeft - scroller.scrollLeft;
        const caretY = parseFloat(style.paddingTop) + row * lineHeight - input.scrollTop - scroller.scrollTop;
        const scrollerRect = scroller.getBoundingClientRect();
        return {
            caretVisible: caretX >= 0 && caretX <= scroller.clientWidth
                && caretY >= 0 && caretY + lineHeight <= scroller.clientHeight,
            layersAligned: input.scrollTop === output.scrollTop && input.scrollLeft === output.scrollLeft,
            scrollLeft: scroller.scrollLeft,
            hiddenResults: [...output.querySelectorAll('.data')]
                .filter((d) => d.textContent && d.getBoundingClientRect().right > scrollerRect.right + 0.5).length,
            pageScrollsHorizontally: document.documentElement.scrollWidth > window.innerWidth,
        };
    });
}

module.exports = { INDEX, open, editorState };

(function () {
    // ---------- Expression sandbox hardening ----------
    // Text comes from shared links, so expressions must not be able to change
    // the global math.js state (it would outlive the line that did it) or
    // freeze the tab by allocating huge structures.

    var MAX_ELEMENTS = 1e6;      // largest matrix / range / set an expression may create
    var MAX_RESULT_CHARS = 1000; // longer results are cut in the output

    function disabled(name) {
        return function () {
            throw new Error('Function ' + name + ' is not available in Calque');
        };
    }

    function count(value) {
        if (value && value.isMatrix) value = value.valueOf();
        if (!Array.isArray(value)) return 1;
        return value.reduce(function (total, item) { return total + count(item); }, 0);
    }

    function product(dims) {
        return dims.reduce(function (total, dim) { return total * Math.abs(Number(dim)); }, 1);
    }

    // zeros(2, 3), zeros([2, 3]), zeros(matrix([2, 3])), with an optional format string
    function dimsOf(args) {
        var first = args[0];
        if (first && (Array.isArray(first) || first.isMatrix)) return [].concat(first.valueOf());
        return Array.prototype.filter.call(args, function (arg) { return typeof arg !== 'string'; });
    }

    function rangeLength(args) {
        if (typeof args[0] === 'string') {
            var parts = args[0].split(':').map(Number); // "start:end" or "start:step:end"
            args = parts.length === 3 ? [parts[0], parts[2], parts[1]] : parts;
        }
        var step = args.length > 2 && typeof args[2] !== 'boolean' ? args[2] : 1;
        return math.number(math.abs(math.divide(math.subtract(args[1], args[0]), step)));
    }

    function limited(name, sizeOf) {
        var original = math[name];
        return function () {
            var size;
            try { size = sizeOf(arguments); } catch (e) { size = 0; } // let math.js report bad arguments
            if (size > MAX_ELEMENTS) {
                throw new Error('Result of ' + name + ' is too large (more than ' + MAX_ELEMENTS + ' elements)');
            }
            return original.apply(math, arguments);
        };
    }

    math.import({
        'import': disabled('import'),
        createUnit: disabled('createUnit'),
        config: disabled('config'),
        zeros: limited('zeros', function (a) { return product(dimsOf(a)); }),
        ones: limited('ones', function (a) { return product(dimsOf(a)); }),
        identity: limited('identity', function (a) {
            var dims = dimsOf(a);
            return dims.length === 1 ? product(dims) * product(dims) : product(dims);
        }),
        // random(), random(max), random(min, max) are scalars; random(size, ...) is a matrix
        random: limited('random', function (a) { return a[0] && typeof a[0] === 'object' ? product(dimsOf(a)) : 1; }),
        randomInt: limited('randomInt', function (a) { return a[0] && typeof a[0] === 'object' ? product(dimsOf(a)) : 1; }),
        range: limited('range', rangeLength),
        resize: limited('resize', function (a) { return product(dimsOf([a[1]])); }),
        matrixFromFunction: limited('matrixFromFunction', function (a) { return product(dimsOf([a[0]])); }),
        kron: limited('kron', function (a) { return count(a[0]) * count(a[1]); }),
        setCartesian: limited('setCartesian', function (a) { return count(a[0]) * count(a[1]); }),
        setPowerset: limited('setPowerset', function (a) { return Math.pow(2, count(a[0])); })
    }, { override: true });

    // math.js identifiers can't contain Cyrillic, so letters of the whole
    // Cyrillic block are encoded as _x<code>x_ before evaluation.
    function translit(text){
        return text.replace(/[\u0400-\u04FF]/g, function (match) {
            return '_x' + match.charCodeAt() + 'x_';
        });
    }

    function detranslit(text) {
        return text.replace(/_x(\d+)x_/g, function (match, code) {
            return String.fromCharCode(code);
        });
    }
	
	function decodeData(encodedData) {
        if (encodedData.length > 1) {
            var encodingType = encodedData[0];
            encodedData = encodedData.slice(1);     
            if ('a' == encodingType) {
                return atob(encodedData);
            }
            if ('e' == encodingType) {
                return unescape(atob(encodedData));
            }
        }
        return '';
    };
	
    function encodeData(data) {
        if (!data.length) return '';
        try {
            var encodedData = btoa(data);
            if (atob(encodedData) == data) {
                return 'a' + encodedData;
            }
        } catch (e) {}
        return 'e' + btoa(escape(data));
    };
	
    // String literals ("..." or '...') must be left as typed: no name
    // rewriting, transliteration or assignment detection inside them.
    var STRING_LITERAL = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/;

    function outsideStrings(code, fn) {
        return code.split(STRING_LITERAL).map(function (part, i) {
            return i % 2 ? part : fn(part);
        }).join('');
    }

    function withoutStrings(code) {
        return code.split(STRING_LITERAL).filter(function (part, i) {
            return i % 2 === 0;
        }).join('""');
    }

    function escapeRegExp(text) {
        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // Names on the left of assignment '=' (not ==, <=, >=, !=).
    // For function definitions "f(x) = ..." the name is the part before '('.
    function assignedNames(code) {
        return code.split(/(?<![=<>!])=(?!=)/).slice(0, -1).map(function (part) {
            var paren = part.indexOf('(');
            return (paren >= 0 ? part.substr(0, paren) : part).trim();
        });
    }

    // Variable names may contain spaces ("my var"); such names are
    // rewritten to "my_var" before evaluation.
    function addSpacevar(spacevars, name) {
        if (!/^[\wа-яА-ЯёЁ]+( +[\wа-яА-ЯёЁ]+)+$/.test(name)) return;
        spacevars.splice(0, 0, {
            original: name,
            replaced: name.replace(/ /g, '_'),
            regexp: new RegExp(escapeRegExp(name), 'g')
        });
    }

    var INDENT = '  ';

    // Replace text in [start, end) keeping the browser undo stack (Ctrl+Z).
    function replaceRange(el, start, end, text) {
        el.setSelectionRange(start, end);
        // insertText('') misplaces the caret in Chrome, so deletions use 'delete'
        var ok = text ? document.execCommand('insertText', false, text)
                      : start === end || document.execCommand('delete');
        if (!ok) {
            el.setRangeText(text, start, end, 'end');
            el.dispatchEvent(new Event('input'));
        }
    }

    // Editor-like indentation for sums:
    // - Enter after "name:" opens an indented line;
    // - Enter keeps the current indent;
    // - Enter on an empty indented line steps one level out;
    // - Backspace inside the indent removes a whole level.
    function autoIndent(event) {
        var el = event.target;
        if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
        if (el.selectionStart !== el.selectionEnd) return;

        var caret = el.selectionStart;
        var lineStart = el.value.lastIndexOf('\n', caret - 1) + 1;
        var before = el.value.slice(lineStart, caret);
        var indent = before.match(/^ */)[0];

        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            if (before.length && before === indent) {
                var outdented = indent.slice(0, Math.max(0, indent.length - INDENT.length));
                replaceRange(el, lineStart, caret, outdented);
            } else {
                if (before.trim().slice(-1) === ':') indent += INDENT;
                replaceRange(el, caret, caret, '\n' + indent);
            }
        } else if (event.key === 'Backspace' && before.length && before === indent) {
            event.preventDefault();
            var remove = before.length % INDENT.length || INDENT.length;
            replaceRange(el, caret - remove, caret, '');
        }
    }

    function Calque(inputEl, outputEl) {
        this.inputEl = inputEl;
        this.outputEl = outputEl;

        this.raw = '';
        this.lines = [];
        this.expressions = [];
        this.activeLine = 0;

		if (window.location.hash.length) {
			try {
				inputEl.value = decodeData(window.location.hash.slice(1));
			} catch(e) {}
		}
		
        var syncScroll = function () {
            outputEl.scrollTop = inputEl.scrollTop;
            outputEl.scrollLeft = inputEl.scrollLeft;
        };

        var handler = function (event) {
            this.updateActiveLine();
            this.input();
            syncScroll();
            // Typing, paste, undo may put the caret outside the visible area
            // after the layers were resized; scroll the editor to it.
            if (event && event.type === 'input') this.revealCaret();
        }.bind(this);

        handler();

        // 'input' covers typing, paste, cut, undo; the rest track caret movement.
        ['input', 'keyup', 'mouseup', 'focus'].forEach(function (eventName) {
            inputEl.addEventListener(eventName, handler);
        });

        inputEl.addEventListener('scroll', syncScroll);
        inputEl.addEventListener('keydown', autoIndent);

        // Another Calque link opened in the same tab only changes the hash
        // (no reload): load its text instead of overwriting it with ours.
        // Our own updates use replaceState, which doesn't fire hashchange.
        window.addEventListener('hashchange', function () {
            var text = '';
            try { text = decodeData(window.location.hash.slice(1)); } catch (e) {}
            if (text !== inputEl.value) {
                inputEl.value = text;
                handler();
            }
        });

        // The browser reveals the caret only up to its own box, ignoring the
        // editor padding; keep the caret line fully visible on every caret move.
        document.addEventListener('selectionchange', function () {
            if (document.activeElement === inputEl) this.revealCaret();
        }.bind(this));

        // Font size depends on the viewport width, so sizes change on resize.
        window.addEventListener('resize', function () {
            this.updateSize();
            syncScroll();
        }.bind(this));
    }

    // Editor layout: .interface is the scroll container; the textarea and the
    // results layer on top of each other are sized to the content (CSS keeps
    // them at least as large as the visible area), so both scroll together.
    // Results are drawn further right than the text itself, which is why the
    // textarea alone could not scroll to them.
    Calque.prototype.metrics = function () {
        var style = getComputedStyle(this.inputEl);
        var ctx = this.measureCtx || (this.measureCtx = document.createElement('canvas').getContext('2d'));
        ctx.font = style.fontStyle + ' ' + style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily;
        var tabWidth = ctx.measureText(' ').width * (parseInt(style.tabSize, 10) || 4);
        return {
            padTop: parseFloat(style.paddingTop),
            padRight: parseFloat(style.paddingRight),
            padBottom: parseFloat(style.paddingBottom),
            padLeft: parseFloat(style.paddingLeft),
            lineHeight: parseFloat(style.lineHeight),
            // Rendered width of a line's text: real glyph widths (emoji, CJK,
            // fallback fonts) and tab stops, like the textarea draws it.
            textWidth: function (text) {
                if (text.indexOf('\t') < 0) return ctx.measureText(text).width;
                return text.split('\t').reduce(function (x, part, i) {
                    if (i) x = (Math.floor(x / tabWidth + 1e-6) + 1) * tabWidth;
                    return x + ctx.measureText(part).width;
                }, 0);
            }
        };
    };

    Calque.prototype.updateSize = function () {
        var output = this.outputEl;
        var m = this.metrics();

        var contentWidth = 0;
        this.lines.forEach(function (line) {
            contentWidth = Math.max(contentWidth, m.textWidth(line));
        });
        var left = output.getBoundingClientRect().left - output.scrollLeft + m.padLeft;
        Array.prototype.forEach.call(output.querySelectorAll('.data'), function (data) {
            contentWidth = Math.max(contentWidth, data.getBoundingClientRect().right - left);
        });

        var width = Math.ceil(m.padLeft + contentWidth + m.padRight) + 'px';
        var height = Math.ceil(m.padTop + this.lines.length * m.lineHeight + m.padBottom) + 'px';
        [this.inputEl, output].forEach(function (el) {
            el.style.width = width;
            el.style.height = height;
        });
    };

    Calque.prototype.revealCaret = function () {
        var input = this.inputEl;
        var scroller = input.parentNode;
        var m = this.metrics();
        // The moving end of the selection: start when selecting backwards
        var caret = input.selectionDirection === 'backward' ? input.selectionStart : input.selectionEnd;
        var before = input.value.slice(0, caret);
        var lineStart = before.lastIndexOf('\n') + 1;
        var row = before.split('\n').length - 1;

        var x = m.padLeft + m.textWidth(before.slice(lineStart)) - input.scrollLeft;
        var y = m.padTop + row * m.lineHeight - input.scrollTop;

        if (x - m.padLeft < scroller.scrollLeft) {
            scroller.scrollLeft = x - m.padLeft;
        } else if (x + m.padRight > scroller.scrollLeft + scroller.clientWidth) {
            scroller.scrollLeft = x + m.padRight - scroller.clientWidth;
        }
        if (y - m.padTop < scroller.scrollTop) {
            scroller.scrollTop = y - m.padTop;
        } else if (y + m.lineHeight + m.padBottom > scroller.scrollTop + scroller.clientHeight) {
            scroller.scrollTop = y + m.lineHeight + m.padBottom - scroller.clientHeight;
        }
    };

    // Append text at the end of the document as an undoable edit (Ctrl+Z
    // removes it), replacing trailing whitespace with a blank-line separator.
    Calque.prototype.appendBlock = function (text) {
        var input = this.inputEl;
        var end = input.value.length;
        var trimmed = input.value.replace(/\s+$/, '').length;
        input.focus({ preventScroll: true });
        replaceRange(input, trimmed, end, (trimmed ? '\n\n' : '') + text + '\n');
        input.setSelectionRange(input.value.length, input.value.length);
    };

    Calque.prototype.updateActiveLine = function () {
        var value = this.inputEl.value;
        var selectionStart = this.inputEl.selectionStart;

        var match = value.substr(0, selectionStart).match(/\n/g);

        if (!match) {
            var activeLine = 1;
        } else {
            var activeLine = value.substr(0, selectionStart).match(/\n/g).length + 1;
        }

        if (this.activeLine !== activeLine) {
            this.activeLine = activeLine;
            this.repaint();
        }
    }
    
    Calque.prototype.updateHash = function(data) {
        // replaceState instead of location.hash: don't add a history entry per keystroke
        var hash = encodeData(data);
        history.replaceState(null, '', hash ? '#' + hash : window.location.pathname + window.location.search);
    }

    Calque.prototype.input = function () {
        var raw = this.inputEl.value;
        if (raw !== this.raw) {
            this.raw = raw;
            this.lines = this.raw.split("\n");
            this.updateHash(this.raw);
            this.recalc();
        }
    }

    Calque.prototype.recalc = function () {
        this.expressions = [];
        var spacevars = [];
        var sums = [];
        var scope = {
            last: null
        };

        this.lines.forEach(function (code, index) {
            var expression = {
                line: index,
                code: code,
                processed: code,
                result: null,
                error: null,
            }
			
            this.expressions.push(expression);

            if (expression.code.substr(0, 2) === '  ') {
                expression.tab = expression.code.match(/\s+/)[0].match(/\s{2}/g).length;
			} else {
                expression.tab = 0;
            }

            if (expression.code.trim() !== '' && expression.tab < sums.length) {
                var closed = sums.splice(expression.tab);
            }

            assignedNames(withoutStrings(expression.processed)).forEach(function (name) {
                addSpacevar(spacevars, name);
            });

            if (expression.processed.trim().slice(-1) === ':') {
                var name = expression.processed.trim().slice(0, -1).trim();
                expression.variable = name.replace(/ /g, '_');

                addSpacevar(spacevars, name);

                expression.isSum = true;
                if (expression.tab === sums.length) {
                    sums.push(expression);
                } else {
                    expression.error = 'Error: Unexpected indent';
                }

                expression.processed = name + ' = 0';
            }
			
            // Hex/bin/octal literals (0xFF, 0b101, 0o17) are parsed by math.js itself.
            expression.processed = outsideStrings(expression.processed, function (part) {
                spacevars.forEach(function (spacevar) {
                    part = part.replace(spacevar.regexp, spacevar.replaced);
                });
                return translit(part);
            });

            try {
                expression.result = math.evaluate(expression.processed, scope);
            } catch (e) {
                expression.error = detranslit(e.toString());
            }

            var value = expression.result;

            // An error line leaves 'last' pointing to the previous result
            if (!expression.error && value !== undefined) {
                scope.last = value;
            }

            // Every value line (including 0 and other falsy values) is added to
            // the open sums. Not added: errors, empty lines, function
            // definitions, null, and sum headers themselves (their items are
            // already counted). The total starts empty rather than at 0, so
            // sums of values with units work.
            var addable = !expression.error && !expression.isSum && value !== undefined
                && value !== null && typeof value !== 'function';
            if (sums.length && addable) {
                sums.forEach(function (sum) {
                    if (!sum.error) {
                        try {
                            sum.total = sum.total === undefined ? value : math.add(sum.total, value);
                            sum.result = sum.total;
                            scope[translit(sum.variable)] = sum.total;
                        } catch (e) {
                            sum.error = 'Error: Sum can not be calculated';
                            // A failed sum has no value: don't leave the last
                            // partial total in its variable.
                            delete scope[translit(sum.variable)];
                        }
                    }
                });
            }
        }.bind(this));

        this.repaint();
    };

    Calque.prototype.repaint = function () {
        var html = '';
        var m = this.metrics();

        this.lines.forEach(function (line, index) {
            var expression = this.expressions.filter(function (expression) {
                return expression.line === index;
            })[0];

            if (expression.error) {
                if (this.activeLine === index + 1) {
                    var type = 'empty';
                } else {
                    var type = 'error';
                }
            } else if (expression.result === undefined) {
                var type = 'empty';

                for (var i = index; i < this.lines.length; i++) {
                    if (this.expressions[i].result !== undefined) {
                        expression.tab = this.expressions[i].tab;
                        break;
                    }
                }
            } else {
                var type = 'result';
            }

            // Indentation guides ("| " per sum level) are drawn over the
            // line's leading spaces; the result starts right after the text,
            // at its measured width, so tabs and wide characters don't shift it.
            var guides = '';
            for (var g = 0; g < expression.tab; g++) guides += '| ';

            // Each piece: [css class, text]; text is escaped when rendered.
            var pieces = [];
            if (type === 'result') {
                if (expression.result === null) {
                    pieces.push(['value', 'null']);
                } else if (expression.result instanceof Function) {
                    pieces.push(['fn', 'fn']);
                } else {
                    var result = formatResult(expression.result);
                    var hex = toBase(expression.result, '0x', 16);
                    var bin = toBase(expression.result, '0b', 2);
                    if (document.getElementById('checkDec').checked) pieces.push(['value', ' = ' + result]);
                    if (hex && document.getElementById('checkHex').checked) pieces.push(['alt', ' = ' + hex]);
                    if (bin && document.getElementById('checkBin').checked) pieces.push(['alt', ' = ' + bin]);
                }
            }
            if (type === 'error') pieces.push(['marker', '// '], ['message', expression.error]);

            var classes = type + (this.activeLine === index + 1 ? ' active' : '');
            var lineHtml = '<div class="' + classes + '">';
            lineHtml += '<span class="prefix" data-prefix="' + escapeHtml(guides) + '"></span>';
            if (pieces.length) {
                var offset = m.textWidth(expression.code + ' ') - m.textWidth(guides);
                lineHtml += '<span class="data" style="margin-left: ' + offset.toFixed(2) + 'px">';
            } else {
                lineHtml += '<span class="data">';
            }
            pieces.forEach(function (piece) {
                lineHtml += '<span class="' + piece[0] + '">' + escapeHtml(piece[1]) + '</span>';
            });
            lineHtml += '</span></div>';

            html += lineHtml;
        }.bind(this));

        this.outputEl.innerHTML = html;
        this.updateSize();
    };
	
	function escapeHtml(text) {
		return String(text)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	// Non-integers are shown with 15 significant digits, which hides binary
	// floating point noise (0.1 + 0.2 = 0.3, 5 cm + 2 cm = 7 cm). Integers are
	// shown as is. Exponent thresholds match JavaScript's own number output.
	var FORMAT = { precision: 15, lowerExp: -6, upperExp: 21 };

	function formatResult(value) {
		var text;
		if (typeof value === 'number') {
			text = Number.isInteger(value) || !isFinite(value) ? String(value) : math.format(value, FORMAT);
		} else if (value && (value.isMatrix || Array.isArray(value)) && count(value) > MAX_RESULT_CHARS) {
			// Formatting a huge matrix is slow and unreadable anyway: show its size
			return 'matrix ' + math.size(value).valueOf().join(' × ');
		} else if (value && (value.isUnit || value.isComplex || value.isMatrix || Array.isArray(value))) {
			text = math.format(value, FORMAT);
		} else {
			text = String(value);
		}
		return text.length > MAX_RESULT_CHARS ? text.slice(0, MAX_RESULT_CHARS) + '…' : text;
	}

	// Hex/bin only make sense for integers: skip units, complex numbers,
	// booleans, fractions and so on instead of showing 0xNAN or a rounded value.
	function toBase(value, prefix, base) {
		if (typeof value !== 'number' || !Number.isSafeInteger(value)) return null;
		var sign = value < 0 ? '-' : '';
		return sign + prefix + Math.abs(value).toString(base).toUpperCase();
	}

    window.Calque = Calque;
})();
(function () {
    function translit(text){
        return text.replace(/[а-яА-ЯёЁ]/g, function (match) {
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
        return {
            padTop: parseFloat(style.paddingTop),
            padRight: parseFloat(style.paddingRight),
            padBottom: parseFloat(style.paddingBottom),
            padLeft: parseFloat(style.paddingLeft),
            lineHeight: parseFloat(style.lineHeight),
            textWidth: function (text) {
                return ctx.measureText(text.replace(/\t/g, '    ')).width;
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

            assignedNames(expression.processed).forEach(function (name) {
                addSpacevar(spacevars, name);
            });

            if (expression.processed.trim().slice(-1) === ':') {
                var name = expression.processed.trim().slice(0, -1).trim();
                expression.variable = name.replace(/ /g, '_');

                addSpacevar(spacevars, name);

                if (expression.tab === sums.length) {
                    sums.push(expression);
                } else {
                    expression.error = 'Error: Unexpected indent';
                }

                expression.processed = name + ' = 0';
            }
			
            spacevars.forEach(function (spacevar) {
                expression.processed = expression.processed.replace(spacevar.regexp, spacevar.replaced);
            });

            expression.processed = translit(expression.processed);
			
            expression.processed = expression.processed.replace( /0x[0-9A-Fa-f]+/g , function(match){ return parseInt( match, 16 ); } );
			expression.processed = expression.processed.replace( /0b[01]+/g , function(match){ return  parseInt( match.substr(2,match.length), 2); } );
			
            try {
                expression.result = math.evaluate(expression.processed, scope);
            } catch (e) {
                expression.error = detranslit(e.toString());
            }

            if (expression.result !== undefined) {
                scope.last = expression.result;
            }

            if (sums.length && expression.result && !expression.error) {
                sums.forEach(function (sum) {
                    if (!sum.error) {
                        try {
                            sum.result = math.add(sum.result, expression.result);
                            scope[translit(sum.variable)] = sum.result;
                        } catch (e) {
                            sum.error = 'Error: Sum can not be calculated';
                        }
                    }
                });
            }
        }.bind(this));

        this.repaint();
    };

    Calque.prototype.repaint = function () {
        var html = '';

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

            var prefix = '';
            for (var s = 0; s <= expression.code.length; s++) prefix += ' ';
            if (type === 'empty') for (var t = 0; t <= expression.tab; t++) prefix += '  ';
            for (var i = 0; i < expression.tab; i++) prefix = prefix.replace(/(\| )?  /, '$1| ');

            if (type === 'error') prefix += '// ';

            // Each piece: [css class, text]; text is escaped when rendered.
            var pieces = [];
            if (type === 'result') {
                if (expression.result === null) {
                    pieces.push(['value', 'null']);
                } else if (expression.result instanceof Function) {
                    pieces.push(['fn', 'fn']);
                } else {
                    var result = expression.result.toString();
                    var hex = toBase(result, '0x', 16);
                    var bin = toBase(result, '0b', 2);
                    if (document.getElementById('checkDec').checked) pieces.push(['value', ' = ' + result]);
                    if (hex && document.getElementById('checkHex').checked) pieces.push(['alt', ' = ' + hex]);
                    if (bin && document.getElementById('checkBin').checked) pieces.push(['alt', ' = ' + bin]);
                }
            }
            if (type === 'error') pieces.push(['message', expression.error]);

            var classes = type + (this.activeLine === index + 1 ? ' active' : '');
            var lineHtml = '<div class="' + classes + '">';
            lineHtml += '<span class="prefix" data-prefix="' + escapeHtml(prefix) + '"></span>';
            lineHtml += '<span class="data">';
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

	// Hex/bin only make sense for integers: skip units, complex numbers,
	// booleans, fractions and so on instead of showing 0xNAN or a rounded value.
	function toBase(str, prefix, base) {
		var number = Number(str);
		if (!Number.isSafeInteger(number)) return null;
		var sign = number < 0 ? '-' : '';
		return sign + prefix + Math.abs(number).toString(base).toUpperCase();
	}

    window.Calque = Calque;
})();
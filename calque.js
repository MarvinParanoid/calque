(function () {
    function translit(text){
        return text.replace(/[а-яА-Я]/g, function (match) {
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

    function Calque(inputEl, outputEl) {
        this.inputEl = inputEl;
        this.outputEl = outputEl;

        this.raw = '';
        this.lines = [];
        this.expressions = [];
        this.activeLine = 0;
		
		if ( window.location.search.match(/style=dark/)){
			document.getElementById('dark-styles').disabled  = false;
			document.getElementById('rbDark').checked  = true;
		}
		
		if (window.location.hash.length) {    
			try {
				inputEl.value = decodeData(window.location.hash.slice(1));
			} catch(e) {}
		}
		
        var handler = function () {
            this.updateActiveLine();
            this.input();
            outputEl.scrollTop = inputEl.scrollTop;
        }.bind(this);

        handler();

        // 'input' covers typing, paste, cut, undo; the rest track caret movement.
        ['input', 'keyup', 'mouseup', 'focus'].forEach(function (eventName) {
            inputEl.addEventListener(eventName, handler);
        });

		document.getElementById('tinyurl').onclick = function() {
			 document.getElementById('share').value = window.location.href;
		}
		
		inputEl.onscroll = function () {
			outputEl.scrollTop = inputEl.scrollTop;
		};

    }

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
                            scope[sum.variable] = sum.result;
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

            if (type === 'result') {
                if (expression.result instanceof Function) {
                    prefix += 'fn';
                } else {
                    prefix += '';
                }
            }
            if (type === 'error') prefix += '// ';

            var data = '';
            if (type === 'result') {
                if (expression.result === null) {
                    data = 'null';
                } else if (expression.result instanceof Function) {
                    var source = expression.result.toString();
                    data = '';
                } else {
                    result = expression.result.toString();
					if (document.getElementById("checkDec").checked) data+= " = " + result;
					if (document.getElementById("checkHex").checked) data+= " = " + strDecTo(result,"0x",16);
					if (document.getElementById("checkBin").checked) data+= " = " + strDecTo(result,"0b",2);
                }
            };
            if (type === 'error') data = expression.error;

            var lineHtml = '<div class="' + type + '">';
            lineHtml += '<span class="prefix" data-prefix="' + escapeHtml(prefix) + '"></span>';
            lineHtml += '<span class="data">' + escapeHtml(data) + '</span>';
            lineHtml += '</div>';

            html += lineHtml;
        }.bind(this));

        this.outputEl.innerHTML = html;
    };
	
	function escapeHtml(text) {
		return String(text)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	function strDecTo(str,prefix,notation){
		return prefix+Math.round(Number(str)).toString(notation).toUpperCase();
	}

    window.Calque = Calque;
})();
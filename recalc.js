function recalc() {
    var scope = {};
    var output = [];

    var inputEl = document.getElementById('input');
    var input = inputEl.value.split("\n");

    input.forEach(function (line) {
        if (line === '' || line[0] === '#') {
            output.push({
                type: 'empty',
            });
        } else {
            var length = line.length;

            try {
                var value = math.eval(line, scope).toString();
            } catch (e) {
                output.push({
                    type: 'error',
                    length: length,
                    value: e,
                });
                return;
            }

            if (value.substr(0, 8) === 'function') {
                value = value.substring(9, value.indexOf('{') - 1);
                output.push({
                    type: 'function',
                    length: length,
                    value: value,
                });
            } else {
                output.push({
                    type: 'value',
                    length: length,
                    value: value,
                });
            }
        }
    });

    var outputEl = document.getElementById('output');
    outputEl.innerHTML = '';
    output.forEach(function (line) {
        if (line.type === 'empty') {
            outputEl.innerHTML += '<div class="clear">&nbsp;</div>';
        } else if (line.type === 'value') {
            var comment = '<span class="comment">= </span>';
            var spaces = '';
            for (var s = 0; s <= line.length; s++) spaces += ' ';
            outputEl.innerHTML += '<div class="value">' + spaces + comment + line.value + '</div>';
        } else if (line.type === 'function') {
            var comment = '<span class="comment"> fn</span>';
            var spaces = '';
            for (var s = 0; s <= line.length; s++) spaces += ' ';
            outputEl.innerHTML += '<div class="function">' + spaces + comment + '</div>';
        } else if (line.type === 'error') {
            var comment = '<span class="comment">// </span>';
            var spaces = '';
            for (var s = 0; s <= line.length; s++) spaces += ' ';
            outputEl.innerHTML += '<div class="error">' + spaces + comment + line.value + '</div>';
        }
    });
}
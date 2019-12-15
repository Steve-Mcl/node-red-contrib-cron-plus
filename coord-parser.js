//Credits to 
//https://www.npmjs.com/package/coord-parser
/* 
License
The MIT License (MIT)

Copyright © 2015 Natural Atlas, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy 
of this software and associated documentation files (the "Software"), to deal 
in the Software without restriction, including without limitation the rights 
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell 
copies of the Software, and to permit persons to whom the Software is 
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in 
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR 
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL 
THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR 
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, 
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER 
DEALINGS IN THE SOFTWARE.
*/


var TOKEN_WHITESPACE = '\\s*';
var TOKEN_SEPARATOR = '[,;\\s]*';
var TOKEN_FLOAT = '(-?\\d+(?:\\.\\d+)?)';
var TOKEN_DEG = TOKEN_FLOAT + TOKEN_WHITESPACE + '[°º:d]?';
var TOKEN_MIN = TOKEN_FLOAT + TOKEN_WHITESPACE + '[\'’‘′:]';
var TOKEN_SEC = TOKEN_FLOAT + TOKEN_WHITESPACE + '(?:"|″|’’|\'\'|”|“)?';
var TOKEN_DMS = TOKEN_DEG + optional(TOKEN_WHITESPACE + TOKEN_MIN) + optional(TOKEN_WHITESPACE + TOKEN_SEC);
var TOKEN_DIR = '([NSEW]?)';

function optional(re) {
	return '(?:' + re + ')?';
}
function inRange(value, a, b) {
	return value >= a && value <= b;
}

function dmsToDec(deg, min, sec) {
	deg = parseFloat(deg);
	min = parseFloat(min) || 0;
	sec = parseFloat(sec) || 0;
	var sign = deg < 0 ? -1 : 1;
	if (!inRange(min, 0, 60)) throw new Error('Minutes out of range');
	if (!inRange(sec, 0, 60)) throw new Error('Seconds out of range');
	return (deg + sign * min / 60 + sign * sec / 3600);
}

function apply(deg, min, sec, cardinality, result) {
	if (typeof deg === 'undefined') return;
	var prop = 'lat', coeff = 1;
	if (cardinality === 'e' || cardinality === 'w') {
		prop = 'lon';
	}

	// 1E -> 1.0, 1W -> -1.0
	// 1N -> 1.0, 1S -> -1.0
	if (cardinality === 's') coeff = -1;
	if (cardinality === 'w') coeff = -1;
	result[prop] = coeff * dmsToDec(deg, min, sec);
}

function normalizeCardinality(a, b) {
	a = (a || '').toLowerCase();
	b = (b || '').toLowerCase();
	// +n, +e
	if (!a && !b) return ['n', 'e'];
	if (a && !b) return [a, a === 'n' || a === 's' ? 'e' : 'n'];
	if (!a && b) return [b === 'n' || b === 's' ? 'e' : 'n', b];
	return [a, b];
}


module.exports = function(input) {
	input = input.trim();

	var regExpA = new RegExp('^' + TOKEN_FLOAT + '$', 'ig');
	var regExpB = new RegExp('^' + TOKEN_FLOAT + TOKEN_SEPARATOR + TOKEN_FLOAT + '$', 'ig');
	var regExpC = new RegExp('^' + TOKEN_DMS + TOKEN_WHITESPACE + TOKEN_DIR + '(?:' + TOKEN_SEPARATOR + TOKEN_DMS + TOKEN_WHITESPACE + TOKEN_DIR + ')?$', 'ig'); // 0°W, O°N
	var regExpD = new RegExp('^' + TOKEN_DIR + TOKEN_WHITESPACE + TOKEN_DMS + '(?:' + TOKEN_SEPARATOR + TOKEN_DIR + TOKEN_WHITESPACE + TOKEN_DMS + ')?$', 'ig'); // N0, WO

	var match, cardinality;
	var result = {};
	if (match = regExpA.exec(input)) {
		return parseFloat(match[1]);
	} else if (match = regExpB.exec(input)) {
		return {
			lat: parseFloat(match[1]),
			lon: parseFloat(match[2])
		};
	} else if (match = regExpC.exec(input)) {
		cardinality = normalizeCardinality(match[4], match[8]);
		if (!match[4] && !match[5]) return dmsToDec(match[1], match[2], match[3]);
		apply(match[1], match[2], match[3], cardinality[0], result);
		apply(match[5], match[6], match[7], cardinality[1], result);
	} else if (match = regExpD.exec(input)) {
		cardinality = normalizeCardinality(match[1], match[5]);
		apply(match[2], match[3], match[4], cardinality[0], result);
		apply(match[6], match[7], match[8], cardinality[1], result);
	} else {
		throw new Error('Could not parse string: ' + input);
	}

	return result;
};


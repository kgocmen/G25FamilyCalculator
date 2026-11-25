const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const converter = require('../calculator/illustrative.js');
const bundled = require('../calculator/illustrative_data.js');
const core = require('../calculator/core.js');

const directory = path.join(__dirname, '../data/illu');
const matrix = fs.readFileSync(path.join(directory, 'conversion_matrix.csv'), 'utf8').trim()
  .split(/\r?\n/).map((row) => row.split(',').map(Number));
const offset = fs.readFileSync(path.join(directory, 'conversion_offset.csv'), 'utf8').trim()
  .split(',').map(Number);

test('IllustrativeDNA bundle preserves the editable matrix and offset', () => {
  assert.equal(matrix.length, 25);
  assert.ok(matrix.every((row) => row.length === 25 && row.every(Number.isFinite)));
  assert.equal(offset.length, 25);
  assert.deepEqual(bundled.matrix, matrix);
  assert.deepEqual(bundled.offset, offset);
});

test('IllustrativeDNA conversion applies coordinates × matrix + offset', () => {
  const zero = Array(25).fill(0);
  assert.deepEqual(converter.convert(zero), offset);
  const first = [1, ...Array(24).fill(0)];
  const output = converter.convert(first);
  output.forEach((value, index) => assert.ok(Math.abs(value - (offset[index] + matrix[0][index])) < 1e-12));
  assert.throws(() => converter.convert([1]), /25 finite/);
});

test('batch conversion preserves names and rejects an invalid row atomically', () => {
  const input = `First,${Array(25).fill(0).join(',')}\nSecond,${[1, ...Array(24).fill(0)].join(',')}`;
  const rows = converter.convertRows(input).split('\n').map(core.parseLine);
  assert.deepEqual(rows.map((row) => row.label), ['First', 'Second']);
  assert.ok(rows[0].values.every((value, index) => Math.abs(value - offset[index]) < 1e-11));
  assert.throws(() => converter.convertRows(`${input}\nBroken,1,2`), /25 numbers/);
  assert.throws(() => converter.convertRows(Array(25).fill(0).join(',')), /name/);
});

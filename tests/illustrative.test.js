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
const inverseMatrix = fs.readFileSync(path.join(directory, 'inverse_matrix.csv'), 'utf8').trim()
  .split(/\r?\n/).map((row) => row.split(',').map(Number));
const inverseOffset = fs.readFileSync(path.join(directory, 'inverse_offset.csv'), 'utf8').trim()
  .split(',').map(Number);

test('IllustrativeDNA bundle preserves the editable matrix and offset', () => {
  assert.equal(matrix.length, 25);
  assert.ok(matrix.every((row) => row.length === 25 && row.every(Number.isFinite)));
  assert.equal(offset.length, 25);
  assert.deepEqual(bundled.matrix, matrix);
  assert.deepEqual(bundled.offset, offset);
  assert.deepEqual(bundled.inverseMatrix, inverseMatrix);
  assert.deepEqual(bundled.inverseOffset, inverseOffset);
});

test('G25 conversion into native Illustrative space uses the inverse matrix', () => {
  assert.deepEqual(converter.toIllustrative(Array(25).fill(0)), inverseOffset);
  const first = [1, ...Array(24).fill(0)];
  converter.toIllustrative(first).forEach((value, index) =>
    assert.ok(Math.abs(value - (inverseOffset[index] + inverseMatrix[0][index])) < 1e-12));
  const input = `G25_sample,${first.join(',')}`;
  const formatted = converter.convertRowsToIllustrative(input);
  const parsed = core.parseLine(formatted);
  assert.equal(parsed.label, 'G25_sample');
  parsed.values.forEach((value, index) =>
    assert.ok(Math.abs(value - converter.toIllustrative(first)[index]) <= 5e-9));
  assert.ok(formatted.split(',').slice(1).every((cell) => !cell.includes('.') || cell.split('.')[1].length <= 8));
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
  assert.ok(rows[0].values.every((value, index) => Math.abs(value - offset[index]) <= 5e-7));
  assert.ok(converter.convertRows(input).split('\n').every((line) =>
    line.split(',').slice(1).every((cell) =>
      !cell.includes('.') || cell.split('.')[1].length <= 6)));
  assert.throws(() => converter.convertRows(`${input}\nBroken,1,2`), /25 numbers/);
  assert.throws(() => converter.convertRows(Array(25).fill(0).join(',')), /name/);
});

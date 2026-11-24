const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const G25Direct = require('../calculator/g25_direct.js');
const folder = path.join(__dirname, '../calculator/raw_data');

test('enabled three-axis G25 model matches its manifest and produces 25 coordinates', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
  const info = manifest.directBlend;
  assert.equal(info.enabled, true);
  const compressed = fs.readFileSync(path.join(folder, info.file));
  assert.equal(compressed.length, info.bytes);
  assert.equal(crypto.createHash('sha256').update(compressed).digest('hex'), info.sha256);
  const bytes = zlib.gunzipSync(compressed);
  const model = G25Direct.decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  assert.equal(model.n, info.snps);
  assert.deepEqual(model.bases.map((basis) => basis.axes), info.axes);

  // Synthetic heterozygous calls exercise all three projections without storing DNA.
  const calls = new Map();
  for (let i = 0; i < model.n; i++) calls.set(model.ids[i], model.a1[i] * 4 + model.a2[i]);
  const result = G25Direct.predict(calls, model);
  assert.equal(result.matched, model.n);
  assert.equal(result.coverage, 1);
  assert.equal(result.values.length, 25);
  assert.equal(result.components.length, 3);
  assert.ok(result.values.every(Number.isFinite));
});

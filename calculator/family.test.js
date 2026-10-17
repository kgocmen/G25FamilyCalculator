const assert = require("node:assert/strict");
const test = require("node:test");
const core = require("./core.js");

const person = (label, value, source = "reference") => ({
  label, values: Array.from({ length: 25 }, (_, k) => value * (k + 1) / 100), source, category: "modern",
});

test("family optimisation exhaustively matches the best modern weighted replacements", () => {
  const references = [person("Low", 1), person("Middle", 3), person("High", 8),
    { ...person("Ancient", 4), category: "ancient" }];
  for (const count of [2, 4, 8]) {
    for (const male of [false, true]) {
      const ancestors = Array.from({ length: count }, (_, i) => person(`Original${i}`, i + 2));
      const child = person("Child", 4);
      const locks = ancestors.map((_, i) => i !== 0 && i !== count - 1);
      let best = Infinity;
      for (const a of references.slice(0, 3)) {
        for (const b of references.slice(0, 3)) {
          const trial = [...ancestors];
          trial[0] = a;
          trial[count - 1] = b;
          best = Math.min(best, core.calculate(child, trial, male).distance);
        }
      }
      const result = core.optimiseFamily(child, ancestors, locks, references, male);
      assert.ok(Math.abs(result.distance - best) < 1e-10);
      for (let i = 1; i < count - 1; i += 1) assert.equal(result.ancestors[i], ancestors[i]);
      assert.equal(result.ancestors[0].category, "modern");
      assert.equal(ancestors[0].label, "Original0");
    }
  }
});

test("pasted contributors are locked automatically and one or zero free slots work", () => {
  const pasted = person("Pasted", 1, undefined);
  delete pasted.source;
  const original = person("Original", 9);
  const references = [["modern", "Replacement", ...person("R", 3).values]];
  const child = { label: "Child", values: core.calculate(null, [pasted, person("R", 3)], true).values };
  const result = core.optimiseFamily(child, [pasted, original], [false, false], references, true);
  assert.equal(result.ancestors[0], pasted);
  assert.equal(result.ancestors[1].label, "Replacement");
  assert.ok(result.distance < 1e-10);
  assert.deepEqual(core.optimiseFamily(child, [pasted, original], [false, true], [], true).ancestors,
    [pasted, original]);
});

test("three and four unlocked slots match exhaustive search, including unequal male weights", () => {
  const references = Array.from({ length: 12 }, (_, id) => ({ ...person(`R${id}`, id),
    values: Array.from({ length: 25 }, (_, k) => Math.sin((id + 1) * (k + 2)) / 100) }));
  for (const [count, male, lockedIndex] of [[4, false, 0], [4, true, 0], [4, true, 3], [8, false, 0]]) {
    const ancestors = Array.from({ length: count }, (_, i) => person(`Original${i}`, i / 10));
    const locks = ancestors.map((_, i) => count === 4 ? i === lockedIndex : i < 4);
    const unlocked = ancestors.map((_, i) => i).filter((i) => !locks[i]);
    const target = { label: "Child", values: Array.from({ length: 25 }, (_, k) => Math.cos(k * 2.3) / 100) };
    let expected = Infinity;
    const trial = [...ancestors];
    function visit(slot) {
      if (slot === unlocked.length) {
        expected = Math.min(expected, core.calculate(target, trial, male).distance);
        return;
      }
      for (const row of references) { trial[unlocked[slot]] = row; visit(slot + 1); }
    }
    visit(0);
    const result = core.optimiseFamily(target, ancestors, locks, references, male);
    assert.ok(Math.abs(result.distance - expected) < 1e-10, `${count} contributors, male=${male}`);
    locks.forEach((locked, i) => { if (locked) assert.equal(result.ancestors[i], ancestors[i]); });
  }
  const ancestors = Array.from({ length: 8 }, (_, i) => person(`A${i}`, i));
  assert.throws(() => core.optimiseFamily(person("Child", 1), ancestors,
    [true, true, true, false, false, false, false, false], references), /Lock at least 4/);
});

test("optimisation permits repeated populations and rejects incomplete or insufficiently locked families", () => {
  const child = person("Child", 3);
  const ancestors = [person("A", 1), person("B", 9)];
  const result = core.optimiseFamily(child, ancestors, [false, false], [person("Only", 3)]);
  assert.equal(result.distance, 0);
  assert.deepEqual(result.ancestors.map((row) => row.label), ["Only", "Only"]);
  assert.throws(() => core.optimiseFamily(null, ancestors, [], []), /Fill/);
  assert.throws(() => core.optimiseFamily(child, [ancestors[0], null], [], []), /Fill/);
  assert.throws(() => core.optimiseFamily(child, [...ancestors, ...ancestors], [false, false, false, false], []), /Lock/);
  assert.throws(() => core.optimiseFamily(child, ancestors, [], [{ ...person("Old", 3), category: "ancient" }]), /No modern/);
});

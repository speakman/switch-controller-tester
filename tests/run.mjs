// Pure-function tests — no browser, no WebHID, no dependencies.
// Run:  node tests/run.mjs
//
// Covers the correctness-critical decode logic: readBits (HID bit extraction),
// decodeAxis (signed-axis sign-extension + normalization), decodeHat (D-pad
// direction), and the DriftRecorder verdict thresholds.

import assert from 'node:assert/strict';
import { readBits, decodeAxis, decodeHat, splitUsage } from '../js/hid.js';
import { DriftRecorder, DRIFT } from '../js/sticks.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n      ${e.message}`); }
}
const dv = (...bytes) => new DataView(new Uint8Array(bytes).buffer);
const approx = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b} (±${eps})`);

console.log('readBits');
test('single bits, little-endian within a byte', () => {
  const v = dv(0b00000001);
  assert.equal(readBits(v, 0, 1), 1);
  assert.equal(readBits(v, 1, 1), 0);
});
test('nibbles of 0xA5', () => {
  const v = dv(0xA5);            // 1010 0101
  assert.equal(readBits(v, 0, 4), 0x5);
  assert.equal(readBits(v, 4, 4), 0xA);
  assert.equal(readBits(v, 0, 8), 0xA5);
});
test('16-bit little-endian (bytes b0 79 → 0x79b0)', () => {
  assert.equal(readBits(dv(0xB0, 0x79), 0, 16), 0x79B0); // 31152
});
test('field straddling a byte boundary', () => {
  // byte0=0xFF, byte1=0x01; bits 4..11 → low nibble 0xF + (byte1 low nibble 0x1)<<4 = 0x1F
  assert.equal(readBits(dv(0xFF, 0x01), 4, 8), 0x1F);
});
test('out-of-range read is clamped, not a crash', () => {
  assert.equal(readBits(dv(0xFF), 0, 16), 0xFF); // second byte missing → stops at EOF
});

console.log('decodeAxis');
test('unsigned 16-bit center ≈ 0', () => approx(decodeAxis(32768, 16, 0, 65535).norm, 0, 2e-4));
test('unsigned 16-bit min = -1', () => approx(decodeAxis(0, 16, 0, 65535).norm, -1));
test('unsigned 16-bit max = +1', () => approx(decodeAxis(65535, 16, 0, 65535).norm, +1));
test('signed 8-bit -1 (byte 0xFF) ≈ 0, not the pre-fix +2.004', () => {
  const r = decodeAxis(0xFF, 8, -128, 127);
  assert.equal(r.raw, -1);            // sign-extended
  approx(r.norm, 0, 0.01);
  assert.ok(r.norm < 0.5, `norm ${r.norm} must be near 0, not +2.004`);
});
test('signed 8-bit full-negative (byte 0x80) = -1', () => approx(decodeAxis(0x80, 8, -128, 127).norm, -1));
test('signed 8-bit +127 = +1', () => approx(decodeAxis(127, 8, -128, 127).norm, +1));
test('degenerate range (lmin == lmax) → 0, no NaN/Infinity', () => {
  const n = decodeAxis(5, 8, 5, 5).norm;
  assert.ok(Number.isFinite(n));
  assert.equal(n, 0);
});

console.log('decodeHat');
test('up = y:-1 (the convention buttons.js must match)', () => {
  assert.deepEqual(decodeHat(0, 0, 7), { x: 0, y: -1 });
});
test('right / down / left', () => {
  assert.deepEqual(decodeHat(2, 0, 7), { x: 1, y: 0 });
  assert.deepEqual(decodeHat(4, 0, 7), { x: 0, y: 1 });
  assert.deepEqual(decodeHat(6, 0, 7), { x: -1, y: 0 });
});
test('up-right diagonal', () => assert.deepEqual(decodeHat(1, 0, 7), { x: 1, y: -1 }));
test('neutral / out-of-range → centered', () => {
  assert.deepEqual(decodeHat(8, 0, 7), { x: 0, y: 0 });
  assert.deepEqual(decodeHat(15, 0, 7), { x: 0, y: 0 });
});
test('1-based logicalMinimum offset', () => assert.deepEqual(decodeHat(1, 1, 8), { x: 0, y: -1 }));

console.log('splitUsage');
test('packed u32 (Chromium)', () => assert.deepEqual(splitUsage(0x00010030), { page: 1, id: 0x30 }));
test('button page', () => assert.deepEqual(splitUsage(0x00090001), { page: 9, id: 1 }));
test('object form', () => assert.deepEqual(splitUsage({ usagePage: 1, usage: 0x39 }), { page: 1, id: 0x39 }));

console.log('DriftRecorder.report verdicts');
const reportFor = (samples) => { const r = new DriftRecorder(); r.samples = samples; return r.report(); };
test('clean: tiny offset, no jitter', () => {
  const rep = reportFor([{ lx: 0.01, ly: 0, rx: 0, ry: 0 }, { lx: 0.01, ly: 0, rx: 0, ry: 0 }]);
  assert.equal(rep.sticks.left.verdict, 'clean');
});
test(`small offset just above clean (${DRIFT.rest.clean})`, () => {
  const rep = reportFor([{ lx: 0.06, ly: 0, rx: 0, ry: 0 }, { lx: 0.06, ly: 0, rx: 0, ry: 0 }]);
  assert.equal(rep.sticks.left.verdict, 'small');   // language-neutral key; app.js maps to display text
});
test(`drift above warn (${DRIFT.rest.warn})`, () => {
  const rep = reportFor([{ lx: 0.2, ly: 0, rx: 0, ry: 0 }, { lx: 0.2, ly: 0, rx: 0, ry: 0 }]);
  assert.equal(rep.sticks.left.verdict, 'drift');
});
test('empty recording does not throw', () => {
  const rep = reportFor([]);
  assert.equal(rep.count, 0);
  assert.equal(rep.sticks.left.verdict, 'clean');
});

console.log(`\n${failed ? '✗' : '✓'} ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

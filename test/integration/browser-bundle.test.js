'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BUNDLE_PATH = path.resolve(__dirname, '../../dist/index.browser.js');

const bundleExists = fs.existsSync(BUNDLE_PATH);
const describeOrSkip = bundleExists ? describe : describe.skip;

describeOrSkip('Browser Bundle — Node.js API taraması (ST-13)', () => {
  let bundleContent;

  beforeAll(() => {
    bundleContent = fs.readFileSync(BUNDLE_PATH, 'utf8');
  });

  test('bundle mevcut', () => {
    expect(bundleExists).toBe(true);
  });

  test("require('fs') geçmez", () => {
    if (!bundleContent) return;
    expect(bundleContent).not.toMatch(/require\(['"]fs['"]\)/);
  });

  test("require('path') geçmez", () => {
    if (!bundleContent) return;
    expect(bundleContent).not.toMatch(/require\(['"]path['"]\)/);
  });

  test('process.env geçmez', () => {
    if (!bundleContent) return;
    expect(bundleContent).not.toMatch(/process\.env/);
  });

  test('bundle boyutu < 52 KB (gzip)', () => {
    if (!bundleContent) return;
    const gzipped = zlib.gzipSync(bundleContent);
    const kb = gzipped.length / 1024;
    expect(kb).toBeLessThan(52);
  });
});
